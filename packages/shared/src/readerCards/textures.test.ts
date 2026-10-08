import assert from "node:assert/strict";
import { test } from "node:test";
import { inflateSync } from "node:zlib";
import { TEXTURES, TEXTURE_SIZE } from "./textures.js";

const decode = (uri: string) => Buffer.from(uri.slice(uri.indexOf(",") + 1), "base64");

function pixels(png: Buffer): number[] {
  const parts: Buffer[] = [];
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at);
    if (png.toString("ascii", at + 4, at + 8) === "IDAT") parts.push(png.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const rows = inflateSync(Buffer.concat(parts));
  return Array.from({ length: TEXTURE_SIZE }, (_, y) => [...rows.subarray(y * (TEXTURE_SIZE + 1) + 1, (y + 1) * (TEXTURE_SIZE + 1))]).flat();
}

test("each texture is a small square grey PNG", () => {
  assert.deepEqual(Object.keys(TEXTURES).sort(), ["fibre", "grain", "kraft", "speckle", "vellum"]);
  for (const [name, uri] of Object.entries(TEXTURES)) {
    assert.match(uri, /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/, name);
    const png = decode(uri);
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], name);
    assert.equal(png.toString("ascii", 12, 16), "IHDR", name);
    assert.equal(png.readUInt32BE(16), TEXTURE_SIZE, name);
    assert.equal(png.readUInt32BE(20), TEXTURE_SIZE, name);
    assert.equal(png[24], 8, name);
    assert.equal(png[25], 0, name);
    assert.ok(png.length < 12_000, `${name} is ${png.length} bytes`);
  }
});

test("the speckle mask is mostly solid with real holes, so it reads on a phone", () => {
  const values = pixels(decode(TEXTURES.speckle));
  const holes = values.filter((value) => value < 64).length / values.length;
  assert.ok(holes > 0.03 && holes < 0.25, `holes ${holes}`);
  assert.ok(values.every((value) => value === 0 || value === 255));
});
