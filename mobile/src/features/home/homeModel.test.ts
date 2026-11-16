process.env.TZ = "America/Sao_Paulo";

import assert from "node:assert/strict";
import { test } from "node:test";
import type { DiscoverItem } from "@scripta/shared/community";
import { contentKindLabel, contentTarget } from "../community/communityHome";
import { currentRead, gamesBrowseHref, newGameRows } from "./homeModel";

const author = (username: string) => ({ userId: `u-${username}`, username, avatarUrl: null });
const quiz: DiscoverItem = {
  author: author("joao"),
  content: { kind: "quiz", id: "q1", voteCode: "qc", name: "Guess the classic", questionCount: 5, playCount: 248, playOpen: true, covers: ["q.png"] }
};
const tournament: DiscoverItem = {
  author: author("marta"),
  content: { kind: "tournament", id: "t1", name: "The fantasy final", bracketSize: 16, status: "active", bookCount: 16, covers: ["t.png"] }
};
const tierlist: DiscoverItem = {
  author: author("ana"),
  content: { kind: "tierlist", id: "l1", voteCode: "lc", name: "Doorstoppers", poolSize: 24, ballotCount: 7, votingOpen: true, promotedAt: null, covers: ["l.png"] }
};

test("currentRead is null with no library or nothing reading", () => {
  assert.equal(currentRead(undefined), null);
  assert.equal(currentRead([{ Title: "A", ReadStatus: 2 }]), null);
});
test("newGameRows keeps the first two items", () => {
  assert.deepEqual(newGameRows([quiz, tournament, tierlist], "en", null).map((row) => row.name), ["Guess the classic", "The fantasy final"]);
  assert.equal(newGameRows([quiz], "en", null).length, 1);
  assert.deepEqual(newGameRows([], "en", null), []);
});
test("newGameRows skips the viewer's own games before taking two", () => {
  assert.deepEqual(newGameRows([quiz, tournament, tierlist], "en", "u-joao").map((row) => row.name), ["The fantasy final", "Doorstoppers"]);
  assert.deepEqual(newGameRows([quiz, tournament], "en", "u-joao").map((row) => row.name), ["The fantasy final"]);
});
test("newGameRows meta names the author and the kind's headline count", () => {
  const [q, t, l] = [quiz, tournament, tierlist].map((item) => newGameRows([item], "en", null)[0]!);
  assert.equal(q.meta, "by @joao · 248 plays");
  assert.equal(t.meta, "by @marta · 16 books");
  assert.equal(l.meta, "by @ana · 7 ballots");
  assert.equal(q.target, contentTarget(quiz.content));
  assert.equal(q.kind, contentKindLabel(quiz.content, "en"));
});
test("newGameRows meta for an unavailable author", () => {
  const gone = { ...quiz, author: { ...quiz.author, username: "Original creator unavailable", unavailable: true } };
  assert.equal(newGameRows([gone], "en", null)[0]!.meta, "Original creator unavailable · 248 plays");
});
test("newGameRows meta in pt-PT", () => {
  assert.match(newGameRows([quiz], "pt-PT", null)[0]!.meta, /^de @joao · 248 /);
});
test("gamesBrowseHref targets the Browse pane with a nonce", () => {
  assert.deepEqual(gamesBrowseHref(42), { pathname: "/my-arena", params: { pane: "browse", t: "42" } });
});
