import type { BookMetadata } from "@scripta/shared";
import { SourceUnavailableError } from "../../domain/errors.js";
import { lookupIdentity, SEARCH_LIMIT } from "../../domain/normalize.js";
import type { BookCatalog, CatalogSearchHit } from "../../domain/ports.js";

type Attempt<T> = { ok: true; value: T } | { ok: false; error: SourceUnavailableError };

async function attempt<T>(task: Promise<T>): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await task };
  } catch (error) {
    if (error instanceof SourceUnavailableError) return { ok: false, error };
    throw error;
  }
}

function hitKey({ result }: CatalogSearchHit): string | null {
  return lookupIdentity({ isbn: result.isbn, title: result.title, author: result.authors.join(", ") })?.key ?? null;
}

function listsOf(attempts: Array<Attempt<CatalogSearchHit[]>>): CatalogSearchHit[][] {
  const lists = attempts.map((one) => (one.ok ? one.value : []));
  const failed = attempts.find((one) => !one.ok);
  if (lists.every((list) => list.length === 0) && failed && !failed.ok) throw failed.error;
  return lists;
}

function interleave(first: CatalogSearchHit[], second: CatalogSearchHit[]): CatalogSearchHit[] {
  const merged: CatalogSearchHit[] = [];
  for (let index = 0; index < Math.max(first.length, second.length); index++) {
    for (const list of [first, second]) if (index < list.length) merged.push(list[index]!);
  }
  return merged;
}

export function createCompositeCatalog(primary: BookCatalog, secondary: BookCatalog | null, strict = false): BookCatalog {
  if (!secondary) return primary;
  return {
    async fetchDetails(lookup) {
      const first = await attempt(primary.fetchDetails(lookup));
      const found = first.ok ? first.value : null;
      if ((found?.metadata.summary && found.metadata.genres.length > 0) || !lookup.isbn) {
        if (!first.ok) throw first.error;
        return found;
      }
      if (strict && !first.ok) throw first.error;
      const second = await attempt(secondary.fetchDetails(lookup));
      if (!second.ok) {
        if (found && !strict) return found;
        throw second.error;
      }
      if (!found) {
        if (!second.value && !first.ok) throw first.error;
        return second.value;
      }
      if (!second.value) return found;
      const have = found.metadata;
      const extra = second.value.metadata;
      const metadata: BookMetadata = {
        ...have,
        summary: have.summary ?? extra.summary,
        genres: have.genres.length > 0 ? have.genres : extra.genres,
        pages: have.pages ?? extra.pages,
        publisher: have.publisher ?? extra.publisher,
        year: have.year ?? extra.year,
        translator: have.translator ?? extra.translator
      };
      if (JSON.stringify(metadata) === JSON.stringify(have)) return found;
      return {
        ...found,
        metadata,
        sources: [...found.sources, ...second.value.sources],
        summarySource: have.summary ? found.summarySource : extra.summary ? second.value.summarySource : null
      };
    },

    async search(query) {
      if ("isbn" in query) {
        const first = await attempt(secondary.search(query));
        if (first.ok && first.value.length > 0) return first.value;
        return listsOf([first, await attempt(primary.search(query))]).flat();
      }
      const [first, second] = await Promise.all([attempt(primary.search(query)), attempt(secondary.search(query))]);
      const seen = new Set<string>();
      const [primaryHits, secondaryHits] = listsOf([first, second]);
      return interleave(primaryHits!, secondaryHits!)
        .filter((hit) => {
          const key = hitKey(hit);
          if (key === null) return true;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, SEARCH_LIMIT);
    }
  };
}
