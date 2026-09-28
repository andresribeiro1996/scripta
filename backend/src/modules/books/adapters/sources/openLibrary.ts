import type { CoverSource } from "../../domain/ports.js";
import { fetchJson, type Throttle } from "../http/http.js";

export function createOpenLibraryCoverSource(throttle: Throttle): CoverSource {
  return {
    async byIsbn(isbn) {
      return [{ source: "openlibrary", url: `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(isbn)}-L.jpg?default=false` }];
    },
    async byTitle(title, _author, accept) {
      const params = new URLSearchParams({ title, fields: "title,author_name,cover_i", limit: "20" });
      const data = await throttle(() => fetchJson("openlibrary", `https://openlibrary.org/search.json?${params}`));
      const docs = data && typeof data === "object" ? (data as { docs?: unknown }).docs : undefined;
      if (!Array.isArray(docs)) return [];
      return docs.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const doc = item as Record<string, unknown>;
        if (typeof doc.cover_i !== "number") return [];
        const candidate = {
          source: "openlibrary" as const,
          url: `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`,
          title: typeof doc.title === "string" ? doc.title : "",
          authors: Array.isArray(doc.author_name) ? doc.author_name.filter((name): name is string => typeof name === "string") : []
        };
        return accept(candidate) ? [{ source: candidate.source, url: candidate.url }] : [];
      });
    }
  };
}
