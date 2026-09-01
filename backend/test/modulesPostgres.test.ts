// Runs the same expectations against both adapters for gallery, covers
// and socials — the three modules that moved to Postgres last.
//
// Same reasoning as the auth suite: two implementations behind one port
// are only interchangeable if they actually agree, and the way to know is
// to ask both the same questions. Each `describe` loops over the two
// adapters rather than testing Postgres alone, so a divergence shows up
// as one adapter failing an assertion the other passes.

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, beforeEach, describe, it } from "node:test";
import pg from "pg";

import { createPgGalleryRepository } from "../src/modules/gallery/adapters/postgres/pgGalleryRepository.js";
import { createSqliteGalleryRepository } from "../src/modules/gallery/adapters/sqlite/sqliteGalleryRepository.js";
import { createPgCoverCacheRepository } from "../src/modules/covers/adapters/postgres/pgCoverCacheRepository.js";
import { createSqliteCoverCacheRepository } from "../src/modules/covers/adapters/sqlite/sqliteCoverCacheRepository.js";
import { createPgSocialsRepository } from "../src/modules/socials/adapters/postgres/pgSocialsRepository.js";
import { createSqliteSocialsRepository } from "../src/modules/socials/adapters/sqlite/sqliteSocialsRepository.js";
import type { GalleryRepository } from "../src/modules/gallery/domain/ports.js";
import type { CoverCacheRepository } from "../src/modules/covers/domain/ports.js";
import type { SocialsRepository } from "../src/modules/socials/domain/ports.js";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const testDir = dirname(fileURLToPath(import.meta.url));

let pool: pg.Pool;

function sqliteFor(module: string): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(readFileSync(join(testDir, `../src/modules/${module}/adapters/sqlite/schema.sql`), "utf8"));
  return db;
}

function imageRow(id: string, userId: string, bytes = 1000) {
  return {
    id,
    user_id: userId,
    filename: `${id}.png`,
    mime_type: "image/webp",
    extension: "webp",
    width: 300,
    height: 450,
    byte_size: bytes,
    created_at: new Date().toISOString()
  };
}

