import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { assertObjectKey, createFsObjectStore } from "./objectStore.js";

const id = "0b6f9c1e-3a4d-4e5f-8a7b-1c2d3e4f5a6b";
const root = await mkdtemp(join(tmpdir(), "object-store-"));
after(() => rm(root, { recursive: true, force: true }));
const store = createFsObjectStore(root, "http://api.test");

test("a put then get round-trips the bytes", async () => {
  await store.put(`covers/${id}.webp`, Buffer.from("hello"), "image/webp");
  assert.deepEqual(await store.get(`covers/${id}.webp`), Buffer.from("hello"));
});

test("get of a missing key returns null", async () => {
  assert.equal(await store.get(`gallery/${id}.webp`), null);
});

test("delete removes a stored key and resolves for a missing one", async () => {
  await store.put(`avatars/${id}.webp`, Buffer.from("x"), "image/webp");
  await store.delete(`avatars/${id}.webp`);
  assert.equal(await store.get(`avatars/${id}.webp`), null);
  await store.delete(`avatars/${id}.webp`);
});

test("urlFor points at the files route", () => {
  assert.equal(store.urlFor(`covers/${id}.webp`), `http://api.test/files/covers/${id}.webp`);
});

test("a non-ENOENT read error propagates", async () => {
  await store.put(`covers/${id}-thumb.webp`, Buffer.from("x"), "image/webp");
  await assert.rejects(createFsObjectStore(join(root, "covers", `${id}-thumb.webp`), "http://api.test").get(`covers/${id}.webp`));
});

test("assertObjectKey rejects traversal, unknown prefixes and other extensions", () => {
  assert.throws(() => assertObjectKey("covers/../x.webp"), /Invalid object key/);
  assert.throws(() => assertObjectKey(`other/${id}.webp`), /Invalid object key/);
  assert.throws(() => assertObjectKey(`covers/${id}.png`), /Invalid object key/);
  assert.doesNotThrow(() => assertObjectKey(`covers/${id}-thumb.webp`));
});

test("every store method validates the key", async () => {
  await assert.rejects(store.put("covers/../x.webp", Buffer.from("x"), "image/webp"), /Invalid object key/);
  await assert.rejects(store.get("covers/../x.webp"), /Invalid object key/);
  await assert.rejects(store.delete("covers/../x.webp"), /Invalid object key/);
  assert.throws(() => store.urlFor("covers/../x.webp"), /Invalid object key/);
});
