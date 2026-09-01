// Runs the same behavioural expectations against both auth adapters.
//
// Two adapters behind one port are only interchangeable if they actually
// behave the same, and this is the port where a divergence is worst: it
// holds accounts and refresh tokens, so a subtle difference is a login
// that fails, or worse, a revoked token that still works.
//
// Needs a Postgres. Set TEST_DATABASE_URL and these run; leave it unset
// and they skip, so `npm test` still works on a checkout with no database.

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, beforeEach, describe, it } from "node:test";
import pg from "pg";

import { createPgAuthRepository } from "../src/modules/auth/adapters/postgres/pgAuthRepository.js";
import { createSqliteAuthRepository } from "../src/modules/auth/adapters/sqlite/sqliteAuthRepository.js";
import type { AuthRepository } from "../src/modules/auth/domain/ports.js";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const testDir = dirname(fileURLToPath(import.meta.url));

let pool: pg.Pool;

/** Both adapters, so every expectation below can be asserted twice. The
 *  point is not to test SQLite again — it is to catch the cases where the
 *  two disagree. */
const adapters: Array<{ name: string; make: () => AuthRepository; reset: () => Promise<void> }> = [];

describe("auth adapters", { skip: DATABASE_URL ? false : "TEST_DATABASE_URL not set" }, () => {
  before(async () => {
    pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: false, max: 4 });
    await pool.query(readFileSync(join(testDir, "../src/modules/auth/adapters/postgres/schema.sql"), "utf8"));

    adapters.push({
      name: "postgres",
      make: () => createPgAuthRepository(pool),
      reset: async () => {
        await pool.query("TRUNCATE users, refresh_tokens CASCADE");
      }
    });

    adapters.push({
      name: "sqlite",
      make: () => {
        const db = new DatabaseSync(":memory:");
        db.exec("PRAGMA foreign_keys = ON");
        db.exec(readFileSync(join(testDir, "../src/modules/auth/adapters/sqlite/schema.sql"), "utf8"));
        return createSqliteAuthRepository(db);
      },
      reset: async () => {}
    });
  });

  after(async () => {
    await pool?.end();
  });

  for (const adapter of ["postgres", "sqlite"] as const) {
    describe(adapter, () => {
      let repo: AuthRepository;

      beforeEach(async () => {
        const entry = adapters.find((a) => a.name === adapter)!;
        await entry.reset();
        repo = entry.make();
      });

      it("creates a user and finds it by every identifier", async () => {
        const created = await repo.createUser({
          email: "a@example.test",
          username: "alice",
          passwordHash: "hash",
          googleId: null
        });

        assert.ok(created.id);
        assert.ok(created.created_at, "created_at must come back populated");
        assert.equal((await repo.findUserByEmail("a@example.test"))!.id, created.id);
        assert.equal((await repo.findUserByUsername("alice"))!.id, created.id);
        assert.equal((await repo.findUserById(created.id))!.id, created.id);
      });

      it("returns undefined rather than throwing for a user that isn't there", async () => {
        assert.equal(await repo.findUserByEmail("nobody@example.test"), undefined);
        assert.equal(await repo.findUserByUsername("nobody"), undefined);
        assert.equal(await repo.findUserById("nope"), undefined);
        assert.equal(await repo.findUserByGoogleId("nope"), undefined);
      });

      it("rejects a duplicate email", async () => {
        await repo.createUser({ email: "a@example.test", username: "alice", passwordHash: "h", googleId: null });
        await assert.rejects(() =>
          repo.createUser({ email: "a@example.test", username: "other", passwordHash: "h", googleId: null })
        );
      });

      it("rejects a duplicate username", async () => {
        await repo.createUser({ email: "a@example.test", username: "alice", passwordHash: "h", googleId: null });
        await assert.rejects(() =>
          repo.createUser({ email: "b@example.test", username: "alice", passwordHash: "h", googleId: null })
        );
      });

      it("allows several accounts with no username", async () => {
        // Google sign-in creates the account before prompting for a
        // username, so multiple NULLs must coexist under the UNIQUE
        // constraint. Both engines allow this; asserting it because the
        // whole Google flow breaks on the second signup if one didn't.
        await repo.createUser({ email: "a@example.test", username: null, passwordHash: null, googleId: "g1" });
        await repo.createUser({ email: "b@example.test", username: null, passwordHash: null, googleId: "g2" });

        assert.equal((await repo.findUserByGoogleId("g1"))!.email, "a@example.test");
        assert.equal((await repo.findUserByGoogleId("g2"))!.email, "b@example.test");
      });

      it("links a Google id to an existing account, and claims a username", async () => {
        const user = await repo.createUser({ email: "a@example.test", username: null, passwordHash: "h", googleId: null });

        await repo.linkGoogleId(user.id, "g-123");
        assert.equal((await repo.findUserByGoogleId("g-123"))!.id, user.id);

        await repo.setUsername(user.id, "alice");
        assert.equal((await repo.findUserById(user.id))!.username, "alice");
      });

      it("stores and finds a refresh token by its hash", async () => {
        const user = await repo.createUser({ email: "a@example.test", username: "alice", passwordHash: "h", googleId: null });
        const expires = new Date(Date.now() + 86_400_000);

        const id = await repo.insertRefreshToken({ userId: user.id, tokenHash: "hash-1", expiresAt: expires });
        const row = (await repo.findRefreshTokenByHash("hash-1"))!;

        assert.equal(row.id, id);
        assert.equal(row.user_id, user.id);
        assert.equal(row.revoked_at, null, "a fresh token must not look revoked");
        // Both adapters must speak ISO strings, not Date objects — the
        // service compares this against Date.now() via new Date(...).
        assert.equal(typeof row.expires_at, "string");
        assert.ok(new Date(row.expires_at).getTime() > Date.now());
      });

      it("revokes one token without touching the others", async () => {
        const user = await repo.createUser({ email: "a@example.test", username: "alice", passwordHash: "h", googleId: null });
        const expires = new Date(Date.now() + 86_400_000);
        const first = await repo.insertRefreshToken({ userId: user.id, tokenHash: "h1", expiresAt: expires });
        await repo.insertRefreshToken({ userId: user.id, tokenHash: "h2", expiresAt: expires });

        await repo.revokeRefreshToken(first);

        assert.ok((await repo.findRefreshTokenByHash("h1"))!.revoked_at, "revoked token must carry a timestamp");
        assert.equal((await repo.findRefreshTokenByHash("h2"))!.revoked_at, null);
      });

      it("revokes every live token for one user, and nobody else's", async () => {
        const expires = new Date(Date.now() + 86_400_000);
        const alice = await repo.createUser({ email: "a@example.test", username: "alice", passwordHash: "h", googleId: null });
        const bob = await repo.createUser({ email: "b@example.test", username: "bob", passwordHash: "h", googleId: null });
        await repo.insertRefreshToken({ userId: alice.id, tokenHash: "a1", expiresAt: expires });
        await repo.insertRefreshToken({ userId: alice.id, tokenHash: "a2", expiresAt: expires });
        await repo.insertRefreshToken({ userId: bob.id, tokenHash: "b1", expiresAt: expires });

        await repo.revokeAllRefreshTokensForUser(alice.id);

        assert.ok((await repo.findRefreshTokenByHash("a1"))!.revoked_at);
        assert.ok((await repo.findRefreshTokenByHash("a2"))!.revoked_at);
        assert.equal((await repo.findRefreshTokenByHash("b1"))!.revoked_at, null, "Bob's session must survive Alice's logout");
      });

      it("does not move an already-revoked timestamp forward", async () => {
        // service.ts treats "this token was already revoked" as evidence of
        // a stolen-and-replayed token and logs the account out everywhere.
        // If a second revoke overwrote the timestamp, that signal would
        // still be there — but the original revocation time, which is what
        // an incident review reads, would be gone.
        const user = await repo.createUser({ email: "a@example.test", username: "alice", passwordHash: "h", googleId: null });
        const id = await repo.insertRefreshToken({
          userId: user.id,
          tokenHash: "h1",
          expiresAt: new Date(Date.now() + 86_400_000)
        });

        await repo.revokeRefreshToken(id);
        const firstRevokedAt = (await repo.findRefreshTokenByHash("h1"))!.revoked_at;

        // The wait is load-bearing. Both timestamps have millisecond
        // resolution, so without it the two revokes land in the same
        // millisecond and the assertion holds whether or not the second
        // write was suppressed — which is how this test originally passed
        // against a SQLite adapter that did overwrite.
        await new Promise((resolve) => setTimeout(resolve, 25));

        await repo.revokeRefreshToken(id);
        assert.equal(
          (await repo.findRefreshTokenByHash("h1"))!.revoked_at,
          firstRevokedAt,
          "a second revoke must not overwrite when the token was first revoked"
        );
      });
    });
  }
});
