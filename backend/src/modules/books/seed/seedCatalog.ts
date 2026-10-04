import type { BooksRepository } from "../domain/ports.js";
import { editionLanguage, lookupIdentity } from "../domain/normalize.js";
import type { BookCreator, BookRow } from "../domain/types.js";
import type { SeedEntry } from "./rankedWorks.js";

export interface SeedResult {
  created: number;
  existing: number;
  invalid: number;
}

type SeedRepo = Pick<BooksRepository, "findBookByKey" | "createBook" | "addKey" | "fillIdentity" | "setWorkKey" | "setLanguage">;
type SeedInput = Pick<SeedEntry, "isbn" | "title" | "author"> & Partial<Pick<SeedEntry, "workKey" | "languages" | "lang">>;

export function seedBook(input: SeedInput, repo: SeedRepo, now: () => Date, createdBy?: BookCreator): { outcome: "created" | "existing" | "invalid"; book?: BookRow } {
  const identity = lookupIdentity(input);
  if (!identity) return { outcome: "invalid" };
  const language = editionLanguage(input.languages?.length ? input.languages : input.lang ? [input.lang] : [], input.isbn);
  const existing = repo.findBookByKey(identity.key);
  if (existing) {
    repo.setWorkKey(existing.id, input.workKey);
    repo.setLanguage(existing.id, language);
    if (!existing.title && identity.title) {
      if (identity.titleKey && !repo.findBookByKey(identity.titleKey)) repo.addKey(identity.titleKey, existing.id);
      repo.fillIdentity(existing.id, identity.title, identity.author);
    }
    return { outcome: "existing", book: existing };
  }
  const { titleKey } = identity;
  const keys = titleKey && titleKey !== identity.key && !repo.findBookByKey(titleKey) ? [identity.key, titleKey] : [identity.key];
  const book = repo.createBook({ title: identity.title, author: identity.author, isbn: identity.isbn, workKey: input.workKey, createdBy }, keys, now().toISOString());
  repo.setLanguage(book.id, language);
  return { outcome: "created", book };
}

export function seedCatalog(entries: SeedEntry[], repo: SeedRepo, now: () => Date): SeedResult {
  const result: SeedResult = { created: 0, existing: 0, invalid: 0 };
  for (const entry of entries) result[seedBook(entry, repo, now, "seed").outcome]++;
  return result;
}
