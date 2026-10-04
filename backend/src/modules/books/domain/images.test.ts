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

test("a blank square is refused whatever its colour", async () => {
  for (const colour of ["#ffffff", "#eeeeee", "#000000", "#ff0000"]) {
    assert.equal(await classifyPublisherImage(await canvas(800, 800, colour, [])), null);
  }
});

test("a blank square with a small logo on a light canvas is refused", async () => {
  assert.equal(await classifyPublisherImage(await canvas(800, 800, "#f4f4f4", [await rectangle(60, 40, "#444444", 370, 380)])), null);
});

test("a landscape image is refused", async () => {
  assert.equal(await classifyPublisherImage(await colourBlocks(2000, 1000)), null);
});

test("a corrupt buffer is refused", async () => {
  assert.equal(await classifyPublisherImage(Buffer.from("<html>not an image</html>")), null);
});

async function ratioOf(image: Buffer) {
  const { width, height } = await sharp(image).metadata();
  return height! / width!;
}

test("a transparent canvas around an opaque book is cropped", async () => {
  const book = await sharp({ create: { width: 1100, height: 1600, channels: 4, background: { r: 42, g: 111, b: 151, alpha: 1 } } }).png().toBuffer();
  const image = await sharp({ create: { width: 2048, height: 2048, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: book, left: 474, top: 224 }])
    .png()
    .toBuffer();
  const result = await classifyPublisherImage(image);
  assert.equal(result?.kind, "cropped");
  assert.ok(Math.abs((await ratioOf(result!.input)) - 1600 / 1100) < 0.01);
});

test("corners that differ by 15 are uniform and corners that differ by 40 are not", async () => {
  const book = await rectangle(1100, 1600, "#2a6f97", 474, 224);
  const slightly = await canvas(2048, 2048, "#ffffff", [await rectangle(60, 60, "#f0f0f0", 0, 0), book]);
  assert.equal((await classifyPublisherImage(slightly))?.kind, "cropped");
  const strongly = await canvas(2048, 2048, "#ffffff", [await rectangle(60, 60, "#d7d7d7", 0, 0), book]);
  assert.equal((await classifyPublisherImage(strongly))?.kind, "flat");
});

test("a saturated uniform canvas is a cover, not a photo canvas", async () => {
  const image = await canvas(2560, 2522, "rgb(228,6,19)", [await rectangle(1500, 2100, "#ffffff", 530, 211)]);
  assert.equal((await classifyPublisherImage(image))?.kind, "flat");
});

test("a shadow band stays outside the crop and a pale cover edge stays inside it", async () => {
  const shadowed = await canvas(2048, 2048, "#ffffff", [
    await rectangle(1400, 1300, "#d7d7d7", 324, 374),
    await rectangle(1000, 1300, "#2a6f97", 524, 374),
  ]);
  const shadowedResult = await classifyPublisherImage(shadowed);
  assert.equal(shadowedResult?.kind, "cropped");
  assert.ok(Math.abs((await ratioOf(shadowedResult!.input)) - 1.3) < 0.01);

  const pale = await canvas(2048, 2048, "#ffffff", [
    await rectangle(1000, 1500, "#bebebe", 524, 274),
    await rectangle(800, 900, "#222222", 624, 574),
  ]);
  const paleResult = await classifyPublisherImage(pale);
  assert.equal(paleResult?.kind, "cropped");
  assert.ok(Math.abs((await ratioOf(paleResult!.input)) - 1.5) < 0.01);
});

test("a crop that keeps too little of the canvas is refused even when its ratio is right", async () => {
  assert.equal(await classifyPublisherImage(await canvas(2048, 2048, "#ffffff", [await rectangle(100, 150, "#222222", 974, 949)])), null);
  assert.equal(await classifyPublisherImage(await canvas(1000, 1000, "#ffffff", [await rectangle(432, 648, "#2a6f97", 284, 176)])), null);
  assert.equal((await classifyPublisherImage(await canvas(1000, 1000, "#ffffff", [await rectangle(462, 693, "#2a6f97", 269, 153)])))?.kind, "cropped");
});

test("the crop is measured after the image is rotated upright", async () => {
  const stored = await sharp({ create: { width: 2048, height: 2048, channels: 3, background: "#ffffff" } })
    .composite([await rectangle(1600, 1100, "#2a6f97", 224, 474)])
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();
  const result = await classifyPublisherImage(stored);
  assert.equal(result?.kind, "cropped");
  assert.ok(Math.abs((await ratioOf(result!.input)) - 1600 / 1100) < 0.01);
});
