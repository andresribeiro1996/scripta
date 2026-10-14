import sharp, { type OutputInfo } from "sharp";

const MAX_INPUT_DIMENSION = 8000;
const FULL_MAX_DIMENSION = 1600;
const FULL_QUALITY = 85;
const THUMB_MAX_WIDTH = 600;
const THUMB_MAX_HEIGHT = 900;
const THUMB_QUALITY = 80;
const MIN_ASPECT_RATIO = 1.2;
const MAX_ASPECT_RATIO = 1.9;
const ISBNDB_PLACEHOLDER = { width: 200, height: 248 };
const CLASSIFY_MAX_DIMENSION = 400;
const CORNER_TOLERANCE = 32;
const EDGE_STEP = 15;
const EDGE_GAP = 2;
const EDGE_SHARE = 0.6;
const EDGE_SEARCH = 0.3;
const SHADOW_ROUGHNESS = 12;
const TRIM_THRESHOLD = 50;
const LIGHT_CANVAS_MEAN = 170;
const PHOTO_KEPT = 0.85;
const MIN_CROP_AREA = 0.3;
const FLAT_MIN_RATIO = 0.75;
const WHITE_CANVAS_MEAN = 235;
const CANVAS_KEPT = 0.97;
const BLANK_STDEV = 8;
const COLOR_SAMPLE_DIMENSION = 128;
const COLOR_MIN_SATURATION = 0.25;
const COLOR_MIN_VALUE = 0.15;
const COLOR_HUE_BINS = 12;
const HUE_BIN_OFFSET = 3 / COLOR_HUE_BINS;
const COLOR_MIN_SHARE = 0.01;

export interface EncodedCover {
  full: Buffer;
  thumb: Buffer;
  width: number;
  height: number;
  color: string | null;
}

async function decodedSize(input: Buffer): Promise<{ width: number; height: number } | null> {
  try {
    const metadata = await sharp(input).metadata();
    return metadata.width && metadata.height && metadata.format ? { width: metadata.width, height: metadata.height } : null;
  } catch {
    return null;
  }
}

