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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
