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

test("currentRead picks the reading book read most recently", () => {
  const books = [
    { Title: "Old", ReadStatus: 1, DateLastRead: "2026-01-02" },
    { Title: "Done", ReadStatus: 2, DateLastRead: "2026-11-10" },
    { Title: "New", ReadStatus: 1, DateLastRead: "2026-11-01T09:00:00Z" }
  ];
  assert.equal(currentRead(books)?.Title, "New");
});
test("currentRead sorts undated or unparseable dates last and keeps library order on ties", () => {
  assert.equal(currentRead([{ Title: "A", ReadStatus: 1 }, { Title: "B", ReadStatus: 1, DateLastRead: "garbage" }])?.Title, "A");
  assert.equal(currentRead([{ Title: "A", ReadStatus: 1 }, { Title: "B", ReadStatus: 1, DateLastRead: "2020-01-01" }])?.Title, "B");
});
test("currentRead is null with no library or nothing reading", () => {
  assert.equal(currentRead(undefined), null);
  assert.equal(currentRead([{ Title: "A", ReadStatus: 2 }]), null);
});
test("newGameRows keeps the first two items", () => {
  assert.deepEqual(newGameRows([quiz, tournament, tierlist], "en").map((row) => row.name), ["Guess the classic", "The fantasy final"]);
  assert.equal(newGameRows([quiz], "en").length, 1);
  assert.deepEqual(newGameRows([], "en"), []);
});
test("newGameRows meta names the author and the kind's headline count", () => {
  const [q, t, l] = [quiz, tournament, tierlist].map((item) => newGameRows([item], "en")[0]!);
  assert.equal(q.meta, "by @joao · 248 plays");
  assert.equal(t.meta, "by @marta · 16 books");
  assert.equal(l.meta, "by @ana · 7 ballots");
  assert.equal(q.target, contentTarget(quiz.content));
  assert.equal(q.kind, contentKindLabel(quiz.content, "en"));
});
test("newGameRows meta for an unavailable author", () => {
  const gone = { ...quiz, author: { ...quiz.author, username: "Original creator unavailable", unavailable: true } };
  assert.equal(newGameRows([gone], "en")[0]!.meta, "Original creator unavailable · 248 plays");
});
test("newGameRows meta in pt-PT", () => {
  assert.match(newGameRows([quiz], "pt-PT")[0]!.meta, /^de @joao · 248 /);
});
test("gamesBrowseHref targets the Browse pane with a nonce", () => {
  assert.deepEqual(gamesBrowseHref(42), { pathname: "/my-arena", params: { pane: "browse", t: "42" } });
});
