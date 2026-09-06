// Route-level tests for the PUBLIC voting surface's actual wire shape —
// what a `curl` of these routes really returns. The
// results-after-you-submit gate lives in the board route handler (it
// decides what gets serialized, not what the service computes), and the
// ballot routes translate service.ts's internal BallotOutcome union into
// a flat success body, so neither is reachable through service.test.ts's
// fake-repo seam. These drive the real handlers through Fastify's
// inject() instead, over a :memory: database.
//
// Every path/secret env var is pointed at a throwaway temp directory
// BEFORE any module here is imported, so the test can never touch a real
// database or depend on a developer's .env: config/env.ts reads
// process.env once at import time and dotenv doesn't override what's
// already set. That's why the module imports below are dynamic — a
// static import would be hoisted above these assignments.

import assert from "node:assert/strict";
import Fastify, { type InjectOptions } from "fastify";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const scratchDir = mkdtempSync(join(tmpdir(), "tierlists-routes-test-"));
process.env.AUTH_DB_PATH = join(scratchDir, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratchDir, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratchDir, "gallery.sqlite");
process.env.GALLERY_STORAGE_PATH = join(scratchDir, "gallery-files");
process.env.COVERS_DB_PATH = join(scratchDir, "covers.sqlite");
process.env.COVERS_STORAGE_PATH = join(scratchDir, "covers-files");
process.env.TIERLISTS_DB_PATH = join(scratchDir, "tierlists.sqlite");
process.env.JWT_ACCESS_SECRET = "test-access-secret-at-least-32-characters";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret-at-least-32-characters";

const { applyTierlistsMigrations } = await import("./adapters/sqlite/connection.js");
const { createSqliteTierlistsRepository } = await import("./adapters/sqlite/sqliteTierlistsRepository.js");
const { createTierlistsService } = await import("./service.js");
const { buildPublicTierlistRoutes } = await import("./routes.js");

type Service = ReturnType<typeof createTierlistsService>;

/** An open poll whose owner has already ranked b1 into the top tier, so
 *  its histogram is non-empty from ballot #1 onwards. */
function openPoll(access: "anonymous" | "members" = "anonymous") {
  const db = new DatabaseSync(":memory:");
  applyTierlistsMigrations(db);
  const service = createTierlistsService(createSqliteTierlistsRepository(db));

  const original = service.createTierlist("u1", "Fantasy");
  const tiers = (original.data as { tiers: Array<{ id: string; label: string; color: string }> }).tiers;
  service.updateTierlist("u1", original.id, {
    data: { tiers: tiers.map((t, i) => ({ ...t, bookKeys: i === 0 ? ["b1"] : [] })), pool: ["b2"] }
  });
  const copy = service.openVoting("u1", original.id, access)!;

  return { service, copy, code: copy.voteCode!, topTierId: tiers[0]!.id };
}

async function call(service: Service, options: InjectOptions) {
  const app = Fastify();
  await app.register(buildPublicTierlistRoutes(service));
  const res = await app.inject(options);
  await app.close();
  return { status: res.statusCode, body: res.json() as Record<string, never> };
}

test("an OPEN poll's board withholds the histogram from anyone reading it", async () => {
  const { service, code } = openPoll();
  const { status, body } = await call(service, { method: "GET", url: `/tierlists/voting/${code}` });

  assert.equal(status, 200);
  const board = body.board as unknown as Record<string, unknown>;
  assert.equal("histogram" in board, false);
  // The ballot count itself is not the sensitive part — the public
  // directory publishes it for every poll, open or closed.
  assert.equal(board.ballotCount, 1);
  assert.equal(board.votingOpen, true);
  assert.equal("id" in board, false);
});

test("a CLOSED poll's board carries the final histogram", async () => {
  const { service, copy, code, topTierId } = openPoll();
  service.setVotingState("u1", copy.id, { open: false });

  const { status, body } = await call(service, { method: "GET", url: `/tierlists/voting/${code}` });
  const board = body.board as unknown as Record<string, unknown>;

  assert.equal(status, 200);
  assert.equal(board.votingOpen, false);
  assert.deepEqual(board.histogram, [{ bookKey: "b1", tierId: topTierId, votes: 1 }]);
});

test("an unknown code is a 404 with an error message", async () => {
  const { service } = openPoll();
  const { status, body } = await call(service, { method: "GET", url: "/tierlists/voting/nosuchcode" });
  assert.equal(status, 404);
  assert.equal(typeof body.error, "string");
});

test("a submitted ballot answers with ballotId/placements/results, never the internal outcome union", async () => {
  const { service, code, topTierId } = openPoll();
  const { status, body } = await call(service, {
    method: "POST",
    url: `/tierlists/voting/${code}/ballot`,
    payload: { placements: [{ bookKey: "b2", tierId: topTierId }] }
  });

  assert.equal(status, 200);
  assert.equal("ok" in body, false);
  assert.equal(typeof body.ballotId, "string");
  assert.deepEqual(body.placements, [{ bookKey: "b2", tierId: topTierId }]);
  // Voting is still open, yet the voter DOES get the standings back — the
  // gate is "after you submit", not "after voting closes".
  const results = body.results as unknown as { histogram: unknown[]; ballotCount: number };
  assert.equal(results.ballotCount, 2);
  assert.equal(results.histogram.length, 2);
});

test("a members-only poll refuses an anonymous ballot with 401 {error}", async () => {
  const { service, code, topTierId } = openPoll("members");
  const { status, body } = await call(service, {
    method: "POST",
    url: `/tierlists/voting/${code}/ballot`,
    payload: { placements: [{ bookKey: "b2", tierId: topTierId }] }
  });

  assert.equal(status, 401);
  assert.equal("ok" in body, false);
  assert.equal(typeof body.error, "string");
});
