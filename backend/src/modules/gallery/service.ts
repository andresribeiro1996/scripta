// Business logic for the gallery module. Depends only on the
// GalleryRepository/ImageBlobStore ports, not on SQLite or the
// filesystem directly — same reasoning as every other module's
// service.ts.
//
// Every upload goes through the same pipeline before it's ever trusted:
// size cap -> real-format sniff (via sharp reading the file's actual
// header, not the client-supplied MIME type or extension) -> dimension
// cap -> re-encode to a fixed output format at a fixed max size, which
// as a side effect strips ALL metadata (EXIF/GPS/ICC profiles — sharp
// only keeps that if you explicitly call .withMetadata(), which nothing
// here does) -> quota check against the real re-encoded size -> stored
// under a server-generated id, never the original filename.

import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { FileTooLargeError, ImageDimensionsTooLargeError, InvalidImageError, QuotaExceededError } from "./domain/errors.js";
import type { GalleryRepository, ImageBlobStore } from "./domain/ports.js";
import type { GalleryImage, GalleryImageRow } from "./domain/types.js";

// Personal/family-scale limits, not enterprise ones — see the README for
// the reasoning behind each. Plain constants rather than env vars: there's
// no real per-deployment reason to tune these, unlike the DB/storage
// *paths*, which env.ts does own.
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MB — comfortably fits a modern phone photo
export const MAX_USER_QUOTA_BYTES = 500 * 1024 * 1024; // 500 MB per account
export const MAX_INPUT_DIMENSION = 8000; // guards against decompression-bomb-style images (small on disk, huge decoded)
const OUTPUT_MAX_DIMENSION = 1600; // a book cover is never usefully bigger than this
const OUTPUT_QUALITY = 85;
const OUTPUT_MIME_TYPE = "image/webp";
const OUTPUT_EXTENSION = "webp";

function sanitizeFilename(raw: string): string {
  const base = raw.split(/[/\\]/).pop() ?? "image";
  const trimmed = base.trim().slice(0, 200);
  return trimmed || "image";
}

function toGalleryImage(row: GalleryImageRow, publicUrlFor: (id: string) => string): GalleryImage {
  return {
    id: row.id,
    filename: row.filename,
    mimeType: row.mime_type,
    width: row.width,
    height: row.height,
    byteSize: row.byte_size,
    createdAt: row.created_at,
    url: publicUrlFor(row.id)
  };
}

export interface GalleryService {
  listImages(userId: string): GalleryImage[];
  uploadImage(userId: string, buffer: Buffer, originalFilename: string): Promise<GalleryImage>;
  /** Returns false if no image with that id was owned by this user (a
   *  caller-facing 404, not a server error). */
  deleteImage(userId: string, id: string): boolean;
  /** No ownership check — see domain/ports.ts's getImageById for why:
   *  this backs the public GET /gallery/:id/file route. */
  getImageFile(id: string): { buffer: Buffer; mimeType: string } | null;
}

export function createGalleryService(repo: GalleryRepository, blobStore: ImageBlobStore, publicUrlFor: (id: string) => string): GalleryService {
  return {
    listImages(userId) {
      return repo.listImages(userId).map((row) => toGalleryImage(row, publicUrlFor));
    },

    async uploadImage(userId, buffer, originalFilename) {
      if (buffer.byteLength > MAX_UPLOAD_BYTES) throw new FileTooLargeError(MAX_UPLOAD_BYTES);

      // Reads the file's actual header, not the client-supplied MIME type
      // or the original filename's extension — this IS the "verify by
      // magic bytes, don't trust the extension" check. An unsupported or
      // corrupt/non-image file throws here.
      // (sharp's own type for this is only reachable as `sharp.Metadata`,
      // which — being a namespace member, not a value — doesn't survive
      // the default import above; letting it infer here is simpler than
      // fighting that.)
      let metadata;
      try {
        metadata = await sharp(buffer).metadata();
      } catch {
        throw new InvalidImageError();
      }
      if (!metadata.width || !metadata.height || !metadata.format) throw new InvalidImageError();
      if (metadata.width > MAX_INPUT_DIMENSION || metadata.height > MAX_INPUT_DIMENSION) {
        throw new ImageDimensionsTooLargeError(MAX_INPUT_DIMENSION);
      }

      // Coarse pre-check against the account's *current* usage, before
      // doing the (comparatively expensive) re-encode below, so an
      // already-over-quota account fails fast. Re-checked against the
      // real output size right after, since the re-encoded size isn't
      // known until the encode actually runs.
      const usedBytes = repo.totalBytesForUser(userId);
      if (usedBytes >= MAX_USER_QUOTA_BYTES) throw new QuotaExceededError(MAX_USER_QUOTA_BYTES);

      // .rotate() with no args applies the EXIF orientation tag before
      // that EXIF data is discarded below — otherwise a photo taken
      // sideways would render sideways forever once its orientation hint
      // is gone. No .withMetadata() call anywhere in this chain is what
      // actually strips EXIF/GPS/ICC — sharp's default is to drop it all.
      const encoded = await sharp(buffer)
        .rotate()
        .resize({ width: OUTPUT_MAX_DIMENSION, height: OUTPUT_MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
        .webp({ quality: OUTPUT_QUALITY })
        .toBuffer({ resolveWithObject: true });

      if (usedBytes + encoded.data.byteLength > MAX_USER_QUOTA_BYTES) throw new QuotaExceededError(MAX_USER_QUOTA_BYTES);

      const id = randomUUID();
      const row: GalleryImageRow = {
        id,
        user_id: userId,
        filename: sanitizeFilename(originalFilename),
        mime_type: OUTPUT_MIME_TYPE,
        extension: OUTPUT_EXTENSION,
        width: encoded.info.width,
        height: encoded.info.height,
        byte_size: encoded.data.byteLength,
        created_at: new Date().toISOString()
      };

      blobStore.save(userId, id, OUTPUT_EXTENSION, encoded.data);
      repo.insertImage(row);
      return toGalleryImage(row, publicUrlFor);
    },

    deleteImage(userId, id) {
      const row = repo.getOwnedImage(id, userId);
      if (!row) return false;
      repo.deleteImage(id, userId);
      blobStore.delete(row.user_id, row.id, row.extension);
      return true;
    },

    getImageFile(id) {
      const row = repo.getImageById(id);
      if (!row) return null;
      const buffer = blobStore.read(row.user_id, row.id, row.extension);
      if (!buffer) return null;
      return { buffer, mimeType: row.mime_type };
    }
  };
}
