// The object-storage implementation of the CoverBlobStore port — the
// sibling of adapters/fs/. See gallery's own s3ImageBlobStore for the
// reasoning; this cache is the same problem without the per-account
// subdivision, since resolved covers are global to the install.

import { getObject, putObject } from "../../../../shared/s3/client.js";
import type { CoverBlobStore } from "../../domain/ports.js";

function keyFor(id: string, extension: string): string {
  return `covers/${id}.${extension}`;
}

export function createS3CoverBlobStore(): CoverBlobStore {
  return {
    async save(id, extension, bytes) {
      await putObject(keyFor(id, extension), bytes, `image/${extension}`);
    },

    async read(id, extension) {
      return getObject(keyFor(id, extension));
    }
  };
}
