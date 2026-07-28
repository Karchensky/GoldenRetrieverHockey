/**
 * OPT-IN dev-only build directory. Unset — which is every build, every deploy
 * and every ordinary `npm run dev` — this is absent and the config below is
 * byte-for-byte what it always was.
 *
 * It exists because two or more `next dev` servers pointed at this same app
 * SHARE .next, and in particular share app-paths-manifest.json: whichever
 * server compiled last rewrites it, and every route the other servers had
 * compiled starts returning 404 on a source tree that is perfectly fine. That
 * is a different failure from the build-during-dev one the note below records,
 * and the note's objections do not apply to it — nothing here is set during a
 * build, so `output: "export"` still lands in out/ exactly as before.
 *
 *   NEXT_DIST_DIR=.next-icehouse npx next dev apps/web -p 3300
 */
const devDistDir = process.env.NEXT_DIST_DIR;

/** @type {import('next').NextConfig} */
export default {
  // Static export. There is no database and no runtime: the whole archive is a
  // build step's output, so it cannot break because a service is down, and it
  // will still serve in ten years when the next platform migration eats
  // somebody else's history. That is the entire thesis of this project.
  output: "export",
  images: { unoptimized: true },
  ...(devDistDir ? { distDir: devDistDir } : {}),

  // NO distDir OVERRIDE. It was here; it did not work; it made things worse.
  //
  // The intent was to stop `next build` corrupting a running `next dev`. Two
  // measurements killed it. First, `next build` writes the configured distDir
  // AND STILL WRITES .next, from a clean tree, every time — so the race it was
  // added to prevent happened anyway. Second, `output: "export"` follows
  // distDir, so the site stopped landing in out/ and started landing in
  // .next-build/, which is not where any host looks for a static export. A
  // mitigation that does not mitigate, in exchange for putting the deploy
  // artifact somewhere nobody would find it.
  //
  // The rule is the boring one and it is written in docs/BACKLOG.md: DO NOT
  // BUILD WHILE DEV IS RUNNING. If you do, dev starts serving 500s with
  // "Cannot find module './383.js'" — the number rotates, it survives a
  // refresh, and the source is fine the whole time. Stop the dev server.
};
