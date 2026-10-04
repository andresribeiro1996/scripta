import { findByIdentity, lookupIdentity, type BookIdentity, type BookLookup } from "./normalize.js";
import type { BooksRepository } from "./ports.js";
import type { BookRow } from "./types.js";

export function keysOf(repo: BooksRepository, identity: BookIdentity): string[] {
  const titleKey = identity.titleKey;
  const own = [identity.key, ...identity.aliasKeys];
  return titleKey && titleKey !== identity.key && !repo.findBookByKey(titleKey) ? [...own, titleKey] : own;
}

export function findExisting(repo: BooksRepository, identity: BookIdentity): BookRow | undefined {
  const direct = repo.findBookByKey(identity.key);
  if (direct) return direct;
  for (const alias of identity.aliasKeys) {
    const found = repo.findBookByKey(alias);
    if (found) {
      repo.addKey(identity.key, found.id);
      return found;
    }
  }
  const byTitle = findByIdentity(repo, identity);
  if (!byTitle || byTitle.isbn) return undefined;
  repo.addKey(identity.key, byTitle.id);
  return byTitle;
}

export function findOrCreateBook(repo: BooksRepository, lookup: BookLookup, createdAt: string): BookRow | null {
  const identity = lookupIdentity(lookup);
  if (!identity) return null;
  const existing = findExisting(repo, identity);
  if (!existing) return repo.createBook({ title: identity.title, author: identity.author, isbn: identity.isbn }, keysOf(repo, identity), createdAt);
  if (!existing.title && identity.title) {
    if (identity.titleKey) repo.addKey(identity.titleKey, existing.id);
    repo.fillIdentity(existing.id, identity.title, identity.author);
    return repo.getBook(existing.id) ?? existing;
  }
  return existing;
}
