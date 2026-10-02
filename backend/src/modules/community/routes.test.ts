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
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);
process.env.NODE_ENV = "test";

const { FollowLimitError, MuralNotOwnedError, ProfileNotFoundError } = await import("./domain/errors.js");
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
    getDashboard: () => ({ items: [], nextCursor: null, seenAt: null, personalNewCount: 0, followingNewCount: 0, newCount: 0 }),
    markDashboardSeen: () => {},
    getDiscover: () => ({ items: [], nextOffset: null }),
    searchPeople: () => [],
    suggestPeople: () => [],
    emitEvent: () => {},
    getActivity: () => ({ items: [], nextCursor: null }),
    getLibrary: () => {
      throw new ProfileNotFoundError();
    },
    getFeedSettings: () => DEFAULT_FEED_SETTINGS,
    updateFeedSettings: () => {},
    archiveOldEvents: async () => ({ moved: 0, purged: 0 }),
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

test("activity endpoint derives the viewer from the bearer token, not a fixed user", async () => {
  const seen: Array<string | undefined> = [];
  const app = Fastify();
  app.decorate("authenticateAccessToken", (token: string) => ({ id: `user-${token}`, email: "u@example.test", username: `user-${token}`, avatarId: null }));
  await app.register(
    buildPublicCommunityRoutes(
      fakeService({
        getActivity: (_username, viewerId) => {
          seen.push(viewerId);
          return { items: [], nextCursor: null };
        }
      })
    )
  );
  await app.inject({ method: "GET", url: "/community/profiles/alice/activity", headers: { authorization: "Bearer abc123" } });
  assert.deepEqual(seen, ["user-abc123"]);
  await app.close();
});

