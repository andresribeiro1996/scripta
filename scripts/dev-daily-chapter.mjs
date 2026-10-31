#!/usr/bin/env node
// Daily Chapter editions and plays for the dev account, so the Your chapters
// screens, the profile Daily tab and the monthly recap card have something to
// show: published editions on most days of last month and this month up to
// today (a few gap days with none), plays by the dev account with mixed scores
// and two missed days, plays by the followed fixture users, plays by the
// published fixture user the dev account does not follow, and one guest play.
//
// The service refuses past dates and plays on any day but today, so the rows
// are written straight into the quizzes database. Runs after dev-community.mjs
// (see devFixtureSetup.mjs), against the backend/data/dev/ the *_DB_PATH vars
// point at, and refuses any other database. Idempotent: a day whose edition id
// or date already exists is left alone with its plays, so a re-run on a later
// day only adds the new days.
//
// three-users.mjs freezes only the current month's recap, and last month's
// would be an empty one the app never serves. When that is the case, last
// month's recap borrows the current month's games so /recap/<last month>
// opens, with the Daily Chapter card computed from the editions written here.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEV_EMAIL, ensureBackendEnv } from "./dev-account.mjs";
import { devDataDirEnv } from "./devDataDir.mjs";
import { DEV_GUEST_ID, buildEdition, correctMarks, planDays, planPlays } from "./devDailyChapterPlan.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const dev = devDataDirEnv();

assert.notEqual(process.env.NODE_ENV, "production", "Fixtures are development-only.");
for (const key of ["AUTH_DB_PATH", "QUIZZES_DB_PATH"]) {
  assert(process.env[key] && resolve(process.env[key]) === dev[key], `${key} must point at ${dev[key]} (see scripts/devDataDir.mjs); refusing to seed any other database.`);
}

ensureBackendEnv();
process.chdir(join(repoRoot, "backend"));

const { openQuizzesDb } = await import("../backend/src/modules/quizzes/adapters/sqlite/connection.ts");

const auth = new DatabaseSync(dev.AUTH_DB_PATH, { readOnly: true });
const userIds = {};
try {
  for (const [who, email] of [["dev", DEV_EMAIL], ["alice", "fixture_alice@example.test"], ["bob", "fixture_bob@example.test"], ["charlie", "fixture_charlie@example.test"]]) {
    const row = auth.prepare("SELECT id FROM users WHERE email = ?").get(email);
    assert(row, `No ${email} in the dev auth database; run dev-account.mjs and three-users.mjs first.`);
    userIds[who] = row.id;
  }
} finally {
  auth.close();
}
userIds.guest = `daily-guest:${DEV_GUEST_ID}`;

const today = new Date().toISOString().slice(0, 10);
const dates = planDays(today);
const plays = planPlays(dates, today);
const db = openQuizzesDb();
const counts = { editions: 0, plays: 0, answers: 0 };

try {
  dates.forEach((date, index) => {
    const edition = buildEdition(date, index);
    if (db.prepare("SELECT 1 FROM daily_chapter_editions WHERE id = ? OR date = ?").get(edition.id, date)) return;
    const publishedAt = new Date(Date.parse(`${date}T00:00:00.000Z`) - 12 * 3_600_000).toISOString();
    const { snapshot, ...data } = edition;
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("INSERT INTO daily_chapter_editions(id, date, data, snapshot, published_at) VALUES (?, ?, ?, ?, ?)").run(edition.id, date, JSON.stringify(data), JSON.stringify(snapshot), publishedAt);
      counts.editions += 1;
      plays.filter((play) => play.date === date).forEach((play, order) => {
        const marks = correctMarks(play.score, Number(date.slice(8)) + order);
        const at = `${date}T${String(8 + order * 2).padStart(2, "0")}:15:00.000Z`;
        const id = randomUUID();
        db.prepare("INSERT INTO quiz_plays(id, quiz_id, voter_user_id, player_name, score, duration_ms, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, 0, ?, ?)").run(id, edition.id, userIds[play.who], play.score, at, at);
        counts.plays += 1;
        snapshot.forEach((question, position) => {
          const choice = marks[position] ? question.answerIndex : (question.answerIndex + 1) % 4;
          db.prepare("INSERT INTO quiz_play_answers(play_id, quiz_id, question_id, choice_index, correct) VALUES (?, ?, ?, ?, ?)").run(id, edition.id, question.id, choice, marks[position] ? 1 : 0);
          counts.answers += 1;
        });
      });
      db.exec("COMMIT");
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw error;
    }
  });
} finally {
  db.close();
}

const community = new DatabaseSync(dev.COMMUNITY_DB_PATH);
let recaps = 0;
try {
  recaps = Number(community.prepare("UPDATE top_shelf_recaps SET data = (SELECT data FROM top_shelf_recaps WHERE month = ? AND has_cards = 1), has_cards = 1 WHERE month = ? AND has_cards = 0 AND EXISTS (SELECT 1 FROM top_shelf_recaps WHERE month = ? AND has_cards = 1)").run(today.slice(0, 7), dates[0].slice(0, 7), today.slice(0, 7)).changes);
} finally {
  community.close();
}

console.log(`[dev-daily-chapter] ${counts.editions} editions, ${counts.plays} plays, ${counts.answers} answers and ${recaps} recap rows written (${dates.length} days planned, today ${today}).`);
