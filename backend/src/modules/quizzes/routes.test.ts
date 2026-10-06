// Wire-shape tests for the public play surface — what a curl really gets.
// Same env-before-import discipline as tierlists' routes.test.ts.

import assert from "node:assert/strict";
import Fastify, { type InjectOptions } from "fastify";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const scratchDir = mkdtempSync(join(tmpdir(), "quizzes-routes-test-"));
process.env.AUTH_DB_PATH = join(scratchDir, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratchDir, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratchDir, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratchDir, "covers.sqlite");
process.env.TIERLISTS_DB_PATH = join(scratchDir, "tierlists.sqlite");
process.env.QUIZZES_DB_PATH = join(scratchDir, "quizzes.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyQuizzesMigrations } = await import("./adapters/sqlite/connection.js");
const { createSqliteQuizzesRepository } = await import("./adapters/sqlite/sqliteQuizzesRepository.js");
const { createQuizzesService } = await import("./service.js");
const { buildPublicQuizRoutes, buildQuizRoutes } = await import("./routes.js");
const { openLibraryDb } = await import("../library/adapters/sqlite/connection.js");
const { applyBooksMigrations, openBooksDb } = await import("../books/adapters/sqlite/connection.js");
const { resolveWorks } = await import("../books/index.js");

type Service = ReturnType<typeof createQuizzesService>;

const named = (title: string) => resolveWorks([{ isbn: null, title, author: "Someone" }])[0]!;
const book = (workId: string, title = `Title ${workId}`, author = "A") => ({ workId, title, author, coverUrl: `https://covers.test/${workId}.jpg`, quote: `Quote ${workId}`, blurb: null });
const worksBook = (title: string, workId?: string, coverUrl: string | null = `https://covers.test/${encodeURIComponent(title)}.jpg`) => ({ ...(workId ? { workId } : {}), title, author: "Someone", coverUrl, quote: null, blurb: null });

/** A published 3-question quiz with its code and the owner-held answer key. */
function publishedQuiz() {
  const db = new DatabaseSync(":memory:");
  applyQuizzesMigrations(db);
  const service = createQuizzesService(createSqliteQuizzesRepository(db));
  const created = service.createQuiz("u1", "Trivia", {
    sourceLabel: "Shelf",
    questionCount: 3,
    allowedTypes: ["cover_title", "title_cover", "quote_title", "blurb_title"],
    books: Array.from({ length: 6 }, (_, i) => book(`b${i}`)),
    questions: null
  });
  const outcome = service.publishQuiz("u1", created.id, []);
  assert.ok(outcome.ok);
  const code = outcome.ok ? outcome.quiz.voteCode! : "";
  const answerKey = (service.getQuiz("u1", created.id)!.data as { questions: Array<{ id: string; answerIndex: number }> }).questions;
  return { service, code, answerKey };
}

async function call(service: Service, options: InjectOptions, signedInAs?: string) {
  const app = Fastify();
  if (signedInAs) app.decorate("authenticateAccessToken", (token: string) => token === signedInAs ? { id: signedInAs, email: `${signedInAs}@example.test`, username: signedInAs, avatarId: null } : null);
  await app.register(buildPublicQuizRoutes(service));
  const res = await app.inject(signedInAs ? { ...options, headers: { ...options.headers, authorization: `Bearer ${signedInAs}` } } : options);
  await app.close();
  return { status: res.statusCode, body: res.json() as Record<string, never> };
}

test("the public board never carries the answer key", async () => {
  const { service, code } = publishedQuiz();
  const { status, body } = await call(service, { method: "GET", url: `/quizzes/voting/${code}` });
  assert.equal(status, 200);
  const board = body.board as unknown as { questions: Array<{ options: string[] } & Record<string, unknown>>; playOpen: boolean; questionCount: number };
  assert.equal(board.playOpen, true);
  assert.equal(board.questionCount, 3);
  for (const q of board.questions) {
    assert.equal("answerIndex" in q, false);
    assert.equal(q.options.length, 4);
    assert.ok(q.prompt);
  }
});

test("a closed quiz is a 403 on both the board and play", async () => {
  const { service, code } = publishedQuiz();
  const owned = service.listQuizzes("u1")[0]!;
  service.setPlayState("u1", owned.id, false);
  const board = await call(service, { method: "GET", url: `/quizzes/voting/${code}` });
  assert.equal(board.status, 403);
  // Well-shaped body: the 403 must come from play_open, not from zod.
  const play = await call(service, { method: "POST", url: `/quizzes/voting/${code}/play`, body: { answers: [{ questionId: "q0", choiceIndex: 0 }], durationMs: 1 } });
  assert.equal(play.status, 403);
});

test("a full submission is graded; wrong-shaped answers are a 400", async () => {
  const { service, code, answerKey } = publishedQuiz();
  const answers = answerKey.map((q) => ({ questionId: q.id, choiceIndex: q.answerIndex }));
  const good = await call(service, { method: "POST", url: `/quizzes/voting/${code}/play`, body: { answers, durationMs: 12345, playerName: "Alice" } });
  assert.equal(good.status, 200);
  assert.equal((good.body as unknown as { score: number }).score, answerKey.length);
  const bad = await call(service, { method: "POST", url: `/quizzes/voting/${code}/play`, body: { answers: [{ questionId: "q0", choiceIndex: 0 }], durationMs: 1 } });
  assert.equal(bad.status, 400);
});

test("a second play by the same account is a 409", async () => {
  const { service, code, answerKey } = publishedQuiz();
  const answers = answerKey.map((q) => ({ questionId: q.id, choiceIndex: q.answerIndex }));
  await call(service, { method: "POST", url: `/quizzes/voting/${code}/play`, body: { answers, durationMs: 1 } }, "u9");
  const again = await call(service, { method: "POST", url: `/quizzes/voting/${code}/play`, body: { answers, durationMs: 1 } }, "u9");
  assert.equal(again.status, 409);
});

test("the public leaderboard lists plays best-first and hides ids", async () => {
  const { service, code, answerKey } = publishedQuiz();
  const answers = answerKey.map((q) => ({ questionId: q.id, choiceIndex: q.answerIndex }));
  await call(service, { method: "POST", url: `/quizzes/voting/${code}/play`, body: { answers, durationMs: 9000, playerName: "Slow" } });
  await call(service, { method: "POST", url: `/quizzes/voting/${code}/play`, body: { answers, durationMs: 1000, playerName: "Fast" } });
  const { status, body } = await call(service, { method: "GET", url: `/quizzes/voting/${code}/results` });
  assert.equal(status, 200);
  const plays = (body as unknown as { plays: Array<{ playerName: string; score: number; durationMs: number }> }).plays;
  assert.deepEqual(plays.map((p) => p.playerName), ["Fast", "Slow"]);
  for (const play of plays) {
    assert.equal("playId" in play, false);
    assert.equal("voter_user_id" in play, false);
  }
});

test("an unknown code is a 404 everywhere", async () => {
  const { service } = publishedQuiz();
  assert.equal((await call(service, { method: "GET", url: "/quizzes/voting/nosuchcode" })).status, 404);
  assert.equal((await call(service, { method: "GET", url: "/quizzes/voting/nosuchcode/results" })).status, 404);
  // Well-shaped body: the 404 must come from the service, not from zod.
  const wellShaped = { answers: [{ questionId: "q0", choiceIndex: 0 }], durationMs: 1 };
  assert.equal((await call(service, { method: "POST", url: "/quizzes/voting/nosuchcode/play", body: wellShaped })).status, 404);
});

async function quizApp(wrap: (service: ReturnType<typeof createQuizzesService>) => ReturnType<typeof createQuizzesService> = (service) => service) {
  const db = new DatabaseSync(":memory:");
  applyQuizzesMigrations(db);
  const service = wrap(createQuizzesService(createSqliteQuizzesRepository(db)));
  const app = Fastify();
  app.decorate("authenticateAccessToken", (token: string) => ({ id: token, email: `${token}@example.test`, username: token, avatarId: null }));
  await app.register(buildQuizRoutes(service));
  await app.register(buildPublicQuizRoutes(service));
  const send = (method: "POST" | "PUT", url: string, user: string, payload: unknown) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${user}` }, payload: payload as Record<string, unknown> });
  const get = (url: string, user: string) => app.inject({ method: "GET", url, headers: { authorization: `Bearer ${user}` } });
  return { app, db, service, send, get };
}

function catalogBookCount(): number {
  const catalog = new DatabaseSync(process.env.COVERS_DB_PATH!);
  applyBooksMigrations(catalog);
  const { count } = catalog.prepare("SELECT COUNT(*) AS count FROM books").get() as { count: number };
  catalog.close();
  return count;
}

function addLibraryBook(userId: string, workId: string, title: string) {
  const library = openLibraryDb();
  library.prepare("INSERT INTO library_books (user_id, position, book_key, title, author, row_hash, work_id) VALUES (?, 0, ?, ?, 'Someone', 'h', ?)").run(userId, `ta:${title.toLowerCase()}|someone`, title, workId);
  library.close();
}

test("creating a quiz resolves pool books by title and keeps the first book per work", async () => {
  const held = named("Quiz Held");
  addLibraryBook("q1", held, "Quiz Held");
  const { app, db, send } = await quizApp();
  const created = await send("POST", "/quizzes", "q1", { name: "Mixed", data: { books: [worksBook("Quiz Held", held), worksBook("Pool Classic"), worksBook("Quiz Held again", held)] } });
  assert.equal(created.statusCode, 201);
  const books = created.json().data.books as Array<{ workId: string; title: string }>;
  assert.deepEqual(books.map((entry) => entry.title), ["Quiz Held", "Pool Classic"]);
  assert.equal(books[0]!.workId, held);
  assert.equal(books[1]!.workId, named("Pool Classic"));
  assert.doesNotMatch(created.body, /"key"/);
  const rows = db.prepare("SELECT work_id FROM quiz_works WHERE quiz_id = ? ORDER BY work_id").all(created.json().id) as Array<{ work_id: string }>;
  assert.deepEqual(rows.map((row) => row.work_id), [held, named("Pool Classic")].sort());
  await app.close();
});

test("creating a quiz refuses a title the catalog can't resolve and an unknown work", async () => {
  const { app, send } = await quizApp();
  const unresolved = await send("POST", "/quizzes", "q3", { name: "Bad", data: { books: [worksBook("???")] } });
  assert.equal(unresolved.statusCode, 400);
  assert.equal(unresolved.json().error, "That book isn't in the catalog.");
  const unknown = await send("POST", "/quizzes", "q3", { name: "Bad", data: { books: [worksBook("Nope", "not-a-work")] } });
  assert.equal(unknown.statusCode, 400);
  await app.close();
});

test("PUT validates the document and replaces it whole", async () => {
  const ids = ["Put V1", "Put V2", "Put V3", "Put V4"].map(named);
  const { app, service, send } = await quizApp();
  const created = service.createQuiz("q7", "Draft", { sourceLabel: "Shelf", questionCount: 3, allowedTypes: ["cover_title"], books: [], questions: null });
  const url = `/quizzes/${created.id}`;

  assert.equal((await send("PUT", url, "q7", { data: { books: [null, null, null, null] } })).statusCode, 400);
  assert.equal((await send("PUT", url, "q7", { data: { questionCount: 99, books: [] } })).statusCode, 400);
  assert.equal((await send("PUT", url, "q7", {})).statusCode, 400);

  const valid = await send("PUT", url, "q7", { data: { questionCount: 2, books: ids.map((id, index) => worksBook(`Put V${index + 1}`, id)) } });
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.json().data.questionCount, 2);
  assert.deepEqual(valid.json().data.books.map((entry: { workId: string }) => entry.workId), ids);
  assert.equal((service.getQuiz("q7", created.id)!.data as { sourceLabel: string }).sourceLabel, "");
  await app.close();
});

test("PUT rejects an unknown work and a second edition of one work", async () => {
  const [a, b, old] = [named("Put A"), named("Put B"), named("Put B old edition")];
  openBooksDb().prepare("UPDATE works SET merged_into = ? WHERE id = ?").run(b, old);
  const { app, db, send } = await quizApp();
  const created = await send("POST", "/quizzes", "q2", { name: "Edit", data: { books: [worksBook("Put A", a)] } });
  const id = created.json().id as string;
  const put = (books: unknown[]) => send("PUT", `/quizzes/${id}`, "q2", { data: { books } });
  const ok = await put([worksBook("Put A", a), worksBook("Put B", b)]);
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(ok.json().data.books.map((entry: { workId: string }) => entry.workId), [a, b]);
  assert.equal((await put([worksBook("Put A", "not-a-work")])).statusCode, 400);
  const second = await put([worksBook("Put B", b), worksBook("Put B old edition", old)]);
  assert.equal(second.statusCode, 409);
  assert.match(second.json().error, /Put B old edition/);
  const rows = db.prepare("SELECT work_id FROM quiz_works WHERE quiz_id = ? ORDER BY work_id").all(id) as Array<{ work_id: string }>;
  assert.deepEqual(rows.map((row) => row.work_id), [a, b].sort());
  await app.close();
});

test("an unreachable catalog is a 503 and stores nothing", async () => {
  const [a, b] = [named("Catalog Down"), named("Catalog Down Two")];
  const { app, db, service, send } = await quizApp();
  const existing = service.createQuiz("q8", "Existing", { books: [{ ...book(a, "Catalog Down") }] });
  const coverless = ["Down C1", "Down C2", "Down C3", "Down C4"].map((title) => ({ ...book(named(title), title), coverUrl: null }));
  const pending = service.createQuiz("q8", "Pending", { questionCount: 2, allowedTypes: ["title_cover", "blurb_title"], books: coverless });
  const covered = service.createQuiz("q8", "Covered", { questionCount: 2, allowedTypes: ["cover_title"], books: ["Down K1", "Down K2", "Down K3", "Down K4"].map((title) => book(named(title), title)) });
  const catalog = openBooksDb();
  catalog.exec("ALTER TABLE works RENAME TO works_away");
  try {
    const created = await send("POST", "/quizzes", "q8", { name: "Down", data: { books: [worksBook("Catalog Down", a)] } });
    assert.equal(created.statusCode, 503);
    const updated = await send("PUT", `/quizzes/${existing.id}`, "q8", { data: { books: [worksBook("Catalog Down Two", b)] } });
    assert.equal(updated.statusCode, 503);
    const published = await send("POST", `/quizzes/${pending.id}/publish`, "q8", {});
    assert.equal(published.statusCode, 503);
    assert.equal((await send("POST", `/quizzes/${covered.id}/publish`, "q8", {})).statusCode, 503);
  } finally {
    catalog.exec("ALTER TABLE works_away RENAME TO works");
  }
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM quizzes").get() as { count: number }).count, 3);
  assert.deepEqual((service.getQuiz("q8", existing.id)!.data as { books: Array<{ workId: string }> }).books.map((entry) => entry.workId), [a]);
  assert.equal(service.getQuiz("q8", pending.id)!.voteCode, null);
  assert.equal(service.getQuiz("q8", covered.id)!.voteCode, null);
  await app.close();
});

test("a rejected quiz update resolves nothing and keeps its status", async () => {
  const { app, service, send } = await quizApp();
  const mine = service.createQuiz("q9", "Mine", { books: [] });
  const published = service.createQuiz("q9", "Published", { questionCount: 2, allowedTypes: ["cover_title"], books: Array.from({ length: 4 }, (_, i) => book(`p${i}`)) });
  assert.ok(service.publishQuiz("q9", published.id, []).ok);
  const data = { books: [worksBook("Reject Probe Title")] };

  const before = catalogBookCount();
  assert.equal((await send("PUT", `/quizzes/${mine.id}`, "q10", { data })).statusCode, 404);
  assert.equal((await send("PUT", `/quizzes/${published.id}`, "q9", { data })).statusCode, 404);
  assert.equal((await send("PUT", `/quizzes/${mine.id}`, "q9", { data: "nope" })).statusCode, 400);
  assert.equal(catalogBookCount(), before);

  assert.equal((await send("PUT", `/quizzes/${mine.id}`, "q9", { data })).statusCode, 200);
  assert.equal(catalogBookCount(), before + 1);
  await app.close();
});

async function publishedWorksQuiz(user: string, titles: string[], questionCount: number, allowedTypes: string[]) {
  const ids = titles.map(named);
  const ctx = await quizApp();
  const created = await ctx.send("POST", "/quizzes", user, { name: "Publish", data: { questionCount, allowedTypes, books: ids.map((id, index) => worksBook(titles[index]!, id)) } });
  assert.equal(created.statusCode, 201);
  const published = await ctx.send("POST", `/quizzes/${created.json().id}/publish`, user, {});
  assert.equal(published.statusCode, 201);
  return { ...ctx, ids, quizId: created.json().id as string, published };
}

test("publish and read answer questions and books by work", async () => {
  const { app, ids, quizId, published, get } = await publishedWorksQuiz("q4", ["Pub A", "Pub B", "Pub C", "Pub D"], 3, ["cover_title"]);
  const questions = published.json().quiz.data.questions as Array<Record<string, unknown>>;
  assert.equal(questions.length, 3);
  for (const question of questions) {
    assert.ok(ids.includes(question.workId as string));
    assert.equal("bookKey" in question, false);
  }
  const read = await get(`/quizzes/${quizId}`, "q4");
  assert.deepEqual(read.json().data.books.map((entry: { workId: string }) => entry.workId), ids);
  assert.doesNotMatch(read.body, /"key"/);
  await app.close();
});

test("a published question whose book's work was merged answers the canonical work", async () => {
  const { app, ids, quizId, get } = await publishedWorksQuiz("q6", ["Merge A", "Merge B", "Merge C", "Merge D"], 4, ["title_cover"]);
  const [first, second] = ids as [string, string];
  openBooksDb().prepare("UPDATE works SET merged_into = ? WHERE id = ?").run(first, second);
  const read = await get(`/quizzes/${quizId}`, "q6");
  assert.equal(read.statusCode, 200);
  const data = read.json().data as { books: Array<{ workId: string }>; questions: Array<{ workId: string }> };
  assert.deepEqual(data.books.map((entry) => entry.workId), [first, ids[2], ids[3]]);
  assert.equal(data.questions.filter((question) => question.workId === first).length, 2);
  assert.equal(data.questions.some((question) => question.workId === second), false);
  await app.close();
});

test("the public board shows each question's prompt from its own book after two editions merge", async () => {
  const titles = ["Board A", "Board B", "Board C", "Board D"];
  const { app, ids, service, quizId, get } = await publishedWorksQuiz("q11", titles, 4, ["title_cover"]);
  const stored = service.getQuiz("q11", quizId)!;
  const code = stored.voteCode!;
  const questions = (stored.data as { questions: Array<{ id: string; workId: string }> }).questions;
  const titleOf = new Map(ids.map((id, index) => [id, titles[index]!]));
  openBooksDb().prepare("UPDATE works SET merged_into = ? WHERE id = ?").run(ids[0]!, ids[1]!);
  const board = await get(`/quizzes/voting/${code}`, "q11");
  assert.equal(board.statusCode, 200);
  const prompts = new Map((board.json().board.questions as Array<{ id: string; prompt: string }>).map((question) => [question.id, question.prompt]));
  for (const question of questions) assert.equal(prompts.get(question.id), titleOf.get(question.workId));
  assert.deepEqual([...prompts.values()].sort(), [...titles].sort());
  await app.close();
});

test("publish counts one book per work after two editions merge", async () => {
  const ids = ["Dup Pub A", "Dup Pub B", "Dup Pub C", "Dup Pub D"].map(named);
  const { app, service, send } = await quizApp();
  const draft = service.createQuiz("q13", "Merged", { questionCount: 2, allowedTypes: ["cover_title"], books: ids.map((id, index) => book(id, `Dup Pub ${"ABCD"[index]}`)) });
  openBooksDb().prepare("UPDATE works SET merged_into = ? WHERE id = ?").run(ids[0]!, ids[1]!);
  const published = await send("POST", `/quizzes/${draft.id}/publish`, "q13", {});
  assert.equal(published.statusCode, 400);
  assert.match(published.json().error, /at least 4 books/i);
  assert.equal(service.getQuiz("q13", draft.id)!.voteCode, null);
  await app.close();
});

function breakCatalog(): () => void {
  const catalog = openBooksDb();
  catalog.exec("ALTER TABLE works RENAME TO works_down");
  return () => {
    catalog.exec("ALTER TABLE works_down RENAME TO works");
    catalog.close();
  };
}

test("a publish with the catalog down is a 503 and writes nothing", async () => {
  const ids = ["Down A", "Down B", "Down C", "Down D"].map(named);
  const { app, service, send } = await quizApp();
  const created = await send("POST", "/quizzes", "q6", { name: "Down", data: { questionCount: 3, allowedTypes: ["cover_title"], books: ids.map((id, index) => worksBook(`Down ${"ABCD"[index]}`, id)) } });
  assert.equal(created.statusCode, 201);
  const id = created.json().id as string;
  const restore = breakCatalog();
  try {
    const published = await app.inject({ method: "POST", url: `/quizzes/${id}/publish`, headers: { authorization: "Bearer q6" } });
    assert.equal(published.statusCode, 503);
  } finally {
    restore();
  }
  const stored = service.getQuiz("q6", id)!;
  assert.equal(stored.voteCode, null);
  assert.equal((stored.data as { questions: unknown }).questions ?? null, null);
  const retried = await app.inject({ method: "POST", url: `/quizzes/${id}/publish`, headers: { authorization: "Bearer q6" } });
  assert.equal(retried.statusCode, 201);
  await app.close();
});

test("a create answers from the books it resolved, even if the catalog dies right after the write", async () => {
  const ids = ["Gone A", "Gone B"].map(named);
  let restore = () => {};
  const { app, db, send } = await quizApp((service) => ({
    ...service,
    createQuiz: (...args) => {
      const quiz = service.createQuiz(...args);
      restore = breakCatalog();
      return quiz;
    }
  }));
  try {
    const created = await send("POST", "/quizzes", "q7", { name: "Gone", data: { books: ids.map((id, index) => worksBook(`Gone ${"AB"[index]}`, id)) } });
    assert.equal(created.statusCode, 201);
    assert.deepEqual(created.json().data.books.map((entry: { workId: string }) => entry.workId), ids);
    assert.doesNotMatch(created.body, /"key"/);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM quizzes").get() as { count: number }).count, 1);
  } finally {
    restore();
  }
  await app.close();
});

test("publish fills a missing cover from the owner's library copy of that work", async () => {
  const ids = ["Fill A", "Fill B", "Fill C", "Fill D"].map(named);
  const library = openLibraryDb();
  library.prepare("INSERT INTO library_books (user_id, position, book_key, title, author, cover_url, row_hash, work_id) VALUES ('q14', 0, 'ta:fill a|someone', 'Fill A', 'Someone', 'https://covers.test/library-copy.jpg', 'h', ?)").run(ids[0]!);
  library.prepare("INSERT INTO library_summary (user_id, meta, total_books, finished_count, in_progress_count, total_highlights, source_updated_at, rows_version) VALUES ('q14', '{}', 1, 0, 0, 0, '2026-01-01', 1)").run();
  const { app, send, get } = await quizApp();
  const created = await send("POST", "/quizzes", "q14", { name: "Fill", data: { questionCount: 3, allowedTypes: ["cover_title"], books: ids.map((id, index) => worksBook(`Fill ${"ABCD"[index]}`, id, index === 0 ? null : undefined)) } });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().data.books[0].coverUrl, null);
  const published = await send("POST", `/quizzes/${created.json().id}/publish`, "q14", {});
  assert.equal(published.statusCode, 201);
  assert.deepEqual(published.json().quiz.data.books.map((entry: { coverUrl: string | null }) => entry.coverUrl), ["https://covers.test/library-copy.jpg", "https://covers.test/Fill%20B.jpg", "https://covers.test/Fill%20C.jpg", "https://covers.test/Fill%20D.jpg"]);
  assert.equal((await get(`/quizzes/${created.json().id}`, "q14")).json().data.books[0].coverUrl, "https://covers.test/library-copy.jpg");
  await app.close();
});

test("a name-only edit with the catalog down is a 503 and writes nothing", async () => {
  const ids = ["Edit Down A", "Edit Down B", "Edit Down C", "Edit Down D"].map(named);
  const { app, service, send } = await quizApp();
  const created = await send("POST", "/quizzes", "q15", { name: "Before", data: { books: ids.map((id, index) => worksBook(`Edit Down ${"ABCD"[index]}`, id)) } });
  const id = created.json().id as string;
  const restore = breakCatalog();
  try {
    assert.equal((await send("PUT", `/quizzes/${id}`, "q15", { name: "After" })).statusCode, 503);
  } finally {
    restore();
  }
  assert.equal(service.getQuiz("q15", id)!.name, "Before");
  assert.equal((await send("PUT", `/quizzes/${id}`, "q15", { name: "After" })).statusCode, 200);
  await app.close();
});

test("a play toggle with the catalog down is a 503 and leaves the play state", async () => {
  const { app, service, send, quizId } = await publishedWorksQuiz("q16", ["Toggle A", "Toggle B", "Toggle C", "Toggle D"], 3, ["cover_title"]);
  const before = service.getQuiz("q16", quizId)!.playOpen;
  const restore = breakCatalog();
  try {
    assert.equal((await send("PUT", `/quizzes/${quizId}/voting`, "q16", { open: !before })).statusCode, 503);
  } finally {
    restore();
  }
  assert.equal(service.getQuiz("q16", quizId)!.playOpen, before);
  assert.equal((await send("PUT", `/quizzes/${quizId}/voting`, "q16", { open: !before })).statusCode, 200);
  await app.close();
});

test("a play toggle by someone who does not own the quiz is a 404, and a published quiz's name-only edit is a 404 with the catalog down", async () => {
  const { app, service, send, quizId } = await publishedWorksQuiz("q17", ["Own A", "Own B", "Own C", "Own D"], 3, ["cover_title"]);
  const before = service.getQuiz("q17", quizId)!.playOpen;
  assert.equal((await send("PUT", `/quizzes/${quizId}/voting`, "q18", { open: !before })).statusCode, 404);
  assert.equal(service.getQuiz("q17", quizId)!.playOpen, before);
  const restore = breakCatalog();
  try {
    assert.equal((await send("PUT", `/quizzes/${quizId}`, "q17", { name: "Renamed" })).statusCode, 404);
  } finally {
    restore();
  }
  await app.close();
});
