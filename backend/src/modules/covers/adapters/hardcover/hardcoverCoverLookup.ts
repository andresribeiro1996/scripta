// The ONLY file in this module that knows Hardcover's GraphQL API
// exists — same "the concrete adapter is the one place that knows the
// real technology" rule modules/auth's/modules/library's own SQLite
// adapters follow, just for an HTTP API instead of a database.
//
// Endpoint/auth confirmed against Hardcover's own docs (docs.hardcover.app):
// POST https://api.hardcover.app/v1/graphql, `Authorization: Bearer <key>`.
// The query filters on isbn_13 OR isbn_10 since this app's own ISBN field
// (see frontend's lib/covers.ts normalizeIsbn) accepts either length —
// callers here always pass whichever one the book actually has.

import type { CoverLookupPort } from "../../domain/ports.js";

const HARDCOVER_GRAPHQL_URL = "https://api.hardcover.app/v1/graphql";

const QUERY = `
  query CoverByIsbn($isbn: String!) {
    editions(where: { _or: [{ isbn_13: { _eq: $isbn } }, { isbn_10: { _eq: $isbn } }] }, limit: 1) {
      image {
        url
      }
    }
  }
`;

interface HardcoverResponse {
  data?: {
    editions?: Array<{ image?: { url?: string } }>;
  };
}

export function createHardcoverCoverLookup(apiKey: string): CoverLookupPort {
  return {
    async fetchCoverByIsbn(isbn: string): Promise<string | null> {
      try {
        const res = await fetch(HARDCOVER_GRAPHQL_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`
          },
          body: JSON.stringify({ query: QUERY, variables: { isbn } })
        });
        // Never throws on a non-2xx (an expired/revoked key, Hardcover's
        // own 60 req/min limit, a transient outage) — same "a failed
        // lookup is just as valid an answer as an empty one" contract
        // every cover source in this app's chain already follows (see
        // lib/covers.ts on the frontend).
        if (!res.ok) return null;
        const data = (await res.json()) as HardcoverResponse;
        return data.data?.editions?.[0]?.image?.url ?? null;
      } catch {
        return null;
      }
    }
  };
}
