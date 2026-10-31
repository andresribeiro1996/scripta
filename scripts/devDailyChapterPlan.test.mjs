import assert from "node:assert/strict";
import { test } from "node:test";
import { DEV_THEMES, buildEdition, correctMarks, planDays, planPlays } from "./devDailyChapterPlan.mjs";

test("the plan covers last month and this month up to today, with gap days and today kept", () => {
  const dates = planDays("2026-10-30");
  assert.equal(dates[0], "2026-09-01");
  assert.equal(dates.at(-1), "2026-10-30");
  assert(!dates.includes("2026-09-06") && !dates.includes("2026-10-13"));
  assert(dates.includes("2026-09-07"));
  assert.equal(new Set(dates).size, dates.length);
});

test("a gap day that is today still gets an edition, and January looks back to December", () => {
  assert(planDays("2026-10-21").includes("2026-10-21"));
  assert.equal(planDays("2027-01-02")[0], "2026-12-01");
});

test("the dev account misses some past days but not the latest ones, and never plays today", () => {
  const today = "2026-10-30";
  const dates = planDays(today);
  const plays = planPlays(dates, today);
  const devDates = plays.filter((play) => play.who === "dev").map((play) => play.date);
  const past = dates.filter((date) => date < today);
  assert(past.length - devDates.length >= 2);
  assert(past.slice(-3).every((date) => devDates.includes(date)));
  assert(!devDates.includes(today));
  assert(plays.filter((play) => play.who === "dev").some((play) => play.score === 5));
  assert(plays.some((play) => play.date === today && play.who === "alice"));
});

test("every kind of player appears and no player plays an edition twice", () => {
  const today = "2026-10-30";
  const plays = planPlays(planDays(today), today);
  for (const who of ["dev", "alice", "bob", "charlie", "guest"]) assert(plays.some((play) => play.who === who), who);
  assert.equal(new Set(plays.map((play) => `${play.date}:${play.who}`)).size, plays.length);
  assert(plays.every((play) => play.score >= 1 && play.score <= 5));
});

test("correctMarks marks exactly the missing questions wrong", () => {
  for (let score = 0; score <= 5; score += 1) for (let seed = 0; seed < 10; seed += 1) {
    assert.equal(correctMarks(score, seed).filter(Boolean).length, score);
  }
});

test("an edition has five distinct books, four options each with the answer in place, and a known theme", () => {
  for (let index = 0; index < 60; index += 1) {
    const edition = buildEdition("2026-10-01", index);
    assert(DEV_THEMES.some((theme) => theme.id === edition.themeId));
    assert.equal(edition.snapshot.length, 5);
    assert.equal(new Set(edition.snapshot.map((question) => question.bookId)).size, 5);
    assert.deepEqual(edition.questionIds, edition.snapshot.map((question) => question.id));
    for (const question of edition.snapshot) {
      assert.equal(new Set(question.options).size, 4);
      assert.equal(question.options[question.answerIndex], question.book.title);
    }
  }
  assert(new Set(Array.from({ length: 6 }, (_, index) => buildEdition("2026-10-01", index).themeId)).size >= 3);
});
