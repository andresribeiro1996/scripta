import assert from "node:assert/strict";
import { test } from "node:test";
import type { DigestItem } from "../dashboard.js";
import { activityRowModel, activitySentence, isPersonalItem, type PersonalItem } from "./activityModel.js";

const actor = { userId: "u1", username: "alice", avatarUrl: null };
const createdAt = "2026-10-14T10:00:00.000Z";
const quizPlay: PersonalItem = { kind: "participation", id: "quiz:q", game: { kind: "quiz", id: "q", name: "Guess the classic", covers: [] }, actors: [actor], count: 1, createdAt };

test("a follow offers Follow back until it is mutual, then says Following", () => {
  const follow: PersonalItem = { kind: "follow", id: "u1", actor, viewerFollows: false, createdAt };
  assert.equal(activitySentence(activityRowModel(follow)), "alice followed you");
  assert.deepEqual(activityRowModel(follow).action, { kind: "followBack" });
  assert.deepEqual(activityRowModel({ ...follow, viewerFollows: true }).action, { kind: "following" });
});

test("a play of your game names who played, what they did and which game, and opens its results", () => {
  assert.equal(activitySentence(activityRowModel(quizPlay)), "alice played your quiz Guess the classic");
  assert.deepEqual(activityRowModel(quizPlay).action, { kind: "open", label: "View results" });
  const ranked: PersonalItem = { ...quizPlay, id: "tierlist:t", game: { kind: "tierlist", id: "t", name: "Fantasy", covers: [] } };
  assert.equal(activitySentence(activityRowModel(ranked)), "alice ranked your tier list Fantasy");
  assert.deepEqual(activityRowModel(ranked).action, { kind: "open", label: "View rankings" });
  const voted: PersonalItem = { ...quizPlay, id: "tournament:b", game: { kind: "tournament", id: "b", name: "Best of", covers: [] } };
  assert.deepEqual(activityRowModel(voted).action, { kind: "open", label: "View tournament" });
});

test("a play by readers who can't be named still reads as a sentence", () => {
  assert.equal(activitySentence(activityRowModel({ ...quizPlay, actors: [], count: 2 })), "2 people played your quiz Guess the classic");
});

test("a finished tournament names the tournament and opens its bracket", () => {
  const done: PersonalItem = { kind: "completion", id: "completed:t", actor, tournament: { kind: "tournament", id: "t", name: "Best of 2026", bracketSize: 8, status: "completed", bookCount: 8, covers: [] }, winner: { title: "Dune", author: "Frank Herbert", coverUrl: null }, createdAt };
  assert.equal(activitySentence(activityRowModel(done)), "A tournament you joined has finished: Best of 2026");
  assert.deepEqual(activityRowModel(done).action, { kind: "open", label: "View final bracket" });
});

test("only follows, plays of your games and finished tournaments belong in Activity", () => {
  const reading: DigestItem = { kind: "reading", id: "r", actor, book: { title: "Dune", author: "Frank Herbert", coverUrl: null }, finished: true, createdAt };
  assert.equal(isPersonalItem(quizPlay), true);
  assert.equal(isPersonalItem(reading), false);
});
