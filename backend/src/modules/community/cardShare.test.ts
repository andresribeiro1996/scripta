import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { publicReaderCard, readerIdentity } from "@scripta/shared";
import Fastify from "fastify";
import type { CommunityDeps } from "./service.js";

const scratch = mkdtempSync(join(tmpdir(), "community-card-share-test-"));
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

const blankCard = publicReaderCard(readerIdentity([], [], "en"));
const unused = () => {
  throw new Error("card sharing does not read this");
};
const unusedGame = { get: unused, getMany: unused, listByOwner: unused, discoverWindow: unused, discoverByWorks: unused, participation: unused, shelfFacts: unused };

async function cardApp() {
  const db = openCommunityDb();
  const repo = createSqliteCommunityRepository(db);
  const deps: CommunityDeps = {
    repo,
    background: unused,
    getDashboardSeenAt: unused,
    setDashboardSeenAt: unused,
    resolveProfile: unused,
    resolveProfiles: (ids) => new Map(ids.filter((id) => id !== "ghost").map((id) => [id, { username: id, avatarUrl: null }])),
    resolveLibrary: unused,
    readerGlyphFor: unused,
    readerCardFor: () => blankCard,
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
  const as = (user: string, method: "GET" | "POST", url: string) => app.inject({ method, url, headers: { authorization: `Bearer ${user}` } });
  const publish = (userId: string, published: number) =>
    repo.upsertProfile({ user_id: userId, published, mural_id: null, published_at: null, updated_at: new Date().toISOString(), feed_settings: null });
  return { app, db, repo, as, publish };
}

test("share returns a link and is idempotent while live", async (t) => {
  const { app, as } = await cardApp();
  t.after(() => app.close());
  const first = (await as("alice", "POST", "/community/card/share")).json();
  const second = (await as("alice", "POST", "/community/card/share")).json();
  assert.equal(second.shareToken, first.shareToken);
  assert.ok(first.shareUrl.endsWith(`/shared/cards/${first.shareToken}`));
  assert.deepEqual((await as("alice", "GET", "/community/card/share")).json(), first);
});

test("unshare kills the token and resharing mints a new one", async (t) => {
  const { app, as } = await cardApp();
  t.after(() => app.close());
  const { shareToken } = (await as("alice", "POST", "/community/card/share")).json();
  assert.equal((await as("alice", "POST", "/community/card/unshare")).statusCode, 204);
  const gone = await app.inject({ method: "GET", url: `/community/cards/shared/${shareToken}` });
  assert.equal(gone.statusCode, 404);
  assert.equal(typeof gone.json().error, "string");
  const again = (await as("alice", "POST", "/community/card/share")).json();
  assert.notEqual(again.shareToken, shareToken);
});

test("share and unshare leave profiles.published unchanged", async (t) => {
  const { app, repo, as, publish } = await cardApp();
  t.after(() => app.close());
  publish("alice", 1);
  publish("bob", 0);
  for (const user of ["alice", "bob"]) {
    const published = repo.getProfileRow(user)?.published;
    await as(user, "POST", "/community/card/share");
    assert.equal(repo.getProfileRow(user)?.published, published);
    await as(user, "POST", "/community/card/unshare");
    assert.equal(repo.getProfileRow(user)?.published, published);
  }
});

test("public card returns visitor payload", async (t) => {
  const { app, as, publish } = await cardApp();
  t.after(() => app.close());
  publish("alice", 1);
  const { shareToken } = (await as("alice", "POST", "/community/card/share")).json();
  const res = await app.inject({ method: "GET", url: `/community/cards/shared/${shareToken}` });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["cache-control"], "no-store");
  const body = res.json();
  assert.equal(body.username, "alice");
  assert.equal(body.readerCard.state, blankCard.state);
  assert.equal(body.profileVisible, true);
  assert.deepEqual(Object.keys(body).sort(), ["profileVisible", "readerCard", "username"]);
});

test("public card still works for a private owner", async (t) => {
  const { app, as, publish } = await cardApp();
  t.after(() => app.close());
  publish("bob", 0);
  const { shareToken } = (await as("bob", "POST", "/community/card/share")).json();
  const res = await app.inject({ method: "GET", url: `/community/cards/shared/${shareToken}` });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().profileVisible, false);
});

test("unknown token is 404", async (t) => {
  const { app } = await cardApp();
  t.after(() => app.close());
  const res = await app.inject({ method: "GET", url: "/community/cards/shared/nope" });
  assert.equal(res.statusCode, 404);
  assert.equal(typeof res.json().error, "string");
});

test("a link whose owner has no username is 404", async (t) => {
  const { app, as } = await cardApp();
  t.after(() => app.close());
  const { shareToken } = (await as("ghost", "POST", "/community/card/share")).json();
  assert.equal((await app.inject({ method: "GET", url: `/community/cards/shared/${shareToken}` })).statusCode, 404);
});

test("GET /community/card/share without a link returns nulls", async (t) => {
  const { app, as } = await cardApp();
  t.after(() => app.close());
  const res = await as("carol", "GET", "/community/card/share");
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { shareToken: null, shareUrl: null });
});

test("deleteUserData removes the card share", async (t) => {
  const { app, repo, as } = await cardApp();
  t.after(() => app.close());
  const { shareToken } = (await as("dave", "POST", "/community/card/share")).json();
  repo.deleteUserData("dave");
  assert.equal(repo.getCardShareToken("dave"), null);
  assert.equal(repo.getCardShareOwner(shareToken), null);
});
