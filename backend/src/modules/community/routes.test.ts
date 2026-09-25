import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import Fastify from "fastify";
import { DEFAULT_FEED_SETTINGS } from "@scripta/shared/community";
import type { CommunityService } from "./service.js";

const scratch = mkdtempSync(join(tmpdir(), "community-routes-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.GALLERY_STORAGE_PATH = join(scratch, "gallery-files");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);
process.env.NODE_ENV = "test";

const { ProfileNotFoundError } = await import("./domain/errors.js");
const { buildCommunityRoutes, buildPublicCommunityRoutes } = await import("./routes.js");

function fakeService(overrides: Partial<CommunityService> = {}): CommunityService {
  return {
    follow: () => {},
    unfollow: () => {},
    getFollowState: () => ({ following: false, followerCount: 0, followingCount: 0 }),
    publishProfile: () => {},
    unpublishProfile: () => {},
    getOwnProfile: () => {
      throw new ProfileNotFoundError();
    },
    setShelfMural: () => {
      throw new ProfileNotFoundError();
    },
    getProfileByUsername: () => {
      throw new ProfileNotFoundError();
    },
    getDashboard: () => ({ items: [], nextCursor: null, newCount: 0 }),
    markDashboardSeen: () => {},
    getDiscover: () => ({ items: [], nextOffset: null }),
    searchPeople: () => [],
    emitEvent: () => {},
    getActivity: () => ({ items: [], nextCursor: null }),
    getLibrary: () => {
      throw new ProfileNotFoundError();
    },
    getFeedSettings: () => DEFAULT_FEED_SETTINGS,
    updateFeedSettings: () => {},
    ...overrides
  };
}

test("public profile 404s when unpublished", async () => {
  const app = Fastify();
  await app.register(buildPublicCommunityRoutes(fakeService()));
  const res = await app.inject({ method: "GET", url: "/community/profiles/ghost" });
  assert.equal(res.statusCode, 404);
  await app.close();
});

test("discover passes type/q/limit/offset through", async () => {
  const seen: Array<Record<string, unknown>> = [];
  const app = Fastify();
  await app.register(
    buildPublicCommunityRoutes(
      fakeService({
        getDiscover: (type, q, limit, offset) => {
          seen.push({ type, q, limit, offset });
          return { items: [], nextOffset: null };
        }
      })
    )
  );
  const res = await app.inject({ method: "GET", url: "/community/discover?type=tierlist&q=fantasy&limit=5&offset=5" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(seen, [{ type: "tierlist", q: "fantasy", limit: 5, offset: 5 }]);
  await app.close();
});

test("discover passes the viewer through when signed in", async () => {
  const seen: Array<string | undefined> = [];
  const app = Fastify();
  app.decorate("authenticateAccessToken", () => ({ id: "viewer", email: "v@example.test", username: "v", avatarId: null }));
  await app.register(
    buildPublicCommunityRoutes(
      fakeService({
        getDiscover: (_type, _q, _limit, _offset, viewerId) => {
          seen.push(viewerId);
          return { items: [], nextOffset: null };
        }
      })
    )
  );
  await app.inject({ method: "GET", url: "/community/discover", headers: { authorization: "Bearer x" } });
  await app.inject({ method: "GET", url: "/community/discover" });
  assert.deepEqual(seen, ["viewer", undefined]);
  await app.close();
});

test("discover rejects a bad type with 400", async () => {
  const app = Fastify();
  await app.register(buildPublicCommunityRoutes(fakeService()));
  const res = await app.inject({ method: "GET", url: "/community/discover?type=nope" });
  assert.equal(res.statusCode, 400);
  await app.close();
});

test("activity endpoint returns the page and passes the viewer through when signed in", async () => {
  const seen: Array<Record<string, unknown>> = [];
  const app = Fastify();
  app.decorate("authenticateAccessToken", () => ({ id: "viewer", email: "v@example.test", username: "v", avatarId: null }));
  await app.register(
    buildPublicCommunityRoutes(
      fakeService({
        getActivity: (username, viewerId, cursor, limit) => {
          seen.push({ username, viewerId, cursor, limit });
          return { items: [], nextCursor: null };
        }
      })
    )
  );
  const auth = { authorization: "Bearer x" };
  const res = await app.inject({ method: "GET", url: "/community/profiles/alice/activity?limit=5", headers: auth });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.payload), { items: [], nextCursor: null });
  assert.deepEqual(seen, [{ username: "alice", viewerId: "viewer", cursor: undefined, limit: 5 }]);
  const anon = await app.inject({ method: "GET", url: "/community/profiles/alice/activity?cursor=abc" });
  assert.equal(anon.statusCode, 200);
  assert.deepEqual(seen[1], { username: "alice", viewerId: undefined, cursor: "abc", limit: 20 });
  await app.close();
});

test("activity endpoint rejects a bad limit with 400", async () => {
  const app = Fastify();
  await app.register(buildPublicCommunityRoutes(fakeService()));
  const res = await app.inject({ method: "GET", url: "/community/profiles/alice/activity?limit=0" });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, "Invalid activity query.");
  await app.close();
});

test("feed-settings PUT validates the body and records the update", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const app = Fastify();
  app.decorate("authenticateAccessToken", () => ({ id: "viewer", email: "v@example.test", username: "v", avatarId: null }));
  await app.register(
    buildCommunityRoutes(
      fakeService({
        updateFeedSettings: (userId, settings) => {
          calls.push({ userId, settings });
        }
      })
    )
  );
  const auth = { authorization: "Bearer x" };
  const bad = await app.inject({ method: "PUT", url: "/community/profile/feed-settings", headers: auth, payload: { publications: "yes" } });
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.json().error, "Expected { publications, reading, votes, follows } booleans.");
  assert.equal(calls.length, 0);
  const good = await app.inject({
    method: "PUT",
    url: "/community/profile/feed-settings",
    headers: auth,
    payload: { publications: false, reading: true, votes: false, follows: true }
  });
  assert.equal(good.statusCode, 204);
  assert.deepEqual(calls, [{ userId: "viewer", settings: { publications: false, reading: true, votes: false, follows: true } }]);
  await app.close();
});