test("activity endpoint rejects a cursor over 200 characters with 400", async () => {
  const seen: Array<string | undefined> = [];
  const app = Fastify();
  await app.register(
    buildPublicCommunityRoutes(
      fakeService({
        getActivity: (_username, _viewerId, cursor) => {
          seen.push(cursor);
          return { items: [], nextCursor: null };
        }
      })
    )
  );
  const longest = await app.inject({ method: "GET", url: `/community/profiles/alice/activity?cursor=${"a".repeat(200)}` });
  assert.equal(longest.statusCode, 200);
  const tooLong = await app.inject({ method: "GET", url: `/community/profiles/alice/activity?cursor=${"a".repeat(201)}` });
  assert.equal(tooLong.statusCode, 400);
  assert.equal(tooLong.json().error, "Invalid activity query.");
  assert.deepEqual(seen, ["a".repeat(200)]);
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

test("feed-settings PUT accepts an optional readerGlyph flag", async () => {
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
  const withGlyph = await app.inject({
    method: "PUT",
    url: "/community/profile/feed-settings",
    headers: auth,
    payload: { publications: true, reading: false, votes: true, follows: true, readerGlyph: true }
  });
  assert.equal(withGlyph.statusCode, 204);
  const withoutGlyph = await app.inject({
    method: "PUT",
    url: "/community/profile/feed-settings",
    headers: auth,
    payload: { publications: true, reading: false, votes: true, follows: true }
  });
  assert.equal(withoutGlyph.statusCode, 204);
  assert.deepEqual(calls, [
    { userId: "viewer", settings: { publications: true, reading: false, votes: true, follows: true, readerGlyph: true } },
    { userId: "viewer", settings: { publications: true, reading: false, votes: true, follows: true } }
  ]);
  await app.close();
});

test("publish PUT takes a muralId, a shareReading flag, both or neither, and rejects anything else", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const app = Fastify();
  app.decorate("authenticateAccessToken", () => ({ id: "viewer", email: "v@example.test", username: "v", avatarId: null }));
  await app.register(
    buildCommunityRoutes(
      fakeService({
        publishProfile: (userId, input) => {
          calls.push({ userId, input });
        }
      })
    )
  );
  const noAuth = await app.inject({ method: "PUT", url: "/community/profile/publish", payload: {} });
  assert.equal(noAuth.statusCode, 401);
  const auth = { authorization: "Bearer x" };
  const send = (payload: object) => app.inject({ method: "PUT", url: "/community/profile/publish", headers: auth, payload });
  assert.equal((await send({})).statusCode, 200);
  assert.equal((await send({ muralId: "m1" })).statusCode, 200);
  assert.equal((await send({ shareReading: false })).statusCode, 200);
  assert.equal((await send({ muralId: "m1", shareReading: true })).statusCode, 200);
  assert.deepEqual(calls, [
    { userId: "viewer", input: {} },
    { userId: "viewer", input: { muralId: "m1" } },
    { userId: "viewer", input: { shareReading: false } },
    { userId: "viewer", input: { muralId: "m1", shareReading: true } }
  ]);
  const badFlag = await send({ shareReading: "yes" });
  assert.equal(badFlag.statusCode, 400);
  assert.equal(badFlag.json().error, "Expected {muralId?, shareReading?}.");
  assert.equal((await send({ muralId: "" })).statusCode, 400);
  assert.equal((await send({ muralId: 7 })).statusCode, 400);
  assert.equal(calls.length, 4);
  await app.close();
});

test("publish PUT reports a mural the user doesn't own as a 400", async () => {
  const app = Fastify();
  app.decorate("authenticateAccessToken", () => ({ id: "viewer", email: "v@example.test", username: "v", avatarId: null }));
  await app.register(
    buildCommunityRoutes(
      fakeService({
        publishProfile: () => {
          throw new MuralNotOwnedError();
        }
      })
    )
  );
  const res = await app.inject({ method: "PUT", url: "/community/profile/publish", headers: { authorization: "Bearer x" }, payload: { muralId: "theirs" } });
  assert.equal(res.statusCode, 400);
  await app.close();
});

test("follow POST passes both ids through, and answers 404 for a reader who can't be followed", async () => {
  const followed: Array<[string, string]> = [];
  const app = Fastify();
  app.decorate("authenticateAccessToken", () => ({ id: "viewer", email: "v@example.test", username: "v", avatarId: null }));
  await app.register(
    buildCommunityRoutes(
      fakeService({
        follow: (followerId, followeeId) => {
          if (followeeId === "private") throw new ProfileNotFoundError();
          followed.push([followerId, followeeId]);
        }
      })
    )
  );
  const auth = { authorization: "Bearer x" };
  const ok = await app.inject({ method: "POST", url: "/community/follows", headers: auth, payload: { userId: "alice" } });
  assert.equal(ok.statusCode, 204);
  const refused = await app.inject({ method: "POST", url: "/community/follows", headers: auth, payload: { userId: "private" } });
  assert.equal(refused.statusCode, 404);
  assert.equal(refused.json().error, "No published profile at that address.");
  assert.deepEqual(followed, [["viewer", "alice"]]);
  await app.close();
});

test("follow POST answers 409 with the limit in plain words when the reader already follows 1,000 accounts", async () => {
  const app = Fastify();
  app.decorate("authenticateAccessToken", () => ({ id: "viewer", email: "v@example.test", username: "v", avatarId: null }));
  await app.register(
    buildCommunityRoutes(
      fakeService({
        follow: () => {
          throw new FollowLimitError();
        }
      })
    )
  );
  const res = await app.inject({ method: "POST", url: "/community/follows", headers: { authorization: "Bearer x" }, payload: { userId: "alice" } });
  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.json(), { error: "You can follow up to 1,000 readers." });
  await app.close();
});

test("suggested people GET is authed, defaults the limit to 20, and validates it", async () => {
  const seen: Array<Record<string, unknown>> = [];
  const suggestion = { user: { username: "reader", avatarUrl: null, userId: "u1" }, followerCount: 0, viewerFollows: false, private: false, sharedCount: 1, sharedBooks: [{ title: "Dune", author: "Frank Herbert", coverUrl: null }] };
  const app = Fastify();
  app.decorate("authenticateAccessToken", () => ({ id: "viewer", email: "v@example.test", username: "v", avatarId: null }));
  await app.register(
    buildCommunityRoutes(
      fakeService({
        suggestPeople: (viewerId, limit) => {
          seen.push({ viewerId, limit });
          return [suggestion];
        }
      })
    )
  );
  const noAuth = await app.inject({ method: "GET", url: "/community/people/suggested" });
  assert.equal(noAuth.statusCode, 401);
  const auth = { authorization: "Bearer x" };
  const res = await app.inject({ method: "GET", url: "/community/people/suggested", headers: auth });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { people: [suggestion] });
  assert.equal((await app.inject({ method: "GET", url: "/community/people/suggested?limit=5", headers: auth })).statusCode, 200);
  assert.equal((await app.inject({ method: "GET", url: "/community/people/suggested?limit=0", headers: auth })).statusCode, 400);
  assert.equal((await app.inject({ method: "GET", url: "/community/people/suggested?limit=51", headers: auth })).statusCode, 400);
  assert.deepEqual(seen, [{ viewerId: "viewer", limit: 20 }, { viewerId: "viewer", limit: 5 }]);
  await app.close();
});

