import type { BooksRepository } from "../domain/ports.js";
import { lookupIdentity } from "../domain/normalize.js";
import type { BookRow } from "../domain/types.js";
import type { SeedEntry } from "./rankedWorks.js";

export interface SeedResult {
  created: number;
  existing: number;
  invalid: number;
}

type SeedRepo = Pick<BooksRepository, "findBookByKey" | "createBook" | "addKey" | "fillIdentity">;

export function seedBook(input: { isbn: string; title: string; author: string }, repo: SeedRepo, now: () => Date): { outcome: "created" | "existing" | "invalid"; book?: BookRow } {
  const identity = lookupIdentity(input);
  if (!identity) return { outcome: "invalid" };
  const existing = repo.findBookByKey(identity.key);
  if (existing) {
    if (!existing.title && identity.title) {
      if (identity.titleKey && !repo.findBookByKey(identity.titleKey)) repo.addKey(identity.titleKey, existing.id);
      repo.fillIdentity(existing.id, identity.title, identity.author);
    }
    return { outcome: "existing", book: existing };
  }
  const { titleKey } = identity;
  const keys = titleKey && titleKey !== identity.key && !repo.findBookByKey(titleKey) ? [identity.key, titleKey] : [identity.key];
  return { outcome: "created", book: repo.createBook({ title: identity.title, author: identity.author, isbn: identity.isbn }, keys, now().toISOString()) };
}

export function seedCatalog(entries: SeedEntry[], repo: SeedRepo, now: () => Date): SeedResult {
  const result: SeedResult = { created: 0, existing: 0, invalid: 0 };
  for (const entry of entries) result[seedBook(entry, repo, now).outcome]++;
  return result;
}
