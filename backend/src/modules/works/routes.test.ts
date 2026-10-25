import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import Fastify, { type FastifyError } from "fastify";

const scratch = mkdtempSync(join(tmpdir(), "works-routes-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { buildWorkRoutes, buildWorkStatsRoutes } = await import("./routes.js");
const { worksPlugin } = await import("./plugin.js");
const { WorkResolutionError } = await import("../library/index.js");

function appWith(getPage: (id: string, viewerId: string | null) => unknown, getStats: (id: string) => unknown = () => undefined, recentAwards: () => unknown = () => ({ announcements: [] }), characters: (ids: string[]) => unknown = () => ({})) {
  const app = Fastify();
  app.decorate("authenticateAccessToken", (token: string) => (token === "good" ? { id: "viewer", email: "v@example.test", username: "viewer", avatarId: null } : null));
  app.setErrorHandler((error: FastifyError, _request, reply) => {
    if (error instanceof WorkResolutionError) return reply.code(503).send({ error: error.message });
    const statusCode = typeof error.statusCode === "number" && error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 500;
    return statusCode === 500 ? reply.code(500).send({ error: "Internal server error" }) : reply.code(statusCode).send({ error: error.message });
  });
  void app.register(buildWorkRoutes({ getPage, recentAwards, characters } as never));
  void app.register(buildWorkStatsRoutes({ getStats } as never));
  return app;
}

test("an unknown id is a 404 with the agreed message", async () => {
  const app = appWith(() => undefined);
  const res = await app.inject({ url: "/works/nope" });
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.json(), { error: "No book with that id." });
  await app.close();
});

test("the viewer is optional, a bad token is a 401, and responses are never cached", async () => {
  const seen: Array<string | null> = [];
  const app = appWith((_id, viewerId) => { seen.push(viewerId); return { work: { id: "w" } }; });
  const anonymous = await app.inject({ url: "/works/w" });
  const signedIn = await app.inject({ url: "/works/w", headers: { authorization: "Bearer good" } });
  const badToken = await app.inject({ url: "/works/w", headers: { authorization: "Bearer bad" } });
  assert.deepEqual([anonymous.statusCode, signedIn.statusCode, badToken.statusCode], [200, 200, 401]);
  assert.deepEqual(seen, [null, "viewer"]);
  assert.equal(signedIn.headers["cache-control"], "no-store");
  await app.close();
});

test("a catalog outage is a 503 and any other failure is a 500, never an empty page", async () => {
  const down = appWith(() => { throw new WorkResolutionError(new Error("disk")); });
  assert.equal((await down.inject({ url: "/works/w" })).statusCode, 503);
  await down.close();
  const broken = appWith(() => { throw new Error("readers query failed"); });
  assert.equal((await broken.inject({ url: "/works/w" })).statusCode, 500);
  await broken.close();
});

test("stats: 404 for an unknown work, the stats otherwise, never cached, viewer optional", async () => {
  const app = appWith(() => undefined, (id) => (id === "w" ? { community: null, tiers: null, tournaments: null } : undefined));
  const missing = await app.inject({ url: "/works/nope/stats" });
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(missing.json(), { error: "No book with that id." });
  const found = await app.inject({ url: "/works/w/stats", headers: { authorization: "Bearer good" } });
  assert.equal(found.statusCode, 200);
  assert.deepEqual(found.json(), { community: null, tiers: null, tournaments: null });
  assert.equal(found.headers["cache-control"], "no-store");
  assert.equal((await app.inject({ url: "/works/w/stats", headers: { authorization: "Bearer bad" } })).statusCode, 401);
  await app.close();
});

test("stats: a catalog outage is a 503", async () => {
  const app = appWith(() => undefined, () => { throw new WorkResolutionError(new Error("disk")); });
  assert.equal((await app.inject({ url: "/works/w/stats" })).statusCode, 503);
  await app.close();
});

test("the page and stats routes have separate rate-limit budgets", async () => {
  const app = Fastify();
  app.decorate("authenticateAccessToken", () => null);
  void app.register(worksPlugin, {
    getWorkPage: () => undefined,
    communityRatings: () => [],
    tierPlacements: () => [],
    tournamentRecord: () => ({ entered: 0, titles: 0, wins: 0, losses: 0, best: null })
  } as never);
  for (let i = 0; i < 30; i += 1) assert.equal((await app.inject({ url: "/works/w" })).statusCode, 404);
  assert.equal((await app.inject({ url: "/works/w" })).statusCode, 429);
  assert.equal((await app.inject({ url: "/works/w/stats" })).statusCode, 404);
  await app.close();
});

test("GET /awards/recent returns the announcements with no-store and needs no sign-in", async () => {
  const announcements = [{ prize: "booker", year: 2026, announcedAt: "2026-10-20T00:00:00.000Z", winners: [], nomineeWorkIds: [], honoree: null }];
  const app = appWith(() => undefined, () => undefined, () => ({ announcements }));
  const res = await app.inject({ url: "/awards/recent" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { announcements });
  assert.equal(res.headers["cache-control"], "no-store");
  await app.close();
});

test("characters route answers by given id", async () => {
  const app = appWith(() => undefined, () => undefined, undefined, (ids) => Object.fromEntries(ids.map((id) => [id, ["A", "B", "C"]])));
  const res = await app.inject({ method: "POST", url: "/works/characters", payload: { workIds: ["merged-away", "w"] } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { characters: { "merged-away": ["A", "B", "C"], w: ["A", "B", "C"] } });
  assert.equal(res.headers["cache-control"], "no-store");
  await app.close();
});

test("characters route rejects 501 ids with 400", async () => {
  const app = appWith(() => undefined);
  const ids = Array.from({ length: 501 }, (_, i) => `w${i}`);
  assert.equal((await app.inject({ method: "POST", url: "/works/characters", payload: { workIds: ids } })).statusCode, 400);
  assert.equal((await app.inject({ method: "POST", url: "/works/characters", payload: { workIds: [""] } })).statusCode, 400);
  assert.equal((await app.inject({ method: "POST", url: "/works/characters", payload: {} })).statusCode, 400);
  await app.close();
});

test("characters route needs no token", async () => {
  const app = appWith(() => undefined);
  assert.equal((await app.inject({ method: "POST", url: "/works/characters", payload: { workIds: ["w"] } })).statusCode, 200);
  await app.close();
});
