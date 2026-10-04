import assert from "node:assert/strict";
import { test } from "node:test";
import { LIBRARY_REFRESH_PATH } from "../src/api/library";
import { libraryCacheKey, libraryCachePattern, libraryFreshPattern } from "../swLibraryPattern";

const apiBase = "https://api.example.com";
const pattern = libraryCachePattern(apiBase);
const freshPattern = libraryFreshPattern(apiBase);

test("the plain library URL is cached by the service worker", () => {
  assert.ok(pattern.test(`${apiBase}/library`));
});

test("the saver's fetch URL is not matched by the cache rule", () => {
  assert.ok(!pattern.test(`${apiBase}${LIBRARY_REFRESH_PATH}`));
});

test("the saver's fetch URL is matched by the fresh rule and the plain URL is not", () => {
  assert.ok(freshPattern.test(`${apiBase}${LIBRARY_REFRESH_PATH}`));
  assert.ok(!freshPattern.test(`${apiBase}/library`));
  assert.ok(!freshPattern.test(`${apiBase}/library?fresh=10`));
});

test("the fresh URL is stored under the plain library key", () => {
  assert.equal(libraryCacheKey(`${apiBase}${LIBRARY_REFRESH_PATH}`), `${apiBase}/library`);
  assert.ok(pattern.test(libraryCacheKey(`${apiBase}${LIBRARY_REFRESH_PATH}`)));
});
