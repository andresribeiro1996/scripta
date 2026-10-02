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

export function isAcceptableCover(source: string, width: number, height: number): boolean {
  const ratio = height / width;
  if (ratio < MIN_ASPECT_RATIO || ratio > MAX_ASPECT_RATIO) return false;
  return !(source === "isbndb" && width === ISBNDB_PLACEHOLDER.width && height === ISBNDB_PLACEHOLDER.height);
}
