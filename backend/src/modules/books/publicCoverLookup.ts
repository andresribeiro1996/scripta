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

export function booksRepository(): BooksRepository {
  return (repo ??= createSqliteBooksRepository(openBooksDb()));
}

export function peekCachedCoverUrl(params: PeekCachedCoverParams): string | null {
  const identity = lookupIdentity(params);
  if (!identity) return null;
  const imageId = findByIdentity(booksRepository(), identity)?.cover_image_id;
  return imageId ? coverUrlFor(imageId, "thumb") : null;
}

export function peekCachedCoverUrls(params: PeekCachedCoverParams[]): Array<string | null> {
  const identities = params.map(lookupIdentity);
  const keys = new Set(identities.flatMap((identity) => (identity ? [identity.key, ...(identity.titleKey ? [identity.titleKey] : [])] : [])));
  if (keys.size === 0) return identities.map(() => null);
  const found = booksRepository().findBooksByKeys([...keys]);
  const byKey = { findBookByKey: (key: string) => found.get(key) };
  return identities.map((identity) => {
    const imageId = identity ? findByIdentity(byKey, identity)?.cover_image_id : null;
    return imageId ? coverUrlFor(imageId, "thumb") : null;
  });
}

export function peekWorkId(params: PeekCachedCoverParams): string | null {
  const identity = lookupIdentity(params);
  if (!identity) return null;
  const workId = findByIdentity(booksRepository(), identity)?.work_id;
  return workId ? booksRepository().resolveWorkId(workId) : null;
}

export function resolveWorkId(workId: string): string | null {
  return booksRepository().resolveWorkId(workId);
}
