import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_FEED_SETTINGS } from "@scripta/shared/community";
import Fastify from "fastify";
import type { DigestItem, ReaderProfile } from "@scripta/shared";

const scratch = mkdtempSync(join(tmpdir(), "engagement-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COMMUNITY_DB_PATH = join(scratch, "community.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);
const { openCommunityDb } = await import("./adapters/sqlite/connection.js");
const { createSqliteCommunityRepository } = await import("./adapters/sqlite/sqliteCommunityRepository.js");
const { createSqliteEngagementRepository } = await import("./adapters/sqlite/sqliteEngagementRepository.js");
const { createCommunityService } = await import("./service.js");
const { createEngagementService } = await import("./engagement.js");
const { buildEngagementRoutes } = await import("./engagementRoutes.js");
const { ProfileNotFoundError, InvalidCursorError } = await import("./domain/errors.js");

test("authenticated reactions, comments and saved content persist and enforce ownership", async () => {
  const db = openCommunityDb();
  const repo = createSqliteEngagementRepository(db);
  const communityRepo = createSqliteCommunityRepository(db);
  const createdAt = "2026-10-14T10:00:00.000Z";
  const actor = { userId: "author", username: "author", avatarUrl: null };
  const item: DigestItem = { kind: "publication", id: "event", actor, type: "quiz_published", content: { kind: "quiz", id: "quiz", name: "Quiz", voteCode: "play", questionCount: 2, playCount: 0, playOpen: true, covers: [] }, createdAt };
  const profiles = new Map<string, ReaderProfile>(["reader", "other"].map(id => [id, { username: id, avatarUrl: null }]));
  let visible = true;
  let contentExists = true;
  let clock = Date.parse(createdAt);
  const service = createEngagementService({ repo, now: () => clock++, resolveProfiles: ids => new Map(ids.flatMap(id => profiles.has(id) ? [[id, profiles.get(id)!]] : [])), community: {
    resolveEvent: () => { if (!visible) throw new ProfileNotFoundError(); return item; },
    visibleEventIds: (_viewer, events) => new Set(visible ? events.map(event => event.id) : []),
    resolveSavedContent: (_viewer, ref, at) => { if (!contentExists) throw new ProfileNotFoundError(); return { ...item, id: `saved:${ref.kind}:${ref.id}`, createdAt: at }; }
  } });
  communityRepo.insertEvent({ id: item.id, user_id: "author", type: "quiz_published", ref_type: "quiz", ref_id: "quiz", payload: null, created_at: createdAt });
  const app = Fastify();
  app.decorate("authenticateAccessToken", (token: string) => ({ id: token, email: `${token}@test.local`, username: token, avatarId: null }));
  await app.register(buildEngagementRoutes(service));
  const headers = { authorization: "Bearer reader" };
  const send = (method: "POST" | "PUT" | "DELETE", url: string, payload?: object) => app.inject({ method, url, headers, payload });
  try {
    assert.equal((await app.inject({ method: "PUT", url: "/community/activity/event/like", payload: { liked: true } })).statusCode, 401);
    assert.deepEqual((await send("PUT", "/community/activity/event/like", { liked: true })).json(), { likes: 1, comments: 0, liked: true });
    await send("PUT", "/community/activity/event/like", { liked: true });
    assert.equal(service.getEngagement("other", ["event"]).event?.likes, 1);
    assert.equal((await send("POST", "/community/activity/event/comments", { text: "   " })).statusCode, 400);
    assert.equal((await send("POST", "/community/activity/event/comments", { text: "x".repeat(1501) })).statusCode, 400);
    assert.equal((await send("POST", "/community/activity/event/comments", { text: "  Great quiz  " })).statusCode, 204);
    service.addComment("other", "event", "Second");
    const first = service.getComments("reader", "event", undefined, 1);
    assert.equal(first.items[0]?.text, "Second");
    assert.equal(first.items[0]?.own, false);
    assert.ok(first.nextCursor);
    const second = service.getComments("reader", "event", first.nextCursor!, 1);
    assert.equal(second.items[0]?.text, "Great quiz");
    assert.equal(second.items[0]?.own, true);
    assert.equal(second.nextCursor, null);
    assert.equal((await send("DELETE", `/community/activity/comments/${first.items[0]!.id}`)).statusCode, 404);
    assert.equal((await send("DELETE", `/community/activity/comments/${second.items[0]!.id}`)).statusCode, 204);
    const ref = { kind: "quiz" as const, id: "quiz" };
    await send("PUT", "/community/saved", { ref, saved: true });
    await send("PUT", "/community/saved", { ref, saved: true });
    assert.deepEqual(service.getSavedState("reader", [ref]), ["quiz:quiz"]);
    assert.deepEqual(service.getSavedState("other", [ref]), []);
    assert.equal(service.getSaved("reader", undefined, 10).items.length, 1);
    contentExists = false;
    assert.equal(service.getSaved("reader", undefined, 10).items.length, 0);
    assert.equal((await send("PUT", "/community/saved", { ref, saved: true })).statusCode, 404);
    assert.equal((await send("PUT", "/community/saved", { ref, saved: false })).statusCode, 204);
    visible = false;
    assert.deepEqual(service.getEngagement("reader", ["event"]), {});
    assert.equal((await send("PUT", "/community/activity/event/like", { liked: true })).statusCode, 404);
    assert.equal((await app.inject({ method: "GET", url: "/community/activity/event/comments", headers })).statusCode, 404);
    visible = true;
    assert.throws(() => service.getComments("reader", "event", "invalid", 10), InvalidCursorError);
    communityRepo.moveEventsBefore("2027-01-01T00:00:00.000Z", 10);
    assert.equal(repo.getEvent("event")?.id, "event");
    assert.equal(service.getEngagement("reader", ["event"]).event?.comments, 1);
    communityRepo.deleteUserData("author");
    assert.deepEqual(repo.summaries("reader", ["event"]).event, { likes: 0, comments: 0, liked: false });
  } finally { await app.close(); db.close(); }
});

test("engagement counts only the events whose author's switch shows them, in one batch", () => {
  const db = openCommunityDb();
  const communityRepo = createSqliteCommunityRepository(db);
  const repo = createSqliteEngagementRepository(db);
  const unused = () => { throw new Error("engagement does not read this"); };
  const community = createCommunityService({
    repo: communityRepo, background: unused, getDashboardSeenAt: unused, setDashboardSeenAt: unused, resolveProfile: unused,
    resolveProfiles: ids => new Map(ids.map(id => [id, { username: id, avatarUrl: null }])),
    resolveLibrary: unused, readerGlyphFor: () => null, sharedBookCounts: unused, sharedBooks: unused, userHasUsername: unused, findUserIdByUsername: unused, searchUsernameOwners: unused, matchWorks: unused,
    murals: { ownsMural: unused, getMuralPublicPayload: unused, getMuralSummary: unused },
    tierlists: { discoverWindow: unused, getPublishedMany: unused, votedAmong: unused, get: unused, listByOwner: unused, discoverByWorks: unused, fillRankingCovers: unused },
    tournaments: { completedForParticipant: unused, discoverWindow: unused, getPublishedMany: unused, votedAmong: unused, get: unused, listByOwner: unused, discoverByWorks: unused },
    quizzes: { discoverWindow: unused, getPublishedMany: unused, votedAmong: unused, get: unused, listByOwner: unused, discoverByWorks: unused },
    participation: { tierlists: unused, tournaments: unused, quizzes: unused }
  });
  const service = createEngagementService({ repo, community, resolveProfiles: ids => new Map(ids.map(id => [id, { username: id, avatarUrl: null }])) });
  const at = "2026-10-14T10:00:00.000Z";
  const book = (id: string, userId: string) => communityRepo.insertEvent({ id, user_id: userId, type: "book_added", ref_type: "book", ref_id: id, payload: JSON.stringify({ title: id, author: "A" }), created_at: at });
  communityRepo.upsertProfile({ user_id: "shown", published: 1, mural_id: null, published_at: at, updated_at: at, feed_settings: null });
  communityRepo.upsertProfile({ user_id: "hidden", published: 1, mural_id: null, published_at: at, updated_at: at, feed_settings: null });
  communityRepo.upsertProfile({ user_id: "private", published: 0, mural_id: null, published_at: null, updated_at: at, feed_settings: null });
  communityRepo.updateFeedSettings("shown", { ...DEFAULT_FEED_SETTINGS, reading: true });
  communityRepo.updateFeedSettings("hidden", DEFAULT_FEED_SETTINGS);
  communityRepo.updateFeedSettings("private", { ...DEFAULT_FEED_SETTINGS, reading: true });
  communityRepo.updateFeedSettings("reader", DEFAULT_FEED_SETTINGS);
  book("a", "shown"); book("b", "shown"); book("c", "hidden"); book("d", "private"); book("own", "reader");
  communityRepo.moveEventsBefore("2027-01-01T00:00:00.000Z", 10);
  book("e", "shown");
  try {
    assert.deepEqual(Object.keys(service.getEngagement("reader", ["a", "b", "c", "d", "e", "own", "missing"])).sort(), ["a", "b", "e", "own"]);
    service.setLiked("reader", "a", true);
    assert.equal(service.getEngagement("reader", ["a", "b"]).a?.likes, 1);
    assert.throws(() => service.setLiked("reader", "c", true), ProfileNotFoundError);
    assert.throws(() => service.setLiked("reader", "d", true), ProfileNotFoundError);
    assert.deepEqual(service.getEngagement("reader", ["c"]), {});
  } finally { db.close(); }
});
