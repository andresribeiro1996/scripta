import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import sharp from "sharp";

const scratch = mkdtempSync(join(tmpdir(), "gallery-service-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { createSqliteGalleryRepository } = await import("./adapters/sqlite/sqliteGalleryRepository.js");
const { createGalleryService, deleteAllGalleryImages } = await import("./service.js");

const schema = readFileSync(new URL("./adapters/sqlite/schema.sql", import.meta.url), "utf8");
const publicUrlFor = (id: string) => `https://images.test/gallery/${id}.webp`;

function makeService(blobs: Partial<Parameters<typeof createGalleryService>[1]> = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(schema);
  const repo = createSqliteGalleryRepository(db);
  const events: string[] = [];
  const saved = new Map<string, Buffer>();
  const store = {
    save: async (id: string, bytes: Buffer) => {
      events.push(`save ${id}`);
      saved.set(id, bytes);
    },
    delete: async (id: string) => {
      events.push(`delete ${id}`);
      saved.delete(id);
    },
    ...blobs
  };
  return { repo, store, saved, events, service: createGalleryService(repo, store, publicUrlFor) };
}

const png = () => sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer();

test("an upload stores the blob under the image id and returns the public url", async () => {
  const { service, saved } = makeService();
  const image = await service.uploadImage("u1", await png(), "a.png");
  assert.ok(saved.has(image.id));
  assert.equal(image.url, publicUrlFor(image.id));
  assert.equal(service.listImages("u1").length, 1);
});

test("an upload whose save rejects inserts no row", async () => {
  const { service } = makeService({ save: async () => { throw new Error("r2 down"); } });
  await assert.rejects(async () => service.uploadImage("u1", await png(), "a.png"), /r2 down/);
  assert.equal(service.listImages("u1").length, 0);
});

test("deleteImage deletes the blob and then the row", async () => {
  const { service, repo, events } = makeService();
  const image = await service.uploadImage("u1", await png(), "a.png");
  assert.equal(await service.deleteImage("u1", image.id), true);
  assert.deepEqual(events.slice(-1), [`delete ${image.id}`]);
  assert.equal(repo.getOwnedImage(image.id, "u1"), undefined);
});

test("deleteImage whose blob delete rejects keeps the row", async () => {
  const { service, repo } = makeService({ delete: async () => { throw new Error("r2 down"); } });
  const image = await service.uploadImage("u1", await png(), "a.png");
  await assert.rejects(service.deleteImage("u1", image.id), /r2 down/);
  assert.ok(repo.getOwnedImage(image.id, "u1"));
});

test("deleteImage returns false for an image the user does not own", async () => {
  const { service, events } = makeService();
  const image = await service.uploadImage("u1", await png(), "a.png");
  assert.equal(await service.deleteImage("u2", image.id), false);
  assert.equal(events.some((event) => event.startsWith("delete")), false);
});

test("erasing an account deletes every blob before the rows", async () => {
  const { service, repo, store, events } = makeService();
  const first = await service.uploadImage("u1", await png(), "a.png");
  const second = await service.uploadImage("u1", await png(), "b.png");
  const other = await service.uploadImage("u2", await png(), "c.png");
  events.length = 0;
  const rowsAtDelete: number[] = [];
  const observing = { ...store, delete: async (id: string) => { rowsAtDelete.push(repo.listImages("u1").length); await store.delete(id); } };
  await deleteAllGalleryImages(repo, observing, "u1");
  assert.deepEqual(events.sort(), [`delete ${first.id}`, `delete ${second.id}`].sort());
  assert.deepEqual(rowsAtDelete, [2, 2]);
  assert.equal(repo.listImages("u1").length, 0);
  assert.equal(repo.listImages("u2")[0]?.id, other.id);
});

test("erasing an account whose blob delete rejects leaves the rows", async () => {
  const { service, repo, store } = makeService();
  await service.uploadImage("u1", await png(), "a.png");
  await service.uploadImage("u1", await png(), "b.png");
  const failing = { ...store, delete: async () => { throw new Error("r2 down"); } };
  await assert.rejects(deleteAllGalleryImages(repo, failing, "u1"), /r2 down/);
  assert.equal(repo.listImages("u1").length, 2);
});
