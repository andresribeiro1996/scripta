// Typed errors the gallery domain can throw. routes.ts catches these and
// maps each to an HTTP status — same convention as
// modules/auth/domain/errors.ts.

export class GalleryError extends Error {}

export class InvalidImageError extends GalleryError {
  constructor() {
    super("That file isn't a valid image (or is corrupted) — only JPEG, PNG, and WebP are supported.");
  }
}

export class FileTooLargeError extends GalleryError {
  constructor(maxBytes: number) {
    super(`Files can't be larger than ${Math.round(maxBytes / (1024 * 1024))} MB.`);
  }
}

export class ImageDimensionsTooLargeError extends GalleryError {
  constructor(maxDimension: number) {
    super(`Image dimensions can't exceed ${maxDimension}×${maxDimension}px.`);
  }
}

export class QuotaExceededError extends GalleryError {
  constructor(maxBytes: number) {
    super(`This would put you over your ${Math.round(maxBytes / (1024 * 1024))} MB image storage limit — delete something first.`);
  }
}
