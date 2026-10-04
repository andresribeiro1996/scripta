import assert from "node:assert/strict";
import { test } from "node:test";
import { LIBRARY_REFRESH_PATH } from "../src/api/library";
import { libraryCachePattern } from "../swLibraryPattern";

const apiBase = "https://api.example.com";
const pattern = libraryCachePattern(apiBase);

test("the plain library URL is cached by the service worker", () => {
  assert.ok(pattern.test(`${apiBase}/library`));
});

test("the saver's fetch URL is not matched by the cache rule", () => {
  assert.ok(!pattern.test(`${apiBase}${LIBRARY_REFRESH_PATH}`));
});