export async function coverColor(input: Buffer): Promise<string | null> {
  let decoded: { data: Buffer; info: OutputInfo };
  try {
    decoded = await sharp(input, { limitInputPixels: MAX_INPUT_DIMENSION * MAX_INPUT_DIMENSION })
      .rotate()
      .flatten({ background: "#ffffff" })
      .toColourspace("srgb")
      .resize({ width: COLOR_SAMPLE_DIMENSION, height: COLOR_SAMPLE_DIMENSION, fit: "inside" })
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch {
    return null;
  }
  const { channels, width, height } = decoded.info;
  const weights = new Array<number>(COLOR_HUE_BINS).fill(0);
  const sums = Array.from({ length: COLOR_HUE_BINS }, () => [0, 0, 0]);
  for (let offset = 0; offset < width * height * channels; offset += channels) {
    const r = decoded.data[offset] ?? 0;
    const g = decoded.data[offset + 1] ?? 0;
    const b = decoded.data[offset + 2] ?? 0;
    const max = Math.max(r, g, b);
    const delta = max - Math.min(r, g, b);
    const saturation = max === 0 ? 0 : delta / max;
    const value = max / 255;
    if (saturation < COLOR_MIN_SATURATION || value < COLOR_MIN_VALUE) continue;
    const hue = max === r ? ((g - b) / delta + 6) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    const bin = Math.floor((((hue + HUE_BIN_OFFSET) % 6) / 6) * COLOR_HUE_BINS);
    const weight = saturation * value;
    weights[bin] = (weights[bin] ?? 0) + weight;
    const sum = sums[bin] ?? [0, 0, 0];
    sum[0] = (sum[0] ?? 0) + r * weight;
    sum[1] = (sum[1] ?? 0) + g * weight;
    sum[2] = (sum[2] ?? 0) + b * weight;
  }
  const heaviest = weights.reduce((best, weight, bin) => (weight > (weights[best] ?? 0) ? bin : best), 0);
  const total = weights[heaviest] ?? 0;
  if (total < COLOR_MIN_SHARE * width * height) return null;
  const mean = (sums[heaviest] ?? [0, 0, 0]).map((channel) => Math.round(channel / total).toString(16).padStart(2, "0"));
  return `#${mean.join("")}`;
}

export async function encodeCover(input: Buffer): Promise<EncodedCover | null> {
  const size = await decodedSize(input);
  if (!size || size.width > MAX_INPUT_DIMENSION || size.height > MAX_INPUT_DIMENSION) return null;
  try {
    const full = await sharp(input, { limitInputPixels: MAX_INPUT_DIMENSION * MAX_INPUT_DIMENSION })
      .rotate()
      .resize({ width: FULL_MAX_DIMENSION, height: FULL_MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
      .webp({ quality: FULL_QUALITY })
      .toBuffer({ resolveWithObject: true });
    const thumb = await sharp(full.data)
      .resize({ width: THUMB_MAX_WIDTH, height: THUMB_MAX_HEIGHT, fit: "inside", withoutEnlargement: true })
      .webp({ quality: THUMB_QUALITY })
      .toBuffer();
    return { full: full.data, thumb, width: full.info.width, height: full.info.height, color: await coverColor(thumb) };
  } catch {
    return null;
  }
}

export interface PublisherImage {
  kind: "cropped" | "flat";
  input: Buffer;
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function refineToBookEdges(luma: Float32Array, width: number, height: number, box: Box): Box {
  const at = (x: number, y: number) => luma[y * width + x] ?? 0;
  const columnIsEdge = (x: number, outward: -1 | 1) => {
    const neighbour = x + outward * EDGE_GAP;
    if (neighbour < 0 || neighbour >= width) return false;
    let strong = 0;
    for (let y = box.top; y <= box.bottom; y++) if (Math.abs(at(x, y) - at(neighbour, y)) >= EDGE_STEP) strong++;
    return strong >= EDGE_SHARE * (box.bottom - box.top + 1);
  };
  const rowIsEdge = (y: number, outward: -1 | 1) => {
    const neighbour = y + outward * EDGE_GAP;
    if (neighbour < 0 || neighbour >= height) return false;
    let strong = 0;
    for (let x = box.left; x <= box.right; x++) if (Math.abs(at(x, y) - at(x, neighbour)) >= EDGE_STEP) strong++;
    return strong >= EDGE_SHARE * (box.right - box.left + 1);
  };
  const roughness = (left: number, top: number, right: number, bottom: number) => {
    let total = 0;
    let count = 0;
    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) {
        total += Math.abs(at(Math.min(x + 1, width - 1), y) - at(x, y)) + Math.abs(at(x, Math.min(y + 1, height - 1)) - at(x, y));
        count++;
      }
    }
    return count === 0 ? 0 : total / count;
  };
  const firstEdge = (from: number, steps: number, direction: 1 | -1, isEdge: (value: number) => boolean) => {
    for (let step = 0; step <= steps; step++) if (isEdge(from + direction * step)) return from + direction * step;
    return null;
  };
  const reachX = Math.floor((box.right - box.left) * EDGE_SEARCH);
  const reachY = Math.floor((box.bottom - box.top) * EDGE_SEARCH);
  const left = firstEdge(box.left, reachX, 1, (x) => columnIsEdge(x, -1));
  const right = firstEdge(box.right, reachX, -1, (x) => columnIsEdge(x, 1));
  const top = firstEdge(box.top, reachY, 1, (y) => rowIsEdge(y, -1));
  const bottom = firstEdge(box.bottom, reachY, -1, (y) => rowIsEdge(y, 1));
  return {
    left: left !== null && roughness(box.left, box.top, left - 1, box.bottom) < SHADOW_ROUGHNESS ? left : box.left,
    right: right !== null && roughness(right + 1, box.top, box.right, box.bottom) < SHADOW_ROUGHNESS ? right : box.right,
    top: top !== null && roughness(box.left, box.top, box.right, top - 1) < SHADOW_ROUGHNESS ? top : box.top,
    bottom: bottom !== null && roughness(box.left, bottom + 1, box.right, box.bottom) < SHADOW_ROUGHNESS ? bottom : box.bottom,
  };
}

export async function classifyPublisherImage(input: Buffer): Promise<PublisherImage | null> {
  try {
    const decoded = await sharp(input, { limitInputPixels: MAX_INPUT_DIMENSION * MAX_INPUT_DIMENSION })
      .rotate()
      .flatten({ background: "#ffffff" })
      .toColourspace("srgb")
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { width, height, channels } = decoded.info;
    const rawOptions = { raw: { width, height, channels } };
    const small = await sharp(decoded.data, rawOptions)
      .resize({ width: CLASSIFY_MAX_DIMENSION, height: CLASSIFY_MAX_DIMENSION, fit: "inside" })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { width: smallWidth, height: smallHeight, channels: smallChannels } = small.info;
    const { channels: spread } = await sharp(small.data, { raw: { width: smallWidth, height: smallHeight, channels: smallChannels } }).stats();
    if (spread.every((channel) => channel.stdev < BLANK_STDEV)) return null;
    const pixel = (x: number, y: number): [number, number, number] => {
      const offset = (y * smallWidth + x) * smallChannels;
      return [small.data[offset] ?? 0, small.data[offset + 1] ?? 0, small.data[offset + 2] ?? 0];
    };
    const topLeft = pixel(0, 0);
    const corners = [topLeft, pixel(smallWidth - 1, 0), pixel(0, smallHeight - 1), pixel(smallWidth - 1, smallHeight - 1)];
    const uniform = [0, 1, 2].every((channel) => {
      const values = corners.map((corner) => corner[channel] ?? 0);
      return Math.max(...values) - Math.min(...values) <= CORNER_TOLERANCE;
    });
    const cornerMean = corners.flat().reduce((sum, value) => sum + value, 0) / 12;
    const [r, g, b] = topLeft;
    const trimmed = await sharp(decoded.data, rawOptions)
      .trim({ background: { r, g, b }, threshold: TRIM_THRESHOLD })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const keptWidth = trimmed.info.width / width;
    const keptHeight = trimmed.info.height / height;
    const photoOnCanvas = uniform && (keptWidth < PHOTO_KEPT || keptHeight < PHOTO_KEPT);
    if (photoOnCanvas && cornerMean >= LIGHT_CANVAS_MEAN) {
      const luma = new Float32Array(smallWidth * smallHeight);
      for (let i = 0; i < luma.length; i++) {
        const offset = i * smallChannels;
        luma[i] = 0.299 * (small.data[offset] ?? 0) + 0.587 * (small.data[offset + 1] ?? 0) + 0.114 * (small.data[offset + 2] ?? 0);
      }
      const scaleX = smallWidth / width;
      const scaleY = smallHeight / height;
      const trimLeft = -(trimmed.info.trimOffsetLeft ?? 0);
      const trimTop = -(trimmed.info.trimOffsetTop ?? 0);
      const book = refineToBookEdges(luma, smallWidth, smallHeight, {
        left: Math.floor(trimLeft * scaleX),
        top: Math.floor(trimTop * scaleY),
        right: Math.min(smallWidth - 1, Math.ceil((trimLeft + trimmed.info.width) * scaleX) - 1),
        bottom: Math.min(smallHeight - 1, Math.ceil((trimTop + trimmed.info.height) * scaleY) - 1),
      });
      const left = Math.round(book.left / scaleX);
      const top = Math.round(book.top / scaleY);
      const cropWidth = Math.min(width - left, Math.round((book.right + 1) / scaleX) - left);
      const cropHeight = Math.min(height - top, Math.round((book.bottom + 1) / scaleY) - top);
      const ratio = cropHeight / cropWidth;
      if (ratio < MIN_ASPECT_RATIO || ratio > MAX_ASPECT_RATIO || (cropWidth * cropHeight) / (width * height) < MIN_CROP_AREA) return null;
      const cropped = await sharp(decoded.data, rawOptions).extract({ left, top, width: cropWidth, height: cropHeight }).png().toBuffer();
      return { kind: "cropped", input: cropped };
    }
    if (photoOnCanvas && cornerMean < LIGHT_CANVAS_MEAN) return null;
    const ratio = height / width;
    if (ratio < FLAT_MIN_RATIO || ratio > MAX_ASPECT_RATIO) return null;
    if (uniform && cornerMean >= WHITE_CANVAS_MEAN && (keptWidth < CANVAS_KEPT || keptHeight < CANVAS_KEPT)) return null;
    return { kind: "flat", input };
  } catch {
    return null;
  }
}

export function isAcceptableCover(source: string, width: number, height: number): boolean {
  const ratio = height / width;
  if (ratio < MIN_ASPECT_RATIO || ratio > MAX_ASPECT_RATIO) return false;
  return !(source === "isbndb" && width === ISBNDB_PLACEHOLDER.width && height === ISBNDB_PLACEHOLDER.height);
}
