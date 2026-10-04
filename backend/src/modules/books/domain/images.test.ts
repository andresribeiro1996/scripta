import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { classifyPublisherImage, encodeCover, isAcceptableCover } from "./images.js";

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

type Layer = { input: Buffer; left: number; top: number };

async function rectangle(width: number, height: number, background: string, left: number, top: number): Promise<Layer> {
  return { input: await sharp({ create: { width, height, channels: 3, background } }).png().toBuffer(), left, top };
}

async function circle(diameter: number, fill: string, left: number, top: number): Promise<Layer> {
  const svg = `<svg width="${diameter}" height="${diameter}"><circle cx="${diameter / 2}" cy="${diameter / 2}" r="${diameter / 2}" fill="${fill}"/></svg>`;
  return { input: await sharp(Buffer.from(svg)).png().toBuffer(), left, top };
}

function canvas(width: number, height: number, background: string, layers: Layer[]) {
  return sharp({ create: { width, height, channels: 3, background } }).composite(layers).png().toBuffer();
}

async function colourBlocks(width: number, height: number) {
  const columns = 8;
  const rows = 8;
  const layers: Layer[] = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const seed = row * columns + column + 1;
      const colour = `rgb(${(seed * 67) % 256},${(seed * 131) % 256},${(seed * 199) % 256})`;
      layers.push(await rectangle(width / columns, height / rows, colour, (column * width) / columns, (row * height) / rows));
    }
  }
  return canvas(width, height, "#000000", layers);
}

test("a book mock-up with a soft shadow on a white canvas is cropped to the book", async () => {
  const image = await canvas(2048, 2048, "#ffffff", [
    await rectangle(1180, 1680, "#e0e0e0", 434, 184),
    await rectangle(1100, 1600, "#2a6f97", 474, 224),
  ]);
  const result = await classifyPublisherImage(image);
  assert.ok(result);
  assert.equal(result.kind, "cropped");
  const { width, height } = await sharp(result.input).metadata();
  const ratio = height! / width!;
  assert.ok(ratio >= 1.2 && ratio <= 1.9);
});

test("a book centred on a landscape white canvas is cropped", async () => {
  const result = await classifyPublisherImage(await canvas(900, 600, "#ffffff", [await rectangle(365, 556, "#aa3322", 267, 22)]));
  assert.equal(result?.kind, "cropped");
});

test("a coin or mug on white is refused", async () => {
  assert.equal(await classifyPublisherImage(await canvas(900, 600, "#ffffff", [await circle(580, "#b08d3c", 160, 10)])), null);
});

test("a cover filled edge to edge is kept as it is", async () => {
  const image = await colourBlocks(2000, 2000);
  const result = await classifyPublisherImage(image);
  assert.equal(result?.kind, "flat");
  assert.equal(result?.input, image);
});

test("a cover with a border covering most of the image is kept as it is", async () => {
  const image = await canvas(2000, 2000, "#336699", [await rectangle(1950, 1950, "#cc7722", 25, 25)]);
  assert.equal((await classifyPublisherImage(image))?.kind, "flat");
});

test("a round badge on a white canvas is refused", async () => {
  assert.equal(await classifyPublisherImage(await canvas(500, 500, "#ffffff", [await circle(450, "#000000", 25, 25)])), null);
});

test("a white cover on a white canvas is not cropped down to its text block", async () => {
  const image = await canvas(2048, 2048, "#ffffff", [await rectangle(100, 60, "#222222", 974, 994)]);
  assert.equal(await classifyPublisherImage(image), null);
});

test("a landscape image is refused", async () => {
  assert.equal(await classifyPublisherImage(await colourBlocks(2000, 1000)), null);
});

test("a corrupt buffer is refused", async () => {
  assert.equal(await classifyPublisherImage(Buffer.from("<html>not an image</html>")), null);
});
