// Exercises lib/covers.ts's remaining pure/synchronous logic — ISBN and
// ImageId validation. Everything else this file used to hold (the URL
// builders, the fuzzy-search resolvers, the whole multi-source fallback
// chain) moved to backend/src/modules/covers when cover resolution
// became a persistent, global, server-side cache instead of something
// re-run in the browser on every page load — see lib/covers.ts's own top
// comment for the full story, and this app's README for how the backend
// side of this is verified (live, against the real Kobo/Open
// Library/Google Books/Hardcover APIs and a real SQLite+filesystem
// cache — not something a small offline script here could meaningfully
// stand in for).
// Run with:
//   npx tsx scripts/test-covers.mts

import { coverQueryKey } from "@scripta/shared";
import { API_URL } from "../src/api/baseUrl";
import { fetchCoverCandidates, peekResolvedCover, pickCover, rememberResolvedCover, subscribeResolvedCovers } from "../src/api/covers";
import { normalizeImageId, normalizeIsbn } from "../src/lib/covers";

let passed = 0;
let failed = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

console.log("1. normalizeIsbn — accepts real ISBN-10/13 shapes, strips dashes/spaces, rejects garbage");
{
  check("13-digit ISBN accepted as-is", normalizeIsbn("9781234567897") === "9781234567897");
  check("13-digit ISBN with dashes stripped", normalizeIsbn("978-1-234-56789-7") === "9781234567897");
  check("10-digit ISBN accepted", normalizeIsbn("0123456789") === "0123456789");
  check("10-digit ISBN with a literal X check digit accepted (uppercase)", normalizeIsbn("012345678X") === "012345678X");
  check("10-digit ISBN with a literal x check digit accepted (lowercase)", normalizeIsbn("012345678x") === "012345678x");
  check("ISBN with surrounding whitespace trimmed", normalizeIsbn("  9781234567897  ") === "9781234567897");
  check("too-short garbage rejected (empty string)", normalizeIsbn("12345") === "");
  check("too-long garbage rejected (empty string)", normalizeIsbn("12345678901234") === "");
  check("non-numeric garbage rejected (empty string)", normalizeIsbn("not-an-isbn") === "");
  check("undefined input rejected (empty string, no throw)", normalizeIsbn(undefined) === "");
}

console.log("\n2. normalizeImageId — accepts a real UUID shape, rejects anything else");
{
  const uuid = "1167ece5-3ee7-4fc0-9ae8-51a123456789";
  check("well-formed UUID accepted as-is", normalizeImageId(uuid) === uuid);
  check("well-formed UUID accepted case-insensitively", normalizeImageId(uuid.toUpperCase()) === uuid.toUpperCase());
  check("a bare ISBN is NOT mistaken for an ImageId", normalizeImageId("9781234567897") === "");
  check("garbage rejected (empty string)", normalizeImageId("not-a-uuid") === "");
  check("undefined input rejected (empty string, no throw)", normalizeImageId(undefined) === "");
}

const lookup = { isbn: "9781234567897", title: "A Title", author: "An Author" };

console.log("\n3. fetchCoverCandidates and pickCover — request URL, method and body");
{
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; method: string; body: unknown }> = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), method: init?.method ?? "GET", body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) });
    return Response.json({ candidates: [], unavailable: [], url: null, fullUrl: null, pending: false });
  };
  try {
    await fetchCoverCandidates(lookup, "quick");
    await fetchCoverCandidates(lookup, "apple");
    await pickCover(lookup, { url: "https://covers.test/a.jpg" }, false);
    await pickCover(lookup, { coverImageId: "00000000-0000-4000-8000-000000000001" }, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
  const query = coverQueryKey(lookup);
  check("quick candidates: GET with the lookup query", requests[0]?.url === `${API_URL}/covers/candidates?${query}` && requests[0].method === "GET" && requests[0].body === undefined, JSON.stringify(requests[0]));
  check("apple candidates: GET with from=apple appended", requests[1]?.url === `${API_URL}/covers/candidates?${query}&from=apple` && requests[1].method === "GET", JSON.stringify(requests[1]));
  check(
    "personal pick: POST with the lookup and the url, no everyone",
    requests[2]?.url === `${API_URL}/covers/pick` &&
      requests[2].method === "POST" &&
      JSON.stringify(requests[2].body) === JSON.stringify({ ...lookup, url: "https://covers.test/a.jpg" }),
    JSON.stringify(requests[2])
  );
  check(
    "pick for everyone: POST with the lookup, the stored image id and everyone: true",
    requests[3]?.method === "POST" &&
      JSON.stringify(requests[3].body) === JSON.stringify({ ...lookup, coverImageId: "00000000-0000-4000-8000-000000000001", everyone: true }),
    JSON.stringify(requests[3])
  );
}

console.log("\n4. rememberResolvedCover — notifies subscribers until they unsubscribe");
{
  const notified: string[] = [];
  const unsubscribe = subscribeResolvedCovers((key) => notified.push(key));
  const cover = { url: "https://covers.test/thumb.jpg", fullUrl: "https://covers.test/full.jpg" };
  rememberResolvedCover(lookup, cover);
  check("subscriber is told which cover changed", notified.length === 1 && notified[0] === coverQueryKey(lookup), JSON.stringify(notified));
  check("the remembered cover is already peekable when the subscriber runs", peekResolvedCover(lookup, "full") === cover.fullUrl);
  unsubscribe();
  rememberResolvedCover(lookup, cover);
  check("an unsubscribed listener is not called again", notified.length === 1, JSON.stringify(notified));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
