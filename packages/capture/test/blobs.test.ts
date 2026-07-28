import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BlobStore, hashContent } from "../src/store/blobs.ts";

async function tempStore(): Promise<{ store: BlobStore; root: string }> {
  const root = await mkdtemp(join(tmpdir(), "gr-blobs-"));
  return { store: new BlobStore(root), root };
}

test("hashContent is deterministic sha256 hex", () => {
  const a = hashContent(Buffer.from("golden retrievers"));
  const b = hashContent(Buffer.from("golden retrievers"));
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, hashContent(Buffer.from("golden retriever")));
});

test("put stores content and get round-trips it exactly", async () => {
  const { store, root } = await tempStore();
  const body = Buffer.from("<html>Still missing game # 2 stats</html>");
  const { hash, deduped } = await store.put(body);
  assert.equal(deduped, false);
  assert.deepEqual(await store.get(hash), body);
  await rm(root, { recursive: true, force: true });
});

test("put is content-addressed and deduplicates identical bytes", async () => {
  const { store, root } = await tempStore();
  const body = Buffer.from("identical bytes");
  const first = await store.put(body);
  const second = await store.put(body);
  assert.equal(first.hash, second.hash);
  assert.equal(first.deduped, false);
  assert.equal(second.deduped, true, "second put of identical bytes must dedupe");
  assert.equal(await store.count(), 1, "dedup must not create a second blob");
  await rm(root, { recursive: true, force: true });
});

test("get returns null for an unknown hash and has() reports correctly", async () => {
  const { store, root } = await tempStore();
  const absent = "0".repeat(64);
  assert.equal(await store.get(absent), null);
  assert.equal(await store.has(absent), false);
  const { hash } = await store.put(Buffer.from("present"));
  assert.equal(await store.has(hash), true);
  await rm(root, { recursive: true, force: true });
});

test("stored blobs are gzipped on disk, not plaintext", async () => {
  const { store, root } = await tempStore();
  const body = Buffer.from("x".repeat(5000));
  const { hash } = await store.put(body);
  const { readFile } = await import("node:fs/promises");
  const onDisk = await readFile(join(root, hash.slice(0, 2), `${hash}.gz`));
  assert.equal(onDisk[0], 0x1f, "gzip magic byte 1");
  assert.equal(onDisk[1], 0x8b, "gzip magic byte 2");
  assert.ok(onDisk.length < body.length, "compressible content must shrink on disk");
  await rm(root, { recursive: true, force: true });
});