test("own profile GET and shelf mural PUT are authed and validate the body", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const app = Fastify();
  app.decorate("authenticateAccessToken", () => ({ id: "viewer", email: "v@example.test", username: "v", avatarId: null }));
  await app.register(
    buildCommunityRoutes(
      fakeService({
        getOwnProfile: (userId) => ({ muralId: userId === "viewer" ? "m1" : null, published: false, feedSettings: { publications: true, reading: false, votes: true, follows: true } }),
        setShelfMural: (userId, muralId) => {
          calls.push({ userId, muralId });
        }
      })
    )
  );
  const auth = { authorization: "Bearer x" };
  const own = await app.inject({ method: "GET", url: "/community/profile", headers: auth });
  assert.equal(own.statusCode, 200);
  assert.equal(own.json().muralId, "m1");
  const bad = await app.inject({ method: "PUT", url: "/community/profile/mural", headers: auth, payload: {} });
  assert.equal(bad.statusCode, 400);
  const good = await app.inject({ method: "PUT", url: "/community/profile/mural", headers: auth, payload: { muralId: "m2" } });
  assert.equal(good.statusCode, 204);
  assert.deepEqual(calls, [{ userId: "viewer", muralId: "m2" }]);
  await app.close();
});

test("dashboard routes pass cursor/limit through and mark seen", async () => {
  const seen: Array<Record<string, unknown>> = [];
  let marked = 0;
  const app = Fastify();
  app.decorate("authenticateAccessToken", () => ({ id: "viewer", email: "v@example.test", username: "v", avatarId: null }));
  await app.register(
    buildCommunityRoutes(
      fakeService({
        getDashboard: (_viewerId, cursor, limit) => {
          seen.push({ cursor, limit });
          return { items: [], nextCursor: null, newCount: 0 };
        },
        markDashboardSeen: () => {
          marked += 1;
        }
      })
    )
  );
  const auth = { authorization: "Bearer x" };
  const res = await app.inject({ method: "GET", url: "/community/dashboard?cursor=abc&limit=5", headers: auth });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(seen, [{ cursor: "abc", limit: 5 }]);
  const seenRes = await app.inject({ method: "POST", url: "/community/dashboard/seen", headers: auth });
  assert.equal(seenRes.statusCode, 204);
  assert.equal(marked, 1);
  await app.close();
});

test("library endpoint returns the owner's library and 404s when unpublished", async () => {
  const app = Fastify();
  await app.register(buildPublicCommunityRoutes(fakeService({ getLibrary: (username) => ({ data: username === "alice" ? { books: [] } : null }) })));
  const ok = await app.inject({ method: "GET", url: "/community/profiles/alice/library" });
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(ok.json(), { data: { books: [] } });
  await app.close();

  const hidden = Fastify();
  await hidden.register(buildPublicCommunityRoutes(fakeService()));
  const res = await hidden.inject({ method: "GET", url: "/community/profiles/ghost/library" });
  assert.equal(res.statusCode, 404);
  await hidden.close();
});
