// Exercises the object-storage adapters against a real S3-protocol
// server (s3rver, in-process), not a mock of the SDK.
//
// That distinction matters: the failure modes worth catching here are
// request signing, path-style addressing, content types, how a missing
// key is signalled, and how the SDK's streaming body is drained — none of
// which a hand-written stub of S3Client would reproduce. A stub would
// have tested that this code calls the functions it calls.
//
// RESIDUAL GAP, stated plainly: s3rver is not Cloudflare R2. Providers
// differ in how they report a missing key (AWS returns 403 rather than
// 404 without ListBucket permission — handled in shared/s3/client.ts) and
// in their consistency guarantees. Before launch, run one real upload,
// read and delete against the actual bucket. These tests make that a
// smoke test rather than the first time the code has ever run.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import S3rver from "s3rver";

const BUCKET = "atmyshelf-test";
const PORT = 4569;

let dataDir: string;
let server: S3rver;

/** The adapters read their configuration from src/config/env.ts at import
 *  time, so the environment has to be set before those modules are
 *  loaded. Hence the dynamic imports inside the tests rather than static
 *  ones at the top. */
async function loadAdapters() {
  const { createS3ImageBlobStore } = await import("../src/modules/gallery/adapters/s3/s3ImageBlobStore.js");
  const { createS3CoverBlobStore } = await import("../src/modules/covers/adapters/s3/s3CoverBlobStore.js");
  return { createS3ImageBlobStore, createS3CoverBlobStore };
}

