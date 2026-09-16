import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";

const tempRoot = mkdtempSync(join(tmpdir(), "public-profile-"));
process.env.JWT_ACCESS_SECRET = "test-access-secret-0123456789abcdef";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret-0123456789abcdef";
process.env.AUTH_DB_PATH = join(tempRoot, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(tempRoot, "library.sqlite");
process.env.GALLERY_DB_PATH = join(tempRoot, "gallery.sqlite");
process.env.GALLERY_STORAGE_PATH = join(tempRoot, "gallery-files");

const { openAuthDb } = await import("./adapters/sqlite/connection.js");
const db = openAuthDb();
const insertUser = db.prepare(
  `INSERT INTO users (id, email, username, auth_version, created_at) VALUES (?, ?, ?, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`
);
insertUser.run("u1", "alice@test.dev", "alice");
insertUser.run("u2", "noname@test.dev", null);
insertUser.run("u3", "bob@test.dev", "bobby");
insertUser.run("u4", "alina@test.dev", "alina");

const { resolvePublicReaderProfile, resolvePublicReaderProfiles, userHasUsername, findUserIdByUsername, searchUsernameOwners } = await import("./publicProfile.js");

test("resolvePublicReaderProfile keeps its existing shape", () => {
  assert.deepEqual(resolvePublicReaderProfile("u1"), { username: "alice", avatarUrl: null });
  assert.equal(resolvePublicReaderProfile("u2"), undefined);
  assert.equal(resolvePublicReaderProfile("missing"), undefined);
});

test("batch resolution skips username-less and missing users", () => {
  const map = resolvePublicReaderProfiles(["u1", "u2", "u3", "missing"]);
  assert.equal(map.size, 2);
  assert.equal(map.get("u3")?.username, "bobby");
});

test("username existence and lookup by name", () => {
  assert.equal(userHasUsername("u1"), true);
  assert.equal(userHasUsername("u2"), false);
  assert.equal(findUserIdByUsername("alice"), "u1");
  assert.equal(findUserIdByUsername("nobody"), undefined);
});

test("username search matches substrings and escapes LIKE wildcards", () => {
  assert.deepEqual(searchUsernameOwners("ali", 10).sort(), ["u1", "u4"]);
  assert.deepEqual(searchUsernameOwners("%", 10), []);
  assert.deepEqual(searchUsernameOwners("bobby", 10), ["u3"]);
});
