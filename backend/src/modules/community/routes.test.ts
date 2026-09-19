import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";
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
