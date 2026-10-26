import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type InjectOptions } from "fastify";

const scratch = mkdtempSync(join(tmpdir(), "daily-chapter-"));
for (const key of ["AUTH_DB_PATH", "LIBRARY_DB_PATH", "GALLERY_DB_PATH", "COVERS_DB_PATH", "TIERLISTS_DB_PATH", "QUIZZES_DB_PATH"]) process.env[key] = join(scratch, key + ".sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);
const { applyQuizzesMigrations } = await import("./adapters/sqlite/connection.js");
const { createSqliteQuizzesRepository } = await import("./adapters/sqlite/sqliteQuizzesRepository.js");
const { createSqliteDailyChapterRepository } = await import("./adapters/sqlite/sqliteDailyChapterRepository.js");
const { createDailyChapterService, dailyGuestKey } = await import("./dailyChapterService.js");
const { buildDailyChapterRoutes } = await import("./dailyChapterRoutes.js");

function setup() {
  const db = new DatabaseSync(":memory:");
  applyQuizzesMigrations(db);
  const repo = createSqliteDailyChapterRepository(db);
  const plays = createSqliteQuizzesRepository(db);
  let now = new Date("2030-01-01T12:00:00.000Z");
  const service = createDailyChapterService(repo, plays, () => now);
  return { db, repo, plays, service, on: (date: string) => { now = new Date(date); } };
}

function seed(service: ReturnType<typeof setup>["service"], id = "edition-1", date = "2030-01-01", approve = true) {
  const questionIds = Array.from({ length: 5 }, (_, index) => {
    const bookId = id + "-book-" + index;
    service.saveBook({ id: bookId, title: bookId, author: "Fixture author", language: "en", themeIds: ["retold-myths"] });
    const questionId = id + "-q-" + index;
    service.saveQuestion({ id: questionId, bookId, type: "quote_title", prompt: "A synthetic fixture passage " + questionId, options: [bookId, "Other one", "Other two", "Other three"], answerIndex: 0, explanation: "A synthetic explanation", sourceUrl: "https://example.org/" + bookId, sourceEdition: "Synthetic fixture edition", rights: { basis: "public-domain", evidence: "Synthetic fixture evidence only" }, approved: approve }, "editor");
    return questionId;
  });
  service.saveEdition({ id, date, title: id, intro: "A synthetic fixture", themeId: "retold-myths", questionIds });
  return questionIds.map((questionId) => ({ questionId, choiceIndex: 0 }));
}

async function call(service: ReturnType<typeof setup>["service"], options: InjectOptions, token?: string) {
  const app = Fastify();
  app.decorate("authenticateAccessToken", (value: string) => ["editor", "reader", "other"].includes(value) ? { id: value, email: value + "@example.org", username: value, avatarId: null } : null);
  await app.register(buildDailyChapterRoutes(service, (id) => id === "editor"));
  const response = await app.inject({ ...options, headers: { ...options.headers, ...(token ? { authorization: "Bearer " + token } : {}) } });
  await app.close();
  return { status: response.statusCode, body: response.body ? response.json() : null, headers: response.headers };
}

test("only the editor can read or mutate the bank; anonymous and invalid tokens fail closed", async () => {
  const { service } = setup();
  assert.equal((await call(service, { method: "GET", url: "/daily-chapter/admin" })).status, 401);
  assert.equal((await call(service, { method: "GET", url: "/daily-chapter/admin" }, "reader")).status, 403);
  assert.equal((await call(service, { method: "GET", url: "/daily-chapter/admin" }, "editor")).status, 200);
  assert.equal((await call(service, { method: "POST", url: "/daily-chapter/history", payload: { guestId: randomUUID() } }, "invalid")).status, 401);
});

test("draft and future editions stay private and a live board strips all answer and source metadata", async () => {
  const { service, on } = setup();
  seed(service, "future", "2030-01-02");
  assert.equal(service.today().board, null);
  service.publish("future");
  assert.equal(service.today().board, null);
  on("2030-01-02T00:00:00Z");
  const response = await call(service, { method: "GET", url: "/daily-chapter/today" });
  assert.equal(response.status, 200);
  assert.equal(response.body.board.questions.length, 5);
  assert.equal(response.body.board.closesAt, "2030-01-03T00:00:00.000Z");
  assert.equal(response.headers["cache-control"], "no-store");
  for (const q of response.body.board.questions) assert.deepEqual(Object.keys(q).sort(), ["id", "options", "prompt", "type"]);
});

test("server grading is final, idempotent and recovered for the same guest", async () => {
  const { service, repo } = setup();
  const answers = seed(service);
  service.publish("edition-1");
  const guestId = randomUUID();
  const payload = { guestId, answers, score: 99 };
  const scored = await call(service, { method: "POST", url: "/daily-chapter/edition-1/play", payload });
  assert.equal(scored.status, 200);
  assert.equal(scored.body.score, 5);
  assert.equal(scored.body.answers.length, 5);
  assert.equal(scored.body.answers[0].book.id, "edition-1-book-0");
  const again = await call(service, { method: "POST", url: "/daily-chapter/edition-1/play", payload: { guestId, answers: answers.map((answer) => ({ ...answer, choiceIndex: 1 })) } });
  assert.equal(again.body.score, 5);
  assert.equal(repo.plays(dailyGuestKey(guestId)).length, 1);
  const recovered = service.history(dailyGuestKey(guestId));
  assert.equal(recovered.results[0]?.score, 5);
  assert.equal(recovered.themes[0]?.perfect, 1);
  const zero = service.play("edition-1", dailyGuestKey(randomUUID()), answers.map((answer) => ({ ...answer, choiceIndex: 1 })));
  assert.equal(zero.score, 0);
});

test("incomplete, repeated and foreign questions do not create a play", async () => {
  const { service, repo } = setup();
  const answers = seed(service); service.publish("edition-1");
  const guestId = randomUUID();
  for (const invalid of [answers.slice(1), Array(5).fill(answers[0]), answers.map((answer, index) => index === 0 ? { ...answer, questionId: "foreign" } : answer), answers.map((answer) => ({ ...answer, choiceIndex: 4 }))]) {
    const response = await call(service, { method: "POST", url: "/daily-chapter/edition-1/play", payload: { guestId, answers: invalid } });
    assert.equal(response.status, 400);
  }
  assert.equal(repo.plays(dailyGuestKey(guestId)).length, 0);
});

test("published snapshots survive bank edits and cannot be overwritten or rescheduled", () => {
  const { service } = setup(); seed(service); service.publish("edition-1");
  const before = service.today().board!;
  const q = service.editorial().questions[0]!;
  service.saveQuestion({ ...q, prompt: "Changed draft passage", approved: false }, "editor");
  assert.deepEqual(service.today().board, before);
  const edition = service.editorial().editions[0]!;
  assert.throws(() => service.saveEdition({ ...edition, date: "2030-01-02" }), /immutable/);
  assert.throws(() => service.publish(edition.id), /already scheduled/);
});

test("approval needs evidence, publication needs five approved distinct books, and used questions cannot recur", async () => {
  const { service } = setup(); seed(service, "draft", "2030-01-01", false);
  assert.throws(() => service.publish("draft"), /approve all five/);
  for (const q of service.editorial().questions) {
    const invalid = await call(service, { method: "PUT", url: "/daily-chapter/admin/questions", payload: { ...q, approved: true, sourceEdition: "", rights: { basis: "original", evidence: "" } } }, "editor");
    assert.equal(invalid.status, 400);
    service.saveQuestion({ ...q, approved: true }, "editor");
  }
  service.publish("draft");
  assert.equal(service.editorial().coverage.availableQuotes, 0);
  const first = service.editorial().editions[0]!;
  service.saveEdition({ ...first, id: "repeat", date: "2030-01-02" });
  assert.throws(() => service.publish("repeat"), /already been scheduled/);
});

test("an edition cannot use several passages from the same book", () => {
  const { service } = setup(); seed(service);
  const questions = service.editorial().questions;
  const first = questions[0]!;
  for (const q of questions.slice(1)) service.saveQuestion({ ...q, bookId: first.bookId, options: [first.options[0]!, ...q.options.slice(1)], approved: true }, "editor");
  assert.throws(() => service.publish("edition-1"), /five different books/);
});

test("duplicate book targets and duplicate passages do not inflate inventory", () => {
  const { service } = setup(); seed(service);
  const book = service.editorial().books[0]!;
  assert.throws(() => service.saveBook({ ...book, id: "duplicate", title: book.title.toUpperCase() }), /already on the target list/);
  const q = service.editorial().questions[0]!;
  assert.throws(() => service.saveQuestion({ ...q, id: "duplicate", approved: true }, "editor"), /already in the bank/);
  assert.throws(() => service.saveBook({ ...book, language: "pt" }), /Unapprove/);
});

test("guest claims preserve the account's existing result and never duplicate scores", () => {
  const { service, repo } = setup();
  const answers = seed(service); service.publish("edition-1");
  const guestId = randomUUID();
  service.play("edition-1", dailyGuestKey(guestId), answers);
  assert.equal(service.history("reader", guestId).results.length, 1);
  assert.equal(service.history("reader", guestId).results.length, 1);
  assert.equal(repo.plays(dailyGuestKey(guestId)).length, 0);
  assert.equal(service.history("other", guestId).results.length, 0);
  const anotherGuest = randomUUID();
  service.play("edition-1", dailyGuestKey(anotherGuest), answers.map((answer) => ({ ...answer, choiceIndex: 1 })));
  assert.equal(service.history("reader", anotherGuest).results[0]?.score, 5);
  assert.equal(repo.plays("reader").length, 1);
});

test("daily submissions respect UTC boundaries while historical results remain recoverable", () => {
  const { service, on } = setup(); const answers = seed(service); service.publish("edition-1");
  const guest = dailyGuestKey(randomUUID());
  service.play("edition-1", guest, answers);
  on("2030-01-02T00:00:00.000Z");
  assert.equal(service.today().board, null);
  assert.throws(() => service.play("edition-1", "new-player", answers), /closed/);
  assert.equal(service.play("edition-1", guest, answers).score, 5);
  assert.equal(service.history(guest).results.length, 1);
});

test("theme stats use appearances since participation and record missed editions independently of accuracy", () => {
  const { service, on } = setup();
  const first = seed(service, "one"); service.publish("one");
  service.play("one", "reader", first);
  seed(service, "two", "2030-01-03"); service.publish("two");
  const last = seed(service, "three", "2030-01-05"); service.publish("three");
  on("2030-01-05T23:59:59Z"); service.play("three", "reader", last);
  const stats = service.history("reader").themes[0]!;
  assert.deepEqual({ completed: stats.completed, eligible: stats.eligible, correct: stats.correct, answered: stats.answered, perfectStreak: stats.perfectStreak }, { completed: 2, eligible: 3, correct: 10, answered: 10, perfectStreak: 1 });
});

test("the real launch pack imports as 70 unapproved questions, 70 target books and 14 private drafts", () => {
  const { service } = setup();
  const pack = JSON.parse(readFileSync(new URL("../../../../docs/superpowers/specs/2026-10-25-daily-chapter-editorial.json", import.meta.url), "utf8"));
  service.importPack({ pack, startDate: "2030-01-01" });
  service.importPack({ pack, startDate: "2030-01-01" });
  const editorial = service.editorial();
  assert.equal(editorial.books.length, 70);
  assert.equal(editorial.questions.length, 70);
  assert.equal(editorial.editions.length, 14);
  assert.equal(editorial.coverage.approvedQuotes, 0);
  assert.equal(editorial.coverage.readyQuestions, 0);
  const quotation = editorial.questions.find((question) => question.type === "quote_title")!;
  assert.equal(quotation.rights.basis, "permission");
  assert.match(quotation.rights.evidence, /assumed cleared/);
  assert.equal(quotation.approvedAt, null);
  assert.equal(service.today().board, null);
  assert.throws(() => service.publish("chapter-01"), /approve/);
  pack.editions[0].questions[0].book.sourceUrl = "javascript:alert(1)";
  assert.throws(() => service.importPack({ pack, startDate: "2030-01-01" }));
  assert.equal(service.editorial().questions.length, 70);
});

test("editorial imports preserve the quotation language for book coverage", () => {
  const { service } = setup();
  const pack = JSON.parse(readFileSync(new URL("../../../../docs/superpowers/specs/2026-10-25-daily-chapter-editorial.json", import.meta.url), "utf8"));
  pack.language = "pt";
  service.importPack({ pack, startDate: "2030-01-01" });
  assert.equal(service.editorial().books.every((book) => book.language === "pt"), true);
});

test("account erasure unlinks daily results and removes personal history", () => {
  const { service, plays } = setup(); const answers = seed(service); service.publish("edition-1");
  service.play("edition-1", "reader", answers);
  plays.deleteUserData("reader");
  assert.equal(service.history("reader").results.length, 0);
  assert.equal(service.history("reader").startedOn, null);
});

const candidateBank = () => JSON.parse(readFileSync(new URL("../../../../docs/daily-chapter/candidate-bank.json", import.meta.url), "utf8"));

test("the source bank imports 500 private candidates without dates, preserves reviews and merges launch coverage", async () => {
  const { service } = setup();
  const bank = candidateBank();
  const route = { method: "POST", url: "/daily-chapter/admin/import-bank", payload: bank } as const;
  assert.equal((await call(service, route)).status, 401);
  assert.equal((await call(service, route, "reader")).status, 403);
  assert.equal((await call(service, route, "editor")).status, 204);
  const editorial = service.editorial();
  assert.equal(editorial.books.length, 164);
  assert.equal(editorial.questions.length, 500);
  assert.equal(new Set(editorial.questions.map((question) => question.bookId)).size, 100);
  assert.equal(editorial.editions.length, 0);
  assert.equal(editorial.coverage.approvedQuotes, 0);
  assert.equal(service.today().board, null);
  const question = bank.questions[0];
  service.saveQuestion({ ...question, approved: true, rights: { basis: "permission", evidence: "Synthetic review evidence used only for this test" } }, "editor");
  service.importBank(bank);
  assert.equal(service.editorial().questions.find((item) => item.id === question.id)?.approvedBy, "editor");
  const pack = JSON.parse(readFileSync(new URL("../../../../docs/superpowers/specs/2026-10-25-daily-chapter-editorial.json", import.meta.url), "utf8"));
  service.importPack({ pack, startDate: "2030-01-01" });
  assert.equal(service.editorial().books.length, 164);
  assert.equal(service.editorial().questions.length, 570);
  const second = setup().service;
  second.importPack({ pack, startDate: "2030-01-01" });
  second.importBank(bank);
  assert.deepEqual(second.editorial().books, service.editorial().books);
});

test("bank validation rejects invalid answers, forged approval and duplicate identities atomically", () => {
  for (const mutate of [
    (bank: ReturnType<typeof candidateBank>) => { bank.questions[499].options[bank.questions[499].answerIndex] = "Wrong target"; },
    (bank: ReturnType<typeof candidateBank>) => { bank.questions[499].approved = true; },
    (bank: ReturnType<typeof candidateBank>) => { bank.books.push({ ...bank.books[0], id: "duplicate-book" }); },
    (bank: ReturnType<typeof candidateBank>) => { bank.questions.push({ ...bank.questions[0], id: "duplicate-passage" }); },
    (bank: ReturnType<typeof candidateBank>) => { bank.questions[499].sourceUrl = "http://example.org"; },
  ]) {
    const { service } = setup(); const bank = candidateBank(); mutate(bank);
    assert.throws(() => service.importBank(bank));
    assert.equal(service.editorial().books.length, 0);
    assert.equal(service.editorial().questions.length, 0);
  }
  const { service } = setup(); const bank = candidateBank();
  service.importBank(bank);
  bank.questions[0].bookId = bank.questions[499].bookId;
  bank.questions[0].options = bank.questions[499].options;
  bank.questions[0].answerIndex = bank.questions[499].answerIndex;
  assert.throws(() => service.importBank(bank), /already in the bank/);
  assert.equal(service.editorial().questions.length, 500);
});

const reviewedLaunchPack = () => JSON.parse(readFileSync(new URL("../../../../docs/daily-chapter/launch-fortnight.json", import.meta.url), "utf8"));

test("the reviewed fortnight imports approved content under the editor and plays through 14 UTC releases", async () => {
  const { service, on } = setup(); const pack = reviewedLaunchPack();
  const request = { method: "POST", url: "/daily-chapter/admin/import", payload: { pack, startDate: "2030-01-02" } } as const;
  assert.equal((await call(service, request)).status, 401);
  assert.equal((await call(service, request, "reader")).status, 403);
  assert.equal((await call(service, request, "editor")).status, 204);
  const editorial = service.editorial();
  assert.equal(editorial.questions.length, 70);
  assert.equal(editorial.questions.every((q) => q.approvedBy === "editor"), true);
  assert.equal(editorial.coverage.readyQuestions, 70);
  assert.equal(editorial.coverage.approvedQuotes, 21);
  assert.equal(editorial.editions.every((edition) => edition.publishedAt === null), true);
  assert.equal(service.today().board, null);
  for (const edition of pack.editions) service.publish(edition.id);
  assert.equal(service.today().board, null);
  for (const edition of pack.editions) {
    const date = new Date("2030-01-01T00:00:00.000Z"); date.setUTCDate(date.getUTCDate() + edition.day);
    on(date.toISOString());
    const board = service.today().board!;
    assert.equal(board.id, edition.id);
    assert.equal(board.theme.id, edition.themeId);
    assert.deepEqual(board.questions.map((q) => q.prompt), edition.questions.map((q: { prompt: string }) => q.prompt));
    const answers = edition.questions.map((q: { id: string; answerIndex: number }, i: number) => ({ questionId: q.id, choiceIndex: edition.day === 8 && i === 0 ? (q.answerIndex + 1) % 4 : q.answerIndex }));
    const result = service.play(edition.id, "launch-reader", answers);
    assert.equal(result.score, edition.day === 8 ? 4 : 5);
    assert.deepEqual(result.answers.map((answer) => answer.book.title), edition.questions.map((q: { book: { title: string } }) => q.book.title));
  }
  assert.equal(service.history("launch-reader").results.length, 14);
  assert.equal(service.history("launch-reader").themes.length, 14);
  assert.equal(service.history("launch-reader").streak, 14);
  on("2030-01-16T00:00:00.000Z"); assert.equal(service.today().board, null);
});

test("reviewed imports validate every question before writing and require an authenticated editor identity", () => {
  for (const mutate of [
    (pack: ReturnType<typeof reviewedLaunchPack>) => { pack.editions[10].questions[0].sourceEdition = ""; },
    (pack: ReturnType<typeof reviewedLaunchPack>) => { pack.editions[13].questions[4].options[pack.editions[13].questions[4].answerIndex] = "Wrong answer"; },
    (pack: ReturnType<typeof reviewedLaunchPack>) => { pack.editions[0].questions[0].rights.basis = "original"; },
    (pack: ReturnType<typeof reviewedLaunchPack>) => { const q = pack.editions[0].questions[1]; q.book = pack.editions[0].questions[0].book; q.options[q.answerIndex] = q.book.title; },
  ]) {
    const { service } = setup(); const pack = reviewedLaunchPack(); mutate(pack);
    assert.throws(() => service.importPack({ pack, startDate: "2030-01-01" }, "editor"));
    assert.equal(service.editorial().questions.length, 0);
    assert.equal(service.editorial().books.length, 0);
    assert.equal(service.editorial().editions.length, 0);
  }
  const { service } = setup();
  assert.throws(() => service.importPack({ pack: reviewedLaunchPack(), startDate: "2030-01-01" }), /authenticated editor/);
});

test("reviewed imports promote matching raw candidates, retain later reviews and reject conflicting passage ids", () => {
  const { service } = setup(); service.importBank(candidateBank());
  const pack = reviewedLaunchPack();
  service.importPack({ pack, startDate: "2030-01-01" }, "editor");
  assert.equal(service.editorial().questions.length, 554);
  assert.equal(service.editorial().coverage.readyQuestions, 70);
  const input = pack.editions[0].questions[0];
  const stored = service.editorial().questions.find((q) => q.id === input.id)!;
  assert.deepEqual(stored.options, input.options);
  service.saveQuestion({ ...stored, explanation: "A later manual editorial correction.", approved: true }, "later-editor");
  service.importPack({ pack, startDate: "2030-01-01" }, "editor");
  service.importBank(candidateBank());
  const preserved = service.editorial().questions.find((q) => q.id === input.id)!;
  assert.equal(preserved.approvedBy, "later-editor");
  assert.equal(preserved.explanation, "A later manual editorial correction.");
  for (const edition of pack.editions) service.publish(edition.id);
  assert.equal(service.editorial().coverage.readyQuestions, 0);
  for (const mutation of ["different-content", "duplicate-passage"]) {
    const next = setup().service; next.importBank(candidateBank()); const changed = reviewedLaunchPack();
    const importedIds = new Set(changed.editions.flatMap((edition: { questions: Array<{ id: string }> }) => edition.questions.map((q) => q.id)));
    changed.editions[0].questions[0].id = mutation === "different-content" ? candidateBank().questions.find((q: { id: string }) => !importedIds.has(q.id)).id : "duplicate-passage";
    assert.throws(() => next.importPack({ pack: changed, startDate: "2030-01-01" }, "editor"), /Nothing was imported/);
    assert.equal(next.editorial().questions.length, 500);
  }
});

test("reviewed imports reject repeated passages within the incoming pack atomically", () => {
  const { service } = setup(); const pack = reviewedLaunchPack();
  const original = pack.editions[0].questions[0];
  pack.editions[1].questions[0] = { ...original, id: "repeated-passage", prompt: "  " + original.prompt.replace(/ /g, "\n") + "  " };
  assert.throws(() => service.importPack({ pack, startDate: "2030-01-01" }, "editor"), /Reuse the existing passage id/);
  assert.equal(service.editorial().books.length, 0);
  assert.equal(service.editorial().questions.length, 0);
  assert.equal(service.editorial().editions.length, 0);
});
