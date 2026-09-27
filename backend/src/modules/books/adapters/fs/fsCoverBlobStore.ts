// The filesystem implementation of the CoverBlobStore port — plain files
// on disk under COVERS_STORAGE_PATH. Flat, keyed only by `id` (no
// per-account subdirectory the way gallery's own fsImageBlobStore has one
// per user) — this cache has no owning account at all, it's shared by
// every account on this install.
//
// Same path-traversal non-issue as gallery's own adapter: the path is
// built ONLY from `id` (server-generated, randomUUID() in service.ts) and
// `extension` (one of a small fixed set service.ts controls) — nothing
// attacker-controlled in it at all.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CoverBlobStore } from "../../domain/ports.js";

function pathFor(root: string, id: string, extension: string): string {
  return join(root, `${id}.${extension}`);
}

export function createFsCoverBlobStore(root: string): CoverBlobStore {
  mkdirSync(root, { recursive: true });

  return {
    save(id, extension, bytes) {
      writeFileSync(pathFor(root, id, extension), bytes);
    },

    read(id, extension) {
      const path = pathFor(root, id, extension);
      if (!existsSync(path)) return null;
      return readFileSync(path);
    }
  };
}
