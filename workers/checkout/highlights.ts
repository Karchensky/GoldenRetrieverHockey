/**
 * GET /highlights/<file> — a goal clip, out of the R2 bucket.
 *
 * The clips are the rink's footage, so they never enter the repository, which
 * is public; the daily job uploads them to R2 and commits only
 * `apps/web/data/highlights.json`, which says which clip belongs to which goal.
 * Video players fetch in ranges to seek, so a `Range` request is answered
 * with that range and a 206, not the whole file. Which names exist at all is
 * `highlight-name.ts`.
 */

import { HIGHLIGHT_PATH } from "./highlight-name";

export { isHighlight } from "./highlight-name";

export async function serveHighlight(request: Request, bucket: R2Bucket | undefined): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("GET only", { status: 405 });
  const key = HIGHLIGHT_PATH.exec(new URL(request.url).pathname)?.[1];
  // No bucket bound (a local `wrangler dev` without one) reads as not found, not as a crash.
  if (!key || !bucket) return new Response("Not found", { status: 404 });

  const object = await bucket.get(key, { range: request.headers, onlyIf: request.headers });
  if (!object) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  headers.set("Accept-Ranges", "bytes");
  // A clip is written once under a name that carries its own hash, so it is never reused.
  headers.set("Cache-Control", "public, max-age=31536000, immutable");

  // `onlyIf` failed: the browser's copy is current.
  if (!("body" in object)) return new Response(null, { status: 304, headers });

  const range = object.range as { offset?: number; length?: number } | undefined;
  if (range && request.headers.has("range")) {
    const offset = range.offset ?? 0;
    const length = range.length ?? object.size - offset;
    headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set("Content-Length", String(length));
    return new Response(request.method === "HEAD" ? null : object.body, { status: 206, headers });
  }
  headers.set("Content-Length", String(object.size));
  return new Response(request.method === "HEAD" ? null : object.body, { status: 200, headers });
}
