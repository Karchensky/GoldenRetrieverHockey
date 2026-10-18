import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { clipThumbs, duration } from "../src/clip.ts";
import { align, recordingThumbs } from "../src/crosscheck.ts";
import { routeClip } from "../src/daily.ts";
import { renderRecap } from "../src/recap.ts";
import { cutClip, openStream } from "../src/stream.ts";

/**
 * The backup: a clip cut from the recording instead of downloaded. Which way a
 * clip goes is a rule; that the cut is the stretch it was asked for is measured,
 * on a recording made here the way the rink's is — two variants, six-second
 * segments — and served the way the rink serves it.
 */

test("downloads while the month's last; the recording after, or when told; an older game never downloads", () => {
  assert.equal(routeClip("auto", false, 3), "download");
  assert.equal(routeClip("auto", false, 0), "recording");
  assert.equal(routeClip("auto", true, 3), "recording");
  assert.equal(routeClip("recording", false, 3), "recording");
  assert.equal(routeClip("download", false, 3), "download");
  // Downloads only: with none left it waits for next month's, as before the backup.
  assert.equal(routeClip("download", false, 0), "wait");
  assert.equal(routeClip("download", true, 3), "wait");
});

const ffmpeg = spawnSync(process.env.FFMPEG ?? "ffmpeg", ["-version"]).status === 0;

test("a clip cut from the recording is exactly the stretch asked for, on the clock the board is read on", { skip: !ffmpeg && "ffmpeg is not installed" }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grh-hls-"));
  // A picture that never repeats, so only the right offset matches.
  for (const [name, size, rate] of [["hi", "640x360", "1M"], ["lo", "320x180", "300k"]] as const) {
    fs.mkdirSync(path.join(dir, name));
    const r = spawnSync(process.env.FFMPEG ?? "ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "mandelbrot=s=320x180:r=30:maxiter=200", "-t", "40", "-s", size,
      "-c:v", "libx264", "-preset", "ultrafast", "-b:v", rate, "-g", "60",
      "-f", "hls", "-hls_time", "6", "-hls_playlist_type", "vod", path.join(dir, name, "p.m3u8"),
    ]);
    assert.equal(r.status, 0, r.stderr.toString());
  }
  fs.writeFileSync(path.join(dir, "m.m3u8"),
    "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=300000,RESOLUTION=320x180\nlo/p.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=640x360\nhi/p.m3u8\n");
  const server = http.createServer((q, s) => {
    const file = path.join(dir, path.normalize(q.url ?? "/"));
    if (file.startsWith(dir) && fs.existsSync(file)) s.end(fs.readFileSync(file)); else { s.statusCode = 404; s.end(); }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/m.m3u8`;
    const best = await openStream(url, "best"), lightest = await openStream(url);
    assert.match(best.variant, /^640x360, 1\.0 Mb\/s, best of 2$/);
    assert.match(lightest.variant, /^320x180/);

    // Across a segment boundary, starting off one: 20.3 to 33.3 spans 18-24, 24-30 and 30-36.
    const out = path.join(dir, "cut.mp4");
    await cutClip(best, 20.3, 13, out);
    assert.ok(Math.abs(duration(out) - 13) < 0.1, `cut is ${duration(out)}s`);
    // An input seek kept the segments' start offset and began 1.5 s late; this pins it.
    const a = align(clipThumbs(out), await recordingThumbs(lightest, 20.3, 13), 20.3);
    assert.equal(a?.offset, 0);

    await assert.rejects(cutClip(best, 35, 13, out), /does not reach/);

    // A recap trims each play out of its joined segments in one encode: the play must be the stretch asked for,
    // after the three-second title card, not a second or two either side.
    if (fs.existsSync(process.env.RECAP_FONT ?? "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")) {
      const recap = path.join(dir, "recap.mp4");
      await renderRecap(best, [{ start: 20.3, end: 30.3, kind: "shot", label: "Shot · Test" }], ["A at B", "A day"], recap);
      assert.ok(Math.abs(duration(recap) - 13) < 0.2, `recap is ${duration(recap)}s`);
      const shown = clipThumbs(recap).filter((x) => x.t >= 4 && x.t <= 11).map((x) => ({ t: x.t - 3, v: x.v }));
      const b = align(shown, await recordingThumbs(lightest, 20.3, 10), 20.3);
      assert.equal(b?.offset, 0);
    }
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
