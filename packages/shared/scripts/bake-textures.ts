import { writeFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";
import { random, seedOf } from "../src/readerCards/seed.js";

const SIZE = 64;
const wrap = (value: number) => ((Math.round(value) % SIZE) + SIZE) % SIZE;

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(pixels: Uint8Array): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0);
  header.writeUInt32BE(SIZE, 4);
  header[8] = 8;
  const rows = Buffer.alloc(SIZE * (SIZE + 1));
  for (let y = 0; y < SIZE; y++) rows.set(pixels.subarray(y * SIZE, (y + 1) * SIZE), y * (SIZE + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(rows, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

function fibres(next: () => number, count: number, shortest: number, longest: number, brightness: number): Uint8Array {
  const pixels = new Uint8Array(SIZE * SIZE);
  for (let i = 0; i < count; i++) {
    let x = next() * SIZE, y = next() * SIZE, angle = next() * Math.PI * 2;
    const bend = (next() - 0.5) * 0.2, length = shortest + next() * (longest - shortest), value = Math.round(brightness * (0.5 + next() * 0.5));
    for (let step = 0; step < length; step += 0.5) {
      const at = wrap(y) * SIZE + wrap(x);
      pixels[at] = Math.max(pixels[at]!, value);
      x += Math.cos(angle) * 0.5;
      y += Math.sin(angle) * 0.5;
      angle += bend;
    }
  }
  return pixels;
}

function clouds(next: () => number, cells: number): Uint8Array {
  const grid = Array.from({ length: cells * cells }, () => next());
  const at = (gx: number, gy: number) => grid[(((gy % cells) + cells) % cells) * cells + (((gx % cells) + cells) % cells)]!;
  const pixels = new Uint8Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const fx = (x / SIZE) * cells, fy = (y / SIZE) * cells, gx = Math.floor(fx), gy = Math.floor(fy), tx = fx - gx, ty = fy - gy;
    const top = at(gx, gy) * (1 - tx) + at(gx + 1, gy) * tx, bottom = at(gx, gy + 1) * (1 - tx) + at(gx + 1, gy + 1) * tx;
    pixels[y * SIZE + x] = Math.round((top * (1 - ty) + bottom * ty) * 255);
  }
  return pixels;
}

function speckles(next: () => number, count: number, smallest: number, largest: number): Uint8Array {
  const pixels = new Uint8Array(SIZE * SIZE).fill(255);
  for (let i = 0; i < count; i++) {
    const cx = next() * SIZE, cy = next() * SIZE, r = smallest + next() * (largest - smallest), reach = Math.ceil(r);
    for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) if (dx * dx + dy * dy <= r * r) pixels[wrap(cy + dy) * SIZE + wrap(cx + dx)] = 0;
  }
  return pixels;
}

const grain = (next: () => number) => Uint8Array.from({ length: SIZE * SIZE }, () => Math.round(255 * next() ** 2));
const blend = (a: Uint8Array, b: Uint8Array, t: number) => a.map((value, i) => Math.round(value * (1 - t) + b[i]! * t));
const make = (name: string) => random(seedOf(`texture:${name}`));
const vellum = make("vellum"), kraft = make("kraft");

const tiles: Record<string, Uint8Array> = {
  fibre: fibres(make("fibre"), 70, 4, 14, 255),
  vellum: blend(clouds(vellum, 4), clouds(vellum, 9), 0.4),
  kraft: blend(fibres(kraft, 140, 3, 10, 220), grain(kraft), 0.3),
  speckle: speckles(make("speckle"), 90, 0.6, 1.8),
  grain: grain(make("grain")),
};

const body = Object.entries(tiles).map(([name, pixels]) => `  ${name}: "data:image/png;base64,${png(pixels).toString("base64")}",`).join("\n");
writeFileSync(new URL("../src/readerCards/textures.ts", import.meta.url), `export const TEXTURE_SIZE = ${SIZE};\n\nexport const TEXTURES = {\n${body}\n} as const;\n\nexport type Texture = keyof typeof TEXTURES;\n`);
