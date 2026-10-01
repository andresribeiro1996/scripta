import { buildBookMetadata, findOpenLibraryMatch, mapOpenLibraryDoc } from "@scripta/shared";
import type { BookCatalog } from "../../domain/ports.js";
import { fetchJson, type Throttle } from "../http/http.js";

export function createOpenLibraryCatalog(throttle: Throttle, urgent = true): BookCatalog {
  const get = (url: string) => throttle(() => fetchJson("openlibrary", url), { urgent });
  return {
    async fetchDetails({ isbn, title, author }) {
      if (!isbn && (!title || !author)) return null;
      const query = new URLSearchParams({ fields: "key,title,author_name,ratings_average,ratings_count,subject", limit: "5" });
      if (isbn) query.set("isbn", isbn);
      else {
        query.set("title", title);
        query.set("author", author);
      }
      const match = findOpenLibraryMatch(await get(`https://openlibrary.org/search.json?${query}`), isbn ?? "", title, author);
      if (!match) return null;
      const metadata = buildBookMetadata(match, await get(`https://openlibrary.org${String(match.key)}.json`));
      return { metadata, sources: ["openlibrary"], summarySource: metadata.summary ? "openlibrary" : null, workKey: String(match.key) };
    },

    async search(query) {
      const params = new URLSearchParams({ fields: "key,title,author_name,first_publish_year,isbn,publisher,cover_i,subject", limit: "12" });
      if ("isbn" in query) params.set("isbn", query.isbn);
      else params.set("q", query.text);
      const data = await get(`https://openlibrary.org/search.json?${params}`);
      const docs = data && typeof data === "object" ? (data as { docs?: unknown }).docs : undefined;
      if (!Array.isArray(docs)) return [];
      return docs.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const doc = item as Record<string, unknown>;
        const result = mapOpenLibraryDoc(doc);
        return result ? [{ result, olCoverId: typeof doc.cover_i === "number" ? doc.cover_i : null, workKey: typeof doc.key === "string" ? doc.key : null, source: "openlibrary" as const }] : [];
      });
    }
  };
}