describe("gallery / covers / socials adapters", { skip: DATABASE_URL ? false : "TEST_DATABASE_URL not set" }, () => {
  before(async () => {
    pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: false, max: 4 });
    for (const module of ["gallery", "covers", "socials"]) {
      await pool.query(readFileSync(join(testDir, `../src/modules/${module}/adapters/postgres/schema.sql`), "utf8"));
    }
  });

  after(async () => {
    await pool?.end();
  });

  // --- gallery -------------------------------------------------------------

  for (const adapter of ["postgres", "sqlite"] as const) {
    describe(`gallery (${adapter})`, () => {
      let repo: GalleryRepository;

      beforeEach(async () => {
        if (adapter === "postgres") {
          await pool.query("TRUNCATE gallery_images");
          repo = createPgGalleryRepository(pool);
        } else {
          repo = createSqliteGalleryRepository(sqliteFor("gallery"));
        }
      });

      it("stores and lists a user's images", async () => {
        await repo.insertImage(imageRow("i1", "alice"));
        await repo.insertImage(imageRow("i2", "alice"));
        await repo.insertImage(imageRow("i3", "bob"));

        const alice = await repo.listImages("alice");
        assert.equal(alice.length, 2);
        assert.equal((await repo.listImages("bob")).length, 1);
        assert.equal((await repo.listImages("nobody")).length, 0);
      });

      it("returns byte_size as a number, not a string", async () => {
        // Postgres returns BIGINT as a string to avoid precision loss;
        // the quota check does arithmetic on this, and "1000" + 1000
        // would silently become "10001000".
        await repo.insertImage(imageRow("i1", "alice", 1234));
        const row = (await repo.getImageById("i1"))!;

        assert.equal(typeof row.byte_size, "number");
        assert.equal(row.byte_size, 1234);
      });

      it("sums a user's bytes for the quota check, and returns 0 for nobody", async () => {
        await repo.insertImage(imageRow("i1", "alice", 1000));
        await repo.insertImage(imageRow("i2", "alice", 2500));
        await repo.insertImage(imageRow("i3", "bob", 9999));

        const total = await repo.totalBytesForUser("alice");
        assert.equal(typeof total, "number");
        assert.equal(total, 3500);
        assert.equal(await repo.totalBytesForUser("nobody"), 0, "a user with no images must be 0, not NULL");
      });

      it("finds an image by id without an ownership filter", async () => {
        // Backs the public GET /gallery/:id/file route.
        await repo.insertImage(imageRow("i1", "alice"));
        assert.ok(await repo.getImageById("i1"));
        assert.equal(await repo.getImageById("missing"), undefined);
      });

      it("will not hand one user another user's image through the owned lookup", async () => {
        await repo.insertImage(imageRow("i1", "alice"));

        assert.ok(await repo.getOwnedImage("i1", "alice"));
        assert.equal(await repo.getOwnedImage("i1", "bob"), undefined);
      });

      it("only deletes an image its owner asked to delete", async () => {
        await repo.insertImage(imageRow("i1", "alice"));

        assert.equal(await repo.deleteImage("i1", "bob"), false, "another user's delete must report nothing deleted");
        assert.ok(await repo.getImageById("i1"), "and must not actually delete it");

        assert.equal(await repo.deleteImage("i1", "alice"), true);
        assert.equal(await repo.getImageById("i1"), undefined);
      });
    });
  }

  // --- covers --------------------------------------------------------------

  for (const adapter of ["postgres", "sqlite"] as const) {
    describe(`covers (${adapter})`, () => {
      let repo: CoverCacheRepository;

      beforeEach(async () => {
        if (adapter === "postgres") {
          await pool.query("TRUNCATE cover_cache");
          repo = createPgCoverCacheRepository(pool);
        } else {
          repo = createSqliteCoverCacheRepository(sqliteFor("covers"));
        }
      });

      const row = (id: string, key: string) => ({
        id,
        cache_key: key,
        source: "openlibrary",
        mime_type: "image/webp",
        extension: "webp",
        width: 300,
        height: 450,
        byte_size: 5000,
        created_at: new Date().toISOString()
      });

      it("caches a cover and reads it back by key", async () => {
        assert.equal(await repo.insert(row("c1", "isbn:9780441013593")), true);
        assert.equal((await repo.getByCacheKey("isbn:9780441013593"))!.id, "c1");
      });

      it("returns undefined for a key that was never resolved", async () => {
        assert.equal(await repo.getByCacheKey("isbn:0000000000000"), undefined);
      });

      it("reports the loser of a concurrent resolve rather than throwing", async () => {
        // Two requests can resolve the same book at once. The second must
        // absorb that quietly and return false, so service.ts knows to
        // read back whichever row the winner wrote — a thrown constraint
        // error here would turn a harmless race into a 500.
        assert.equal(await repo.insert(row("c1", "isbn:9780441013593")), true);
        assert.equal(await repo.insert(row("c2", "isbn:9780441013593")), false);

        assert.equal((await repo.getByCacheKey("isbn:9780441013593"))!.id, "c1", "the winner's row must survive");
      });
    });
  }

  // --- socials -------------------------------------------------------------

  for (const adapter of ["postgres", "sqlite"] as const) {
    describe(`socials (${adapter})`, () => {
      let repo: SocialsRepository;

      beforeEach(async () => {
        if (adapter === "postgres") {
          await pool.query("TRUNCATE social_connections");
          repo = createPgSocialsRepository(pool);
        } else {
          repo = createSqliteSocialsRepository(sqliteFor("socials"));
        }
      });

      const connection = (userId: string, provider: string, handle: string, token = "cipher") => ({
        userId,
        provider: provider as never,
        handle,
        providerAccountId: `${provider}-account`,
        accessTokenEnc: token,
        refreshTokenEnc: null,
        expiresAt: null
      });

      it("stores a connection and reads it back", async () => {
        await repo.upsertConnection(connection("alice", "bluesky", "@alice"));

        const row = (await repo.getConnection("alice", "bluesky" as never))!;
        assert.equal(row.handle, "@alice");
        assert.equal(row.access_token_enc, "cipher", "the adapter must store the ciphertext it was given, unchanged");
      });

      it("replaces rather than duplicates on reconnect", async () => {
        await repo.upsertConnection(connection("alice", "bluesky", "@old", "cipher-1"));
        await repo.upsertConnection(connection("alice", "bluesky", "@new", "cipher-2"));

        const all = await repo.listConnections("alice");
        assert.equal(all.length, 1, "one row per (user, provider)");
        assert.equal(all[0]!.handle, "@new");
        assert.equal(all[0]!.access_token_enc, "cipher-2");
      });

      it("keeps one user's connections separate from another's", async () => {
        await repo.upsertConnection(connection("alice", "bluesky", "@alice"));
        await repo.upsertConnection(connection("bob", "bluesky", "@bob"));

        assert.equal((await repo.getConnection("alice", "bluesky" as never))!.handle, "@alice");
        assert.equal((await repo.getConnection("bob", "bluesky" as never))!.handle, "@bob");
        assert.equal((await repo.listConnections("alice")).length, 1);
      });

      it("disconnects one provider without touching the others", async () => {
        await repo.upsertConnection(connection("alice", "bluesky", "@alice"));
        await repo.upsertConnection(connection("alice", "x", "@alice_x"));

        await repo.deleteConnection("alice", "bluesky" as never);

        assert.equal(await repo.getConnection("alice", "bluesky" as never), undefined);
        assert.ok(await repo.getConnection("alice", "x" as never), "the other platform must stay connected");
      });

      it("will not let one user disconnect another's account", async () => {
        await repo.upsertConnection(connection("alice", "bluesky", "@alice"));

        await repo.deleteConnection("bob", "bluesky" as never);

        assert.ok(await repo.getConnection("alice", "bluesky" as never), "Alice's connection must survive");
      });
    });
  }
});
