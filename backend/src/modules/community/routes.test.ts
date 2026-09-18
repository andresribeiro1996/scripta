import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";
import { DEFAULT_FEED_SETTINGS } from "@scripta/shared/community";
import { ProfileNotFoundError } from "./domain/errors.js";
import { buildCommunityRoutes, buildPublicCommunityRoutes } from "./routes.js";
import type { CommunityService } from "./service.js";

function fakeService(overrides: Partial<CommunityService> = {}): CommunityService {
  return {
    follow: () => {},
    unfollow: () => {},
    getFollowState: () => ({ following: false, followerCount: 0, followingCount: 0 }),
    publishProfile: () => {},
    unpublishProfile: () => {},
    getProfileByUsername: () => {
      throw new ProfileNotFoundError();
    },
    getDashboard: () => ({ items: [], nextCursor: null, newCount: 0 }),
    markDashboardSeen: () => {},
    getDiscover: () => ({ items: [], nextOffset: null }),
    searchPeople: () => [],
    emitEvent: () => {},
    getActivity: () => ({ items: [], nextCursor: null }),
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
