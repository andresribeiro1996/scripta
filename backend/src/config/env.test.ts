import assert from "node:assert/strict";
import { test } from "node:test";

process.env.AUTH_DB_PATH = "/srv/volume/auth.sqlite";
process.env.LIBRARY_DB_PATH = "/srv/volume/library.sqlite";
process.env.GALLERY_DB_PATH = "/srv/volume/gallery.sqlite";
process.env.GALLERY_STORAGE_PATH = "/srv/volume/gallery-files";
process.env.JWT_ACCESS_SECRET ??= "a".repeat(64);
process.env.JWT_REFRESH_SECRET ??= "b".repeat(64);
delete process.env.WAITLIST_DB_PATH;

const { env } = await import("./env.js");

test("the waitlist database defaults to the directory that holds the accounts database", () => {
  assert.equal(env.WAITLIST_DB_PATH, "/srv/volume/waitlist.sqlite");
});
