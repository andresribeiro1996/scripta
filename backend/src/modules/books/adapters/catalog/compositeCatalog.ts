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

function hitsOf(attempts: Array<Attempt<CatalogSearchHit[]>>): CatalogSearchHit[] {
  const hits = attempts.flatMap((one) => (one.ok ? one.value : []));
  const failed = attempts.find((one) => !one.ok);
  if (hits.length === 0 && failed && !failed.ok) throw failed.error;
  return hits;
}

export function createCompositeCatalog(primary: BookCatalog, secondary: BookCatalog | null): BookCatalog {
  if (!secondary) return primary;
  return {
    async fetchDetails(lookup) {
      const first = await attempt(primary.fetchDetails(lookup));
      const found = first.ok ? first.value : null;
      if ((found?.summary && found.genres.length > 0) || !lookup.isbn) {
        if (!first.ok) throw first.error;
        return found;
      }
      const second = await attempt(secondary.fetchDetails(lookup));
      if (!second.ok) {
        if (found) return found;
        throw second.error;
      }
      if (!found) {
        if (!second.value && !first.ok) throw first.error;
        return second.value;
      }
      if (!second.value) return found;
      return {
        ...found,
        summary: found.summary || second.value.summary,
        genres: found.genres.length > 0 ? found.genres : second.value.genres
      };
    },

    async search(query) {
      if ("isbn" in query) {
        const first = await attempt(secondary.search(query));
        if (first.ok && first.value.length > 0) return first.value;
        return hitsOf([first, await attempt(primary.search(query))]);
      }
      const [first, second] = await Promise.all([attempt(primary.search(query)), attempt(secondary.search(query))]);
      const seen = new Set<string>();
      return hitsOf([first, second])
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
