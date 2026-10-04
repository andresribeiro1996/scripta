import sharp from "sharp";

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
const CORNER_TOLERANCE = 12;
const TRIM_THRESHOLD = 50;
const PHOTO_KEPT = 0.85;
const MIN_CROP_AREA = 0.3;
const FLAT_MIN_RATIO = 0.75;
const WHITE_CANVAS_MEAN = 235;
const CANVAS_KEPT = 0.97;

export interface EncodedCover {
  full: Buffer;
  thumb: Buffer;
  width: number;
  height: number;
}

async function decodedSize(input: Buffer): Promise<{ width: number; height: number } | null> {
  try {
    const metadata = await sharp(input).metadata();
    return metadata.width && metadata.height && metadata.format ? { width: metadata.width, height: metadata.height } : null;
  } catch {
    return null;
  }
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
    return { full: full.data, thumb, width: full.info.width, height: full.info.height };
  } catch {
    return null;
  }
}

export interface PublisherImage {
  kind: "cropped" | "flat";
  input: Buffer;
}

export async function classifyPublisherImage(input: Buffer): Promise<PublisherImage | null> {
  try {
    const metadata = await sharp(input).metadata();
    if (!metadata.width || !metadata.height) return null;
    const turned = (metadata.orientation ?? 1) >= 5;
    const width = turned ? metadata.height : metadata.width;
    const height = turned ? metadata.width : metadata.height;
    const base = sharp(input, { limitInputPixels: MAX_INPUT_DIMENSION * MAX_INPUT_DIMENSION })
      .rotate()
      .flatten({ background: "#ffffff" });
    const small = await base
      .clone()
      .resize({ width: CLASSIFY_MAX_DIMENSION, height: CLASSIFY_MAX_DIMENSION, fit: "inside" })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { width: smallWidth, height: smallHeight, channels } = small.info;
    const pixel = (x: number, y: number): [number, number, number] => {
      const offset = (y * smallWidth + x) * channels;
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
    const trimmed = await base.clone().trim({ background: { r, g, b }, threshold: TRIM_THRESHOLD }).png().toBuffer({ resolveWithObject: true });
    const keptWidth = trimmed.info.width / width;
    const keptHeight = trimmed.info.height / height;
    if (uniform && (keptWidth < PHOTO_KEPT || keptHeight < PHOTO_KEPT)) {
      const ratio = trimmed.info.height / trimmed.info.width;
      if (ratio < MIN_ASPECT_RATIO || ratio > MAX_ASPECT_RATIO || keptWidth * keptHeight < MIN_CROP_AREA) return null;
      return { kind: "cropped", input: trimmed.data };
    }
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
