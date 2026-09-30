import { createObjectStore } from "../../storage/createObjectStore.js";
import { openBooksDb } from "./adapters/sqlite/connection.js";
import { createSqliteBooksRepository } from "./adapters/sqlite/sqliteBooksRepository.js";
import { findByIdentity, lookupIdentity } from "./domain/normalize.js";
import type { BooksRepository } from "./domain/ports.js";

export function coverUrlFor(imageId: string, size: "file" | "thumb"): string {
  return createObjectStore().urlFor(`covers/${imageId}${size === "thumb" ? "-thumb" : ""}.webp`);
}

export interface PeekCachedCoverParams {
  isbn?: string | null;
  title?: string | null;
  author?: string | null;
}

let repo: BooksRepository | null = null;

export function peekCachedCoverUrl(params: PeekCachedCoverParams): string | null {
  const identity = lookupIdentity(params);
  if (!identity) return null;
  repo ??= createSqliteBooksRepository(openBooksDb());
  const imageId = findByIdentity(repo, identity)?.cover_image_id;
  return imageId ? coverUrlFor(imageId, "thumb") : null;
}
