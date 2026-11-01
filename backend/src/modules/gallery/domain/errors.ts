// Typed errors the gallery domain can throw. routes.ts catches these and
// maps each to an HTTP status — same convention as
// modules/auth/domain/errors.ts.

import { LocalizedError } from "../../../i18n/index.js";

export class GalleryError extends LocalizedError {}

export class InvalidImageError extends GalleryError {
  constructor() {
    super("gallery.invalidImage");
  }
}

export class FileTooLargeError extends GalleryError {
  constructor(maxBytes: number) {
    super("gallery.fileTooLarge", { mb: Math.round(maxBytes / (1024 * 1024)) });
  }
}

export class ImageDimensionsTooLargeError extends GalleryError {
  constructor(maxDimension: number) {
    super("gallery.dimensionsTooLarge", { max: maxDimension });
  }
}

export class QuotaExceededError extends GalleryError {
  constructor(maxBytes: number) {
    super("gallery.quotaExceeded", { mb: Math.round(maxBytes / (1024 * 1024)) });
  }
}
