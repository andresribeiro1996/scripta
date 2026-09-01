// The object-storage implementation of the ImageBlobStore port — the
// sibling of adapters/fs/. service.ts is unchanged by this existing.
//
// This is what unpins the API from a single machine: uploaded images on
// local disk mean the container can only ever run in one place, exactly
// like the SQLite file did.
//
// Same path-traversal reasoning as the filesystem adapter: the key is
// built ONLY from `userId` (from a verified token), `id` (randomUUID() in
// service.ts) and `extension` (one of a small fixed set service.ts
// controls) — nothing attacker-controlled, and never the original
// uploaded filename.

import { deleteObject, getObject, putObject } from "../../../../shared/s3/client.js";
import type { ImageBlobStore } from "../../domain/ports.js";

/** Prefixed so gallery uploads and the cover cache can share one bucket
 *  without colliding, and so a lifecycle rule or a bulk delete can target
 *  one of them alone. */
function keyFor(userId: string, id: string, extension: string): string {
  return `gallery/${userId}/${id}.${extension}`;
}

export function createS3ImageBlobStore(): ImageBlobStore {
  return {
    async save(userId, id, extension, bytes) {
      // service.ts re-encodes every upload to webp before this is called,
      // so the content type is known rather than trusted from the client.
      await putObject(keyFor(userId, id, extension), bytes, `image/${extension}`);
    },

    async read(userId, id, extension) {
      return getObject(keyFor(userId, id, extension));
    },

    async delete(userId, id, extension) {
      await deleteObject(keyFor(userId, id, extension));
    }
  };
}
