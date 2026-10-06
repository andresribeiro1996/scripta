/// <reference types="node" />

import assert from "node:assert/strict";
import { test } from "node:test";
import type { WorkPage } from "@scripta/shared";
import { workPath, workScreenSections } from "./workScreenModel.js";

const page: WorkPage = {
  work: { id: "w", title: "Dune", author: "Frank Herbert", summary: null, coverUrl: null, editions: [] },
  mine: { bookKey: "isbn:1", readStatus: 2, rating: 5, highlightCount: 1 },
  readers: { followed: [{ username: "ana", avatarUrl: null, readStatus: 1, published: false }], others: [], counts: { readers: 1, finished: 0 } },
  games: { tierlists: [], arenas: [{ id: "a1", name: "SF", owner: { username: "bo", avatarUrl: null }, path: "/arena/a1" }], quizzes: [] }
};

test("the screen model orders sections and words each row", () => {
  const model = workScreenSections(page);
  assert.deepEqual(model.mine, { status: "Finished", detail: "All-time · 1 highlight" });
  assert.equal(model.about, null);
  assert.deepEqual(model.readerGroups.map((group) => [group.title, group.rows.map((row) => [row.username, row.status, row.linksToProfile])]), [["People you follow", [["ana", "Reading", false]]]]);
  assert.equal(model.countsLabel, "1 reader");
  assert.deepEqual(model.games, [{ key: "arena-a1", title: "SF", detail: "Tournament · bo", path: "/arena/a1" }]);
  assert.equal(model.gamesEmpty, false);
});

test("no copy and no games read as such", () => {
  const model = workScreenSections({ ...page, mine: null, games: { tierlists: [], arenas: [], quizzes: [] } });
  assert.equal(model.mine, null);
  assert.equal(model.gamesEmpty, true);
});

test("a long summary gets a preview, a short one does not", () => {
  const long = `${"Spice and sand. ".repeat(40)}The end.`;
  const preview = workScreenSections({ ...page, work: { ...page.work, summary: long } }).aboutPreview;
  assert.ok(preview && preview.endsWith("…") && !preview.includes("The end."));
  assert.equal(workScreenSections({ ...page, work: { ...page.work, summary: "Spice." } }).aboutPreview, null);
});

test("a work opened from inside the tabs stays in them; from a root-level screen it opens above it", () => {
  assert.equal(workPath("w1", ["(app)", "(arena)", "tierlist", "[id]"]), "/work/w1");
  assert.equal(workPath("w1", ["arena", "[id]"]), "/(public)/work/w1");
  assert.equal(workPath("w1", ["vote", "[code]"]), "/(public)/work/w1");
});
