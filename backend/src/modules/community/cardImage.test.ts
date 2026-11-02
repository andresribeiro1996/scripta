import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readerCardInputOf, type PublicReaderCard } from "@scripta/shared";
import { resolvePrint } from "@scripta/shared/readerCards";
import Fastify from "fastify";
import sharp from "sharp";
import type { CommunityDeps } from "./service.js";

const scratch = mkdtempSync(join(tmpdir(), "community-card-image-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COMMUNITY_DB_PATH = join(scratch, "community.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);
process.env.NODE_ENV = "test";

const { openCommunityDb } = await import("./adapters/sqlite/connection.js");
const { createSqliteCommunityRepository } = await import("./adapters/sqlite/sqliteCommunityRepository.js");
const { buildCommunityRoutes, buildPublicCommunityRoutes } = await import("./routes.js");
const { createCommunityService } = await import("./service.js");
const { renderCardImage } = await import("./cardImage.js");

const settledCard: PublicReaderCard = {
  state: "settled", identity: "star", runnerUp: null, streak: "lamp", signal: null, coverage: [],
  dial: { segments: [{ group: "star", books: 22, marked: 9 }, { group: "lamp", books: 8, marked: 1 }] },
  facts: { finished: 30, highlights: 40, series: 2, since: 2014, edition: 2026 }
};
const unused = () => {
  throw new Error("card images do not read this");
};
const unusedGame = { get: unused, getMany: unused, listByOwner: unused, discoverWindow: unused, discoverByWorks: unused, participation: unused, shelfFacts: unused };

async function cardApp() {
  const repo = createSqliteCommunityRepository(openCommunityDb());
  const deps: CommunityDeps = {
    repo,
    background: unused,
    getDashboardSeenAt: unused,
    setDashboardSeenAt: unused,
    resolveProfile: unused,
    resolveProfiles: (ids) => new Map(ids.map((id) => [id, { username: id, avatarUrl: null }])),
    resolveLibrary: unused,
    readerGlyphFor: unused,
    readerCardFor: () => settledCard,
    sharedBookCounts: unused,
    sharedBooks: unused,
    userHasUsername: unused,
    findUserIdByUsername: unused,
    searchUsernameOwners: unused,
    matchWorks: unused,
    murals: { ownsMural: unused, getMuralPublicPayload: unused, getMuralSummary: unused },
    games: { tierlist: unusedGame, tournament: unusedGame, quiz: unusedGame },
    rankingCovers: unused,
    completedTournaments: () => []
  };
  const service = createCommunityService(deps, (token) => `https://app.test/shared/cards/${token}`);
  const app = Fastify();
  app.decorate("authenticateAccessToken", (token: string) => ({ id: token, email: `${token}@example.test`, username: token, avatarId: null }));
  await app.register(buildCommunityRoutes(service));
  await app.register(buildPublicCommunityRoutes(service));
  const as = (method: "GET" | "POST", url: string) => app.inject({ method, url, headers: { authorization: "Bearer alice" } });
  return { app, as };
}

test("renderCardImage returns a 600x840 JPEG under 300 KB", async () => {
  const base = readerCardInputOf([], [], "marta", "en", settledCard);
  const buf = await renderCardImage({ ...base, print: resolvePrint(base.style.print, false) });
  const meta = await sharp(buf).metadata();
  assert.deepEqual({ format: meta.format, width: meta.width, height: meta.height }, { format: "jpeg", width: 600, height: 840 });
  assert.ok(buf.length < 300_000);
});

test("image route 404s for an unknown token", async (t) => {
  const { app } = await cardApp();
  t.after(() => app.close());
  assert.equal((await app.inject({ method: "GET", url: "/community/cards/shared/nope/image.jpg" })).statusCode, 404);
});

test("image route 404s for a revoked token", async (t) => {
  const { app, as } = await cardApp();
  t.after(() => app.close());
  const { shareToken } = (await as("POST", "/community/card/share")).json();
  await as("POST", "/community/card/unshare");
  assert.equal((await app.inject({ method: "GET", url: `/community/cards/shared/${shareToken}/image.jpg` })).statusCode, 404);
});

test("image route serves image/jpeg privately cached for 300s and varying on language for a live token", async (t) => {
  const { app, as } = await cardApp();
  t.after(() => app.close());
  const { shareToken } = (await as("POST", "/community/card/share")).json();
  const res = await app.inject({ method: "GET", url: `/community/cards/shared/${shareToken}/image.jpg` });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["content-type"], "image/jpeg");
  assert.equal(res.headers["cache-control"], "private, max-age=300");
  assert.equal(res.headers.vary, "Accept-Language");
  assert.equal((await sharp(res.rawPayload).metadata()).format, "jpeg");
});
