import type { DatabaseSync } from "node:sqlite";
import { createObjectStore } from "../../storage/createObjectStore.js";
import { openBooksDb } from "./adapters/sqlite/connection.js";
import { createSqliteBooksRepository } from "./adapters/sqlite/sqliteBooksRepository.js";
import { findByIdentity, lookupIdentity } from "./domain/normalize.js";
import type { BooksRepository } from "./domain/ports.js";
import { siblingCoverImageId } from "./domain/siblingCover.js";
import type { BookRow } from "./domain/types.js";

export function coverUrlFor(imageId: string, size: "file" | "thumb"): string {
  return createObjectStore().urlFor(`covers/${imageId}${size === "thumb" ? "-thumb" : ""}.webp`);
}

export interface PeekCachedCoverParams {
  isbn?: string | null;
  title?: string | null;
  author?: string | null;
}

let repo: BooksRepository | null = null;
let fallbackDb: DatabaseSync | null = null;

export function booksRepository(): BooksRepository {
  if (!repo) {
    fallbackDb = openBooksDb();
    repo = createSqliteBooksRepository(fallbackDb);
  }
  return repo;
}

export function useBooksRepository(next: BooksRepository): void {
  fallbackDb?.close();
  fallbackDb = null;
  repo = next;
}

function thumbUrlOf(book: BookRow | undefined): string | null {
  const imageId = book && (book.cover_image_id ?? siblingCoverImageId(booksRepository(), book));
  return imageId ? coverUrlFor(imageId, "thumb") : null;
}

export function peekCachedCoverUrl(params: PeekCachedCoverParams): string | null {
  const identity = lookupIdentity(params);
  return identity ? thumbUrlOf(findByIdentity(booksRepository(), identity)) : null;
}

export function peekCachedCoverUrls(params: PeekCachedCoverParams[]): Array<string | null> {
  const identities = params.map(lookupIdentity);
  const keys = new Set(identities.flatMap((identity) => (identity ? [identity.key, ...(identity.titleKey ? [identity.titleKey] : [])] : [])));
  if (keys.size === 0) return identities.map(() => null);
  const found = booksRepository().findBooksByKeys([...keys]);
  const byKey = { findBookByKey: (key: string) => found.get(key) };
  return identities.map((identity) => (identity ? thumbUrlOf(findByIdentity(byKey, identity)) : null));
}
