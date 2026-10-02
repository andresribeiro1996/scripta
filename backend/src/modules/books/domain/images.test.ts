import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { encodeCover, isAcceptableCover } from "./images.js";

function jpeg(width: number, height: number) {
  return sharp({ create: { width, height, channels: 3, background: "#886644" } }).jpeg().toBuffer();
}

test("a large cover is encoded as a 1600px full image and a 600x900 thumbnail", async () => {
  const encoded = await encodeCover(await jpeg(2000, 3000));
  assert.ok(encoded);
  assert.equal(encoded.width, 1067);
  assert.equal(encoded.height, 1600);
  const full = await sharp(encoded.full).metadata();
  const thumb = await sharp(encoded.thumb).metadata();
  assert.equal(full.format, "webp");
  assert.equal(thumb.format, "webp");
  assert.equal(thumb.width, 600);
  assert.equal(thumb.height, 900);
});

test("the thumbnail of a rotated cover keeps its orientation", async () => {
  const rotated = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: "#886644" } }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const encoded = await encodeCover(rotated);
  assert.ok(encoded);
  assert.equal(encoded.width, 1067);
  assert.equal(encoded.height, 1600);
  const thumb = await sharp(encoded.thumb).metadata();
  assert.equal(thumb.width, 600);
  assert.equal(thumb.height, 900);
});

test("a small cover is never enlarged", async () => {
  const encoded = await encodeCover(await jpeg(300, 460));
  assert.ok(encoded);
  assert.equal(encoded.width, 300);
  assert.equal(encoded.height, 460);
  assert.equal((await sharp(encoded.thumb).metadata()).width, 300);
});

test("non-images and oversized images are refused", async () => {
  assert.equal(await encodeCover(Buffer.from("<html>not an image</html>")), null);
  assert.equal(await encodeCover(await jpeg(8001, 10)), null);
});

test("a JPEG truncated after its header decodes metadata but fails to encode, and is refused", async () => {
  const full = await jpeg(2000, 3000);
  const truncated = full.subarray(0, Math.floor(full.byteLength / 2));
  assert.equal(await encodeCover(truncated), null);
});

test("only portrait covers are acceptable", () => {
  assert.equal(isAcceptableCover("apple", 900, 1400), true);
  assert.equal(isAcceptableCover("apple", 500, 500), false);
  assert.equal(isAcceptableCover("isbndb", 1030, 773), false);
  assert.equal(isAcceptableCover("openlibrary", 100, 400), false);
});

test("ISBNdb's 200x248 placeholder is refused, the same size elsewhere is not", () => {
  assert.equal(isAcceptableCover("isbndb", 200, 248), false);
  assert.equal(isAcceptableCover("openlibrary", 200, 248), true);
});
