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

const MAX_INPUT_PIXELS = 16_000_000;
const CANVAS = { width: 1080, height: 1920 };

export class InvalidShareImageError extends Error {}
export class ShareVideoRenderError extends Error {}

export async function renderShareVideo(input: Buffer): Promise<Buffer> {
  if (input.length > MAX_SHARE_IMAGE_BYTES) throw new InvalidShareImageError("Image is too large.");

  let image: Buffer;
  try {
    const metadata = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
    if (metadata.format !== "png") throw new InvalidShareImageError("Send a PNG image.");
    const { data: corner } = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).extract({ left: 0, top: 0, width: 1, height: 1 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    image = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).resize(CANVAS.width, CANVAS.height, { fit: "contain", background: { r: corner[0], g: corner[1], b: corner[2] } }).png().toBuffer();
  } catch (error) {
    if (error instanceof InvalidShareImageError) throw error;
    throw new InvalidShareImageError("Send a valid PNG image.");
  }

  if (!ffmpegPath) throw new ShareVideoRenderError("Video rendering is unavailable on this server.");
  const scratch = await mkdtemp(join(tmpdir(), "tierlist-video-"));
  const source = join(scratch, "card.png");
  const output = join(scratch, "card.mp4");
  try {
    await writeFile(source, image);
    try {
      await execFileAsync(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y", "-loop", "1", "-framerate", "24", "-i", source, "-t", "6", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p", "-movflags", "+faststart", output], { timeout: 20_000, maxBuffer: 256_000 });
    } catch (error) {
      throw new ShareVideoRenderError("Couldn't render the video.", { cause: error });
    }
    const video = await readFile(output);
    if (video.length > 8 * 1024 * 1024) throw new ShareVideoRenderError("The video came out too large to send.");
    return video;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
