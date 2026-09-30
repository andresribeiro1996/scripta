import { env } from "../../config/env.js";
import { openBooksDb } from "./adapters/sqlite/connection.js";
import { createSqliteBooksRepository } from "./adapters/sqlite/sqliteBooksRepository.js";
import { findByIdentity, lookupIdentity } from "./domain/normalize.js";
import type { BooksRepository } from "./domain/ports.js";

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
  return imageId ? `${env.PUBLIC_API_URL}/covers/cached/${imageId}/thumb` : null;
}
