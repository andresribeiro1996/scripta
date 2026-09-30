import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";

const execFileAsync = promisify(execFile);
const ffmpegPath = createRequire(import.meta.url)("ffmpeg-static") as string | null;
export const MAX_SHARE_IMAGE_BYTES = 4 * 1024 * 1024;

export class InvalidShareImageError extends Error {}

export async function renderShareVideo(input: Buffer): Promise<Buffer> {
  if (input.length > MAX_SHARE_IMAGE_BYTES) throw new InvalidShareImageError("Image is too large.");

  let image: Buffer;
  try {
    const metadata = await sharp(input, { limitInputPixels: 4_000_000 }).metadata();
    if (metadata.format !== "png" || !metadata.width || !metadata.height || metadata.width * metadata.height > 4_000_000 || Math.abs(metadata.width / metadata.height - 9 / 16) > 0.02) {
      throw new InvalidShareImageError("Send a 9:16 PNG image.");
    }
    image = await sharp(input, { limitInputPixels: 4_000_000 }).resize(1080, 1920, { fit: "fill" }).png().toBuffer();
  } catch (error) {
    if (error instanceof InvalidShareImageError) throw error;
    throw new InvalidShareImageError("Send a valid PNG image.");
  }

  if (!ffmpegPath) throw new Error("FFmpeg is not installed.");
  const scratch = await mkdtemp(join(tmpdir(), "tierlist-video-"));
  const source = join(scratch, "card.png");
  const output = join(scratch, "card.mp4");
  try {
    await writeFile(source, image);
    await execFileAsync(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y", "-loop", "1", "-framerate", "24", "-i", source, "-t", "6", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p", "-movflags", "+faststart", output], { timeout: 20_000, maxBuffer: 256_000 });
    const video = await readFile(output);
    if (video.length > 8 * 1024 * 1024) throw new Error("Share video exceeded the size limit.");
    return video;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
