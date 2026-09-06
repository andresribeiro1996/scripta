// The filesystem implementation of the AvatarBlobStore port — plain files
// under AVATAR_STORAGE_PATH, one subdirectory per account. Mirrors
// modules/gallery/adapters/fs/fsImageBlobStore.ts (deliberately not shared
// with it — module isolation, see backend/README).
//
// Paths are built ONLY from `userId` and `avatarId` (both server-generated)
// with a fixed extension — never from user input. That's the path-traversal
// defense, same as the gallery store.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AvatarBlobStore } from "../../domain/ports.js";

function pathFor(root: string, userId: string, avatarId: string): string {
  return join(root, userId, `${avatarId}.webp`);
}

export function createFsAvatarBlobStore(root: string): AvatarBlobStore {
  return {
    save(userId, avatarId, bytes) {
      mkdirSync(join(root, userId), { recursive: true });
      writeFileSync(pathFor(root, userId, avatarId), bytes);
    },

    read(userId, avatarId) {
      const path = pathFor(root, userId, avatarId);
      if (!existsSync(path)) return null;
      return readFileSync(path);
    },

    delete(userId, avatarId) {
      // force: true — clearing a row whose file is already gone shouldn't
      // block the DB cleanup, same reasoning as the gallery store.
      rmSync(pathFor(root, userId, avatarId), { force: true });
    }
  };
}
