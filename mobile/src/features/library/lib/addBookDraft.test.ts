import assert from "node:assert/strict";
import { test } from "node:test";
import type { GalleryImage } from "@scripta/shared";
import { ApiError } from "../../../core/apiClient.js";
import {
  abandonedUpload,
  coverAfterResult,
  coverStatusLabel,
  parsePages,
  replacedUpload,
  saveMayHaveLanded,
  uploadToDeleteOnExit,
  withDraftCover,
  type DraftCover
} from "./addBookDraft.js";

function image(id: string): GalleryImage {
  return { id, filename: `${id}.jpg`, mimeType: "image/jpeg", width: 400, height: 600, byteSize: 1000, createdAt: "2026-10-30T00:00:00Z", url: `https://img.example/${id}` };
}

const none: DraftCover = { kind: "none" };
const found: DraftCover = { kind: "found", url: "u" };
const upload = (id: string): DraftCover => ({ kind: "upload", image: image(id) });

test("coverAfterResult keeps a hand-chosen cover", () => {
  for (const current of [found, upload("A")]) {
    assert.equal(coverAfterResult(current, "x"), current);
    assert.equal(coverAfterResult(current, null), current);
  }
});

test("coverAfterResult replaces an empty or search cover", () => {
  assert.deepEqual(coverAfterResult(none, "x"), { kind: "search", url: "x" });
  assert.deepEqual(coverAfterResult({ kind: "search", url: "a" }, null), { kind: "none" });
});

test("replacedUpload names the upload being replaced", () => {
  const a = upload("A");
  assert.equal(replacedUpload(a, upload("B")), "A");
  assert.equal(replacedUpload(a, found), "A");
  assert.equal(replacedUpload(a, a), null);
  assert.equal(replacedUpload(none, upload("B")), null);
});

test("abandonedUpload after a failed save", () => {
  assert.equal(abandonedUpload(upload("A"), false), "A");
  assert.equal(abandonedUpload(upload("A"), true), null);
  assert.equal(abandonedUpload(found, false), null);
});

test("uploadToDeleteOnExit waits for an in-flight save", async () => {
  const a = upload("A");
  assert.equal(await uploadToDeleteOnExit(a, Promise.resolve(true)), null);
  assert.equal(await uploadToDeleteOnExit(a, Promise.resolve(false)), "A");
  assert.equal(await uploadToDeleteOnExit(a, null), "A");
  assert.equal(await uploadToDeleteOnExit(found, Promise.resolve(false)), null);
});

test("withDraftCover writes only hand-chosen covers", () => {
  const book = { title: "T" };
  assert.deepEqual(withDraftCover(book, upload("A")), { title: "T", _coverImageId: "A", _coverUrl: "https://img.example/A" });
  assert.deepEqual(withDraftCover(book, found), { title: "T", _coverUrl: "u", _coverImageId: null });
  for (const cover of [{ kind: "search", url: "s" } as const, none]) {
    const result = withDraftCover(book, cover);
    assert.equal("_coverUrl" in result, false);
    assert.equal("_coverImageId" in result, false);
  }
});

test("parsePages accepts positive whole numbers only", () => {
  assert.equal(parsePages("310"), 310);
  assert.equal(parsePages(" 42 "), 42);
  for (const text of ["", "0", "-3", "3.5", "310 pages"]) assert.equal(parsePages(text), null);
});

test("coverStatusLabel names each cover kind", () => {
  assert.equal(coverStatusLabel(none), "No cover yet");
  assert.equal(coverStatusLabel({ kind: "search", url: "s" }), "From search");
  assert.equal(coverStatusLabel(found), "Chosen");
  assert.equal(coverStatusLabel(upload("A")), "Uploaded");
});

test("a found cover overrides an uploaded cover already on the incoming record", () => {
  const result = withDraftCover({ title: "T", _coverImageId: "OLD" }, found);
  assert.equal(result._coverImageId, null);
  assert.equal(result._coverUrl, "u");
});

test("saveMayHaveLanded is false only for a permanent server rejection", () => {
  for (const status of [400, 404, 409]) assert.equal(saveMayHaveLanded(new ApiError(status, "no")), false);
  for (const status of [408, 429, 500, 503]) assert.equal(saveMayHaveLanded(new ApiError(status, "later")), true);
  assert.equal(saveMayHaveLanded(new TypeError("Network request failed")), true);
});
