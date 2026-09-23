import assert from "node:assert/strict";
import { test } from "node:test";
import { coverUrlForApi } from "./coverUrl.js";

test("cached emulator covers use the phone API without rewriting external or custom images", () => {
  const api = "http://192.168.1.160:3200";
  for (const host of ["127.0.0.1:3300", "localhost:3000", "[::1]:3300"]) {
    assert.equal(coverUrlForApi(`http://${host}/covers/cached/book.webp`, api), `${api}/covers/cached/book.webp`);
  }
  for (const url of ["https://covers.example.com/covers/cached/book.webp", "http://localhost:3000/gallery/image", "http://localhost.evil.test/covers/cached/book.webp"]) {
    assert.equal(coverUrlForApi(url, api), url);
  }
});
