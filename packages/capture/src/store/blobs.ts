import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { mkdir, readFile, writeFile, rename, readdir } from "node:fs/promises";
import { join } from "node:path";

/** sha256 hex of a buffer. The content address. */
export function hashContent(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Content-addressed, gzipped blob store: <root>/<hash[0:2]>/<hash>.gz
 *
 * Plain gzip files with no index and no database, so the archive stays
 * readable by any tool, forever, with no dependency on this codebase.
 */
export class BlobStore {
  // Node's strip-only type stripping (--experimental-strip-types, the
  // default under `node --test`) does not support TypeScript parameter
  // properties, so the field is declared and assigned explicitly instead of
  // `constructor(private readonly root: string) {}`. Public signature and
  // behavior are unchanged.
  private readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  path(hash: string): string {
    return join(this.root, hash.slice(0, 2), `${hash}.gz`);
  }

  async has(hash: string): Promise<boolean> {
    try {
      await readFile(this.path(hash));
      return true;
    } catch {
      return false;
    }
  }

  /** Store bytes. Returns the content address and whether it already existed. */
  async put(buf: Buffer): Promise<{ hash: string; deduped: boolean }> {
    const hash = hashContent(buf);
    const dest = this.path(hash);
    if (await this.has(hash)) return { hash, deduped: true };

    await mkdir(join(this.root, hash.slice(0, 2)), { recursive: true });
    // Write to a temp file then rename: rename is atomic, so a crash can
    // never leave a partial blob at its content address.
    const tmp = `${dest}.${process.pid}.tmp`;
    await writeFile(tmp, gzipSync(buf));
    await rename(tmp, dest);
    return { hash, deduped: false };
  }

  async get(hash: string): Promise<Buffer | null> {
    try {
      return gunzipSync(await readFile(this.path(hash)));
    } catch {
      return null;
    }
  }

  /** Number of distinct blobs stored. */
  async count(): Promise<number> {
    let n = 0;
    let shards: string[];
    try {
      shards = await readdir(this.root);
    } catch {
      return 0;
    }
    for (const shard of shards) {
      try {
        const files = await readdir(join(this.root, shard));
        n += files.filter((f) => f.endsWith(".gz")).length;
      } catch {
        // not a directory; ignore
      }
    }
    return n;
  }
}