test("suggested people GET allows 30 requests a minute, and no other authed route shares that limit", async () => {
  const app = Fastify();
  app.decorate("authenticateAccessToken", () => ({ id: "viewer", email: "v@example.test", username: "v", avatarId: null }));
  await app.register(buildCommunityRoutes(fakeService()));
  const auth = { authorization: "Bearer x" };
  const suggested = () => app.inject({ method: "GET", url: "/community/people/suggested", headers: auth });
  for (let request = 1; request <= 30; request++) assert.equal((await suggested()).statusCode, 200);
  assert.equal((await suggested()).statusCode, 429);
  assert.equal((await app.inject({ method: "GET", url: "/community/people?q=reader", headers: auth })).statusCode, 200);
  await app.close();
});

async function appWithAccounts() {
  const app = Fastify();
  app.decorate("authenticateAccessToken", (token: string) => ({ id: token, email: `${token}@example.test`, username: token, avatarId: null }));
  await app.register(buildCommunityRoutes(fakeService()));
  const get = (url: string, token: string) => app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } });
  return { app, get };
}

test("dashboard allows 60 requests a minute per account, and no other authed route shares that limit", async () => {
  const { app, get } = await appWithAccounts();
  for (let request = 1; request <= 60; request++) assert.equal((await get("/community/dashboard", "alice")).statusCode, 200);
  assert.equal((await get("/community/dashboard", "alice")).statusCode, 429);
  assert.equal((await get("/community/dashboard", "bob")).statusCode, 200);
  assert.equal((await get("/community/people?q=reader", "alice")).statusCode, 200);
  await app.close();
});

test("people search allows 60 requests a minute per account, and no other authed route shares that limit", async () => {
  const { app, get } = await appWithAccounts();
  for (let request = 1; request <= 60; request++) assert.equal((await get("/community/people?q=reader", "alice")).statusCode, 200);
  assert.equal((await get("/community/people?q=reader", "alice")).statusCode, 429);
  assert.equal((await get("/community/people?q=reader", "bob")).statusCode, 200);
  assert.equal((await get("/community/dashboard", "alice")).statusCode, 200);
  await app.close();
});

test("following and unfollowing share one bucket of 30 a minute per account, apart from other accounts and every other community route", async () => {
  const { app, get } = await appWithAccounts();
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const follow = (token: string) => app.inject({ method: "POST", url: "/community/follows", headers: bearer(token), payload: { userId: "carol" } });
  const unfollow = (token: string) => app.inject({ method: "DELETE", url: "/community/follows/carol", headers: bearer(token) });
  for (let request = 0; request < 30; request++) assert.equal((await (request % 2 === 0 ? follow : unfollow)("alice")).statusCode, 204);
  assert.equal((await follow("alice")).statusCode, 429);
  assert.equal((await unfollow("alice")).statusCode, 429);
  assert.equal((await follow("bob")).statusCode, 204);
  assert.equal((await unfollow("bob")).statusCode, 204);
  assert.equal((await get("/community/dashboard", "alice")).statusCode, 200);
  assert.equal((await get("/community/people?q=reader", "alice")).statusCode, 200);
  assert.equal((await get("/community/people/suggested", "alice")).statusCode, 200);
  const settings = { publications: true, reading: false, votes: true, follows: true };
  assert.equal((await app.inject({ method: "PUT", url: "/community/profile/feed-settings", headers: bearer("alice"), payload: settings })).statusCode, 204);
  await app.close();
});