describe("object storage adapters", () => {
  before(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "s3rver-"));

    process.env.S3_BUCKET = BUCKET;
    process.env.S3_ENDPOINT = `http://127.0.0.1:${PORT}`;
    process.env.S3_REGION = "us-east-1";
    process.env.S3_ACCESS_KEY_ID = "S3RVER";
    process.env.S3_SECRET_ACCESS_KEY = "S3RVER";
    process.env.S3_FORCE_PATH_STYLE = "true";

    server = new S3rver({
      port: PORT,
      address: "127.0.0.1",
      silent: true,
      directory: dataDir,
      configureBuckets: [{ name: BUCKET, configs: [] }]
    });
    await server.run();
  });

  after(async () => {
    await server?.close();
    const { resetS3Client } = await import("../src/shared/s3/client.js");
    resetS3Client();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("round-trips an uploaded image byte-for-byte", async () => {
    const { createS3ImageBlobStore } = await loadAdapters();
    const store = createS3ImageBlobStore();

    // Deliberately binary, not text: a broken body-encoding path would
    // survive an ASCII round trip and corrupt real images.
    const bytes = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0xff, 0xfe, 0x01, 0x00, 0x89, 0x50, 0x4e, 0x47]);
    await store.save("user-1", "img-1", "webp", bytes);

    const read = await store.read("user-1", "img-1", "webp");
    assert.ok(read, "the image should be readable back");
    assert.equal(Buffer.compare(read, bytes), 0);
  });

  it("returns null for an image that was never uploaded", async () => {
    // A miss must be null, not a thrown error — service.ts maps null to a
    // 404 and anything thrown to a 500.
    const { createS3ImageBlobStore } = await loadAdapters();
    const store = createS3ImageBlobStore();

    assert.equal(await store.read("user-1", "does-not-exist", "webp"), null);
  });

  it("deletes an image, and reports the miss afterwards", async () => {
    const { createS3ImageBlobStore } = await loadAdapters();
    const store = createS3ImageBlobStore();

    await store.save("user-1", "img-2", "webp", Buffer.from("to be deleted"));
    assert.ok(await store.read("user-1", "img-2", "webp"));

    await store.delete("user-1", "img-2", "webp");
    assert.equal(await store.read("user-1", "img-2", "webp"), null);
  });

  it("does not throw when deleting something already gone", async () => {
    // The filesystem adapter uses rmSync({force:true}) for the same
    // reason: a row whose blob vanished still needs its row cleaned up.
    const { createS3ImageBlobStore } = await loadAdapters();
    const store = createS3ImageBlobStore();

    await assert.doesNotReject(() => store.delete("user-1", "never-existed", "webp"));
  });

  it("keeps two users' images separate even with identical ids", async () => {
    // Image ids are server-generated UUIDs so a collision is not expected,
    // but the key must be scoped by user regardless — the same lesson the
    // groups/murals primary keys taught.
    const { createS3ImageBlobStore } = await loadAdapters();
    const store = createS3ImageBlobStore();

    await store.save("alice", "same-id", "webp", Buffer.from("alice's image"));
    await store.save("bob", "same-id", "webp", Buffer.from("bob's image"));

    assert.equal((await store.read("alice", "same-id", "webp"))!.toString(), "alice's image");
    assert.equal((await store.read("bob", "same-id", "webp"))!.toString(), "bob's image");

    // Deleting one must not touch the other.
    await store.delete("alice", "same-id", "webp");
    assert.equal(await store.read("alice", "same-id", "webp"), null);
    assert.equal((await store.read("bob", "same-id", "webp"))!.toString(), "bob's image");
  });

  it("round-trips a cached cover", async () => {
    const { createS3CoverBlobStore } = await loadAdapters();
    const store = createS3CoverBlobStore();

    const bytes = Buffer.from([0x00, 0x01, 0x02, 0xfd, 0xfe, 0xff]);
    await store.save("cover-1", "webp", bytes);

    const read = await store.read("cover-1", "webp");
    assert.ok(read);
    assert.equal(Buffer.compare(read, bytes), 0);
  });

  it("returns null for a cover that was never cached", async () => {
    const { createS3CoverBlobStore } = await loadAdapters();
    const store = createS3CoverBlobStore();

    assert.equal(await store.read("never-resolved", "webp"), null);
  });

  it("keeps gallery and cover keys from colliding in one bucket", async () => {
    // Both stores can share a bucket; the prefixes are what keep an image
    // id and a cover id with the same value apart.
    const { createS3ImageBlobStore, createS3CoverBlobStore } = await loadAdapters();
    const images = createS3ImageBlobStore();
    const covers = createS3CoverBlobStore();

    await covers.save("shared-id", "webp", Buffer.from("the cover"));
    await images.save("user-1", "shared-id", "webp", Buffer.from("the image"));

    assert.equal((await covers.read("shared-id", "webp"))!.toString(), "the cover");
    assert.equal((await images.read("user-1", "shared-id", "webp"))!.toString(), "the image");
  });

  it("behaves the same as the filesystem adapter for the same operations", async () => {
    // Two adapters behind one port are only interchangeable if they
    // actually agree — the same claim the Postgres suite makes about the
    // database adapters.
    const { createS3ImageBlobStore } = await loadAdapters();
    const { createFsImageBlobStore } = await import("../src/modules/gallery/adapters/fs/fsImageBlobStore.js");

    const fsDir = mkdtempSync(join(tmpdir(), "fsblob-"));
    try {
      const s3 = createS3ImageBlobStore();
      const fs = createFsImageBlobStore(fsDir);
      const bytes = Buffer.from([1, 2, 3, 250, 251, 252]);

      for (const store of [s3, fs]) {
        assert.equal(await store.read("u", "parity", "webp"), null, "both miss before writing");
        await store.save("u", "parity", "webp", bytes);
        assert.equal(Buffer.compare((await store.read("u", "parity", "webp"))!, bytes), 0, "both round-trip");
        await store.delete("u", "parity", "webp");
        assert.equal(await store.read("u", "parity", "webp"), null, "both miss after deleting");
        await assert.doesNotReject(() => store.delete("u", "parity", "webp"), "both tolerate a double delete");
      }
    } finally {
      rmSync(fsDir, { recursive: true, force: true });
    }
  });
});
