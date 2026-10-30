import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { DiscoverItem } from "@scripta/shared/community";
import type { DigestItem, TopShelfGame } from "@scripta/shared";
import { homeGames } from "../src/lib/homeGames.ts";

const author = (username: string) => ({ userId: username, username, avatarUrl: null });
const content = (id: string) => ({ kind: "tierlist" as const, id, voteCode: "abc", name: `Tier ${id}`, poolSize: 5, ballotCount: 1, votingOpen: true, promotedAt: null, covers: [] });
const game = (id: string, username: string): DiscoverItem => ({ author: author(username), content: content(id) });
const hot = (id: string, username: string): TopShelfGame => ({ item: game(id, username), likes: 1, votes: 2, comments: 3 });
const pub = (id: string, username: string): DigestItem => ({ kind: "publication", id: `e-${id}`, actor: author(username), type: "tierlist_published", content: content(id), createdAt: "2026-10-29T00:00:00.000Z" });
const reading = (id: string): DigestItem => ({ kind: "reading", id, actor: author("alice"), book: { title: "Hyperion", author: "Dan Simmons", coverUrl: null }, finished: false, createdAt: "2026-10-29T00:00:00.000Z" });

test("followed games come from the circle's publications, at most two", () => {
  const out = homeGames({ circle: [pub("t1", "alice"), reading("b1"), pub("q1", "alice"), pub("q2", "bob")], popular: [], newest: [], viewerId: "me" });
  assert.deepEqual(out.followed.map((g) => g.content.id), ["t1", "q1"]);
});

test("popular drops your own games and ones already followed, at most two", () => {
  const out = homeGames({ circle: [pub("t1", "alice")], popular: [hot("mine", "me"), hot("t1", "alice"), hot("p1", "joana"), hot("p2", "ines"), hot("p3", "x")], newest: [], viewerId: "me" });
  assert.deepEqual(out.others.map((g) => g.content.id), ["p1", "p2"]);
  assert.equal(out.othersLabel, "Popular this month");
});

test("with nothing followed or popular, the newest public games fill in", () => {
  const out = homeGames({ circle: [], popular: [], newest: [game("mine", "me"), game("n1", "joana"), game("n2", "ines")], viewerId: "me" });
  assert.deepEqual(out.others.map((g) => g.content.id), ["n1", "n2"]);
  assert.equal(out.othersLabel, "New games");
});

test("the Home badge counts the personal feed, and the new hooks keep the app's cache budget", () => {
  const layout = readFileSync(new URL("../src/layouts/DashboardLayout.tsx", import.meta.url), "utf8");
  assert.match(layout, /useActivityFeed\(\)/);
  const hooks = readFileSync(new URL("../src/hooks/useDashboard.ts", import.meta.url), "utf8");
  assert.match(hooks, /CIRCLE_DIGEST_KINDS/);
  assert.match(hooks, /PERSONAL_DIGEST_KINDS/);
  assert.equal(hooks.match(/staleTime: 30_000/g)?.length, 2);
});
