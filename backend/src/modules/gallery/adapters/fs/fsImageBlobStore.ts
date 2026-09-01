// The filesystem implementation of the ImageBlobStore port — plain files
// on disk under GALLERY_STORAGE_PATH, one subdirectory per account.
//
// Paths are built ONLY from `userId` and `id` (both server-generated:
// userId from a verified token, id from randomUUID() in service.ts) and
// `extension` (one of a small fixed set service.ts controls, never
// derived from user input) — never from the original uploaded filename.
// That's the actual path-traversal defense here, not any sanitization:
// there's simply nothing attacker-controlled in the path at all.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ImageBlobStore } from "../../domain/ports.js";

function pathFor(root: string, userId: string, id: string, extension: string): string {
  return join(root, userId, `${id}.${extension}`);
}

// Declared async to satisfy the port; nothing here awaits, since node:fs's
// sync API is what this adapter uses. See domain/ports.ts.
export function createFsImageBlobStore(root: string): ImageBlobStore {
  return {
    async save(userId, id, extension, bytes) {
      const path = pathFor(root, userId, id, extension);
      mkdirSync(join(root, userId), { recursive: true });
      writeFileSync(path, bytes);
    },

    async read(userId, id, extension) {
      const path = pathFor(root, userId, id, extension);
      if (!existsSync(path)) return null;
      return readFileSync(path);
    },

    async delete(userId, id, extension) {
      const path = pathFor(root, userId, id, extension);
      // force: true — deleting a row whose file is already gone (e.g. a
      // previous delete that saved the DB write but crashed before this)
      // shouldn't throw and block the DB row from being cleaned up too.
      rmSync(path, { force: true });
    }
  };
}