test("saving feed settings and publishing share one bucket of 30 a minute per account, apart from other accounts and every other community route", async () => {
  const { app, get } = await appWithAccounts();
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const settings = { publications: true, reading: true, votes: true, follows: true };
  const saveSettings = (token: string) => app.inject({ method: "PUT", url: "/community/profile/feed-settings", headers: bearer(token), payload: settings });
  const publish = (token: string) => app.inject({ method: "PUT", url: "/community/profile/publish", headers: bearer(token), payload: { shareReading: true } });
  for (let request = 0; request < 30; request++) assert.equal((await (request % 2 === 0 ? saveSettings : publish)("alice")).statusCode, request % 2 === 0 ? 204 : 200);
  assert.equal((await saveSettings("alice")).statusCode, 429);
  assert.equal((await publish("alice")).statusCode, 429);
  assert.equal((await saveSettings("bob")).statusCode, 204);
  assert.equal((await publish("bob")).statusCode, 200);
  assert.equal((await app.inject({ method: "DELETE", url: "/community/profile/publish", headers: bearer("alice") })).statusCode, 204);
  assert.equal((await app.inject({ method: "POST", url: "/community/follows", headers: bearer("alice"), payload: { userId: "carol" } })).statusCode, 204);
  assert.equal((await get("/community/dashboard", "alice")).statusCode, 200);
  assert.equal((await get("/community/people?q=reader", "alice")).statusCode, 200);
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
          if (muralId === "not-owned") throw new MuralNotOwnedError();
          calls.push({ userId, muralId });
        }
      })
    )
  );
  const noAuth = await app.inject({ method: "GET", url: "/community/profile" });
  assert.equal(noAuth.statusCode, 401);
  const auth = { authorization: "Bearer x" };
  const own = await app.inject({ method: "GET", url: "/community/profile", headers: auth });
  assert.equal(own.statusCode, 200);
  assert.equal(own.json().muralId, "m1");
  const bad = await app.inject({ method: "PUT", url: "/community/profile/mural", headers: auth, payload: {} });
  assert.equal(bad.statusCode, 400);
  const notOwned = await app.inject({ method: "PUT", url: "/community/profile/mural", headers: auth, payload: { muralId: "not-owned" } });
  assert.equal(notOwned.statusCode, 400);
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
          return { items: [], nextCursor: null, seenAt: null, personalNewCount: 0, followingNewCount: 0, newCount: 3 };
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
  assert.equal(res.json().newCount, 3);
  assert.deepEqual(seen, [{ cursor: "abc", limit: 5 }]);
  const seenRes = await app.inject({ method: "POST", url: "/community/dashboard/seen", headers: auth });
  assert.equal(seenRes.statusCode, 204);
  assert.equal(marked, 1);
  await app.close();
});

test("dashboard forwards the kinds the client lists, and nothing when it lists none", async () => {
  const seen: Array<ReadonlySet<string> | undefined> = [];
  const app = Fastify();
  app.decorate("authenticateAccessToken", () => ({ id: "viewer", email: "v@example.test", username: "v", avatarId: null }));
  await app.register(
    buildCommunityRoutes(
      fakeService({
        getDashboard: (_viewerId, _cursor, _limit, kinds) => {
          seen.push(kinds);
          return { items: [], nextCursor: null, seenAt: null, personalNewCount: 0, followingNewCount: 0, newCount: 0 };
        }
      })
    )
  );
  const auth = { authorization: "Bearer x" };
  const listed = await app.inject({ method: "GET", url: "/community/dashboard?kinds=publication,participation", headers: auth });
  assert.equal(listed.statusCode, 200);
  const unlisted = await app.inject({ method: "GET", url: "/community/dashboard", headers: auth });
  assert.equal(unlisted.statusCode, 200);
  assert.deepEqual(seen, [new Set(["publication", "participation"]), undefined]);
  await app.close();
});

test("dashboard rejects an empty, malformed or oversized kinds, and an oversized cursor, with 400", async () => {
  const app = Fastify();
  app.decorate("authenticateAccessToken", () => ({ id: "viewer", email: "v@example.test", username: "v", avatarId: null }));
  await app.register(buildCommunityRoutes(fakeService()));
  const auth = { authorization: "Bearer x" };
  for (const query of ["kinds=", "kinds=Pub!", `kinds=${"a".repeat(201)}`, `cursor=${"a".repeat(201)}`]) {
    const res = await app.inject({ method: "GET", url: `/community/dashboard?${query}`, headers: auth });
    assert.equal(res.statusCode, 400, query);
    assert.equal(res.json().error, "Invalid cursor/limit/kinds.");
  }
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
