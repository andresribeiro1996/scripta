import type { BooksRepository } from "../domain/ports.js";
import { lookupIdentity } from "../domain/normalize.js";
import type { SeedEntry } from "./rankedWorks.js";

export interface SeedResult {
  created: number;
  existing: number;
  invalid: number;
}

export function seedCatalog(entries: SeedEntry[], repo: Pick<BooksRepository, "findBookByKey" | "createBook">, now: () => Date): SeedResult {
  const result: SeedResult = { created: 0, existing: 0, invalid: 0 };
  for (const entry of entries) {
    const identity = lookupIdentity({ isbn: entry.isbn, title: entry.title, author: entry.author });
    if (!identity) {
      result.invalid++;
    } else if (repo.findBookByKey(identity.key)) {
      result.existing++;
    } else {
      const { titleKey } = identity;
      const keys = titleKey && titleKey !== identity.key && !repo.findBookByKey(titleKey) ? [identity.key, titleKey] : [identity.key];
      repo.createBook({ title: identity.title, author: identity.author, isbn: identity.isbn }, keys, now().toISOString());
      result.created++;
    }
  }
  return result;
}
