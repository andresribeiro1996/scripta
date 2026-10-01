import { normalizeIsbn } from "@scripta/shared";
import type { CoverCandidate, CoverSource, TitledCandidate } from "../../domain/ports.js";
import { fetchJson, type Throttle } from "../http/http.js";

type Storefront = "us" | "pt" | "br";

const DEFAULT_STOREFRONTS: readonly Storefront[] = ["us", "pt", "br"];
const GROUP_STOREFRONTS: Array<[prefixes: string[], storefronts: readonly Storefront[]]> = [
  [["85", "65"], ["br", "pt", "us"]],
  [["972", "989"], ["pt", "br", "us"]],
  [["0", "1"], ["us"]]
];
const SEARCH_LIMIT = "25";

const strip = ({ source, url }: TitledCandidate): CoverCandidate => ({ source, url });

export function appleArtworkUrl(artworkUrl100: string): string {
  return artworkUrl100.replace(/\/\d+x\d+bb\.(jpg|png)$/, "/1400x1400bb.$1");
}

export function parseAppleResults(json: unknown): TitledCandidate[] {
  const results = json && typeof json === "object" ? (json as { results?: unknown }).results : undefined;
  if (!Array.isArray(results)) return [];
  return results.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const result = item as Record<string, unknown>;
    if (typeof result.artworkUrl100 !== "string") return [];
    return [{
      source: "apple" as const,
      url: appleArtworkUrl(result.artworkUrl100),
      title: typeof result.trackName === "string" ? result.trackName : "",
      authors: typeof result.artistName === "string" ? [result.artistName] : []
    }];
  });
}

export function storefrontsFor(isbn: string | null): readonly Storefront[] {
  const digits = normalizeIsbn(isbn);
  const group = digits.length === 10 ? digits : digits.startsWith("978") ? digits.slice(3) : "";
  return GROUP_STOREFRONTS.find(([prefixes]) => prefixes.some((prefix) => group.startsWith(prefix)))?.[1] ?? DEFAULT_STOREFRONTS;
}

export function createAppleSource(throttle: Throttle): CoverSource {
  const get = (url: string) => throttle(() => fetchJson("apple", url));
  return {
    async byIsbn(isbn) {
      for (const country of storefrontsFor(isbn)) {
        const hits = parseAppleResults(await get(`https://itunes.apple.com/lookup?isbn=${encodeURIComponent(isbn)}&country=${country}`));
        if (hits.length) return hits.map(strip);
      }
      return [];
    },
    async byTitle(title, _author, accept) {
      for (const country of DEFAULT_STOREFRONTS) {
        const params = new URLSearchParams({ term: title, media: "ebook", limit: SEARCH_LIMIT, country });
        const hits = parseAppleResults(await get(`https://itunes.apple.com/search?${params}`)).filter(accept);
        if (hits.length) return hits.map(strip);
      }
      return [];
    }
  };
}
