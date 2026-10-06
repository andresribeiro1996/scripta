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
const { WorkResolutionError } = await import("../library/index.js");

type Service = ReturnType<typeof createQuizzesService>;

const book = (key: string, title = `Title ${key}`, author = "A") => ({ key, title, author, coverUrl: `https://covers.test/${key}.jpg`, quote: `Quote ${key}`, blurb: null });

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

// Owner-route wire shape: PUT must validate the document with the same
// schema POST uses — the quiz document drives publish-time generation, so
// an unvalidated update can poison a later publish.
async function callOwner(service: Service, options: InjectOptions, token = "u1") {
  const app = Fastify();
  app.decorate("authenticateAccessToken", (value: string) => value === token ? { id: token, email: `${token}@example.test`, username: token, avatarId: null } : null);
  await app.register(buildQuizRoutes(service));
  const res = await app.inject({ ...options, headers: { ...options.headers, authorization: `Bearer ${token}` } });
  await app.close();
  return { status: res.statusCode, body: res.json() as Record<string, never> };
}

test("PUT validates the document: null books, duplicates and bad shapes are 400s", async () => {
  const db = new DatabaseSync(":memory:");
  applyQuizzesMigrations(db);
  const service = createQuizzesService(createSqliteQuizzesRepository(db));
  const created = service.createQuiz("u1", "Draft", {
    sourceLabel: "Shelf",
    questionCount: 3,
    allowedTypes: ["cover_title"],
    books: Array.from({ length: 6 }, (_, i) => book(`b${i}`)),
    questions: null
  });

  const nullBooks = await callOwner(service, { method: "PUT", url: `/quizzes/${created.id}`, body: { data: { books: [null, null, null, null] } } });
  assert.equal(nullBooks.status, 400);

  const duplicate = await callOwner(service, {
    method: "PUT",
    url: `/quizzes/${created.id}`,
    body: { data: { books: [book("b1"), book("b1")] } }
  });
  assert.equal(duplicate.status, 400);

  const badCount = await callOwner(service, {
    method: "PUT",
    url: `/quizzes/${created.id}`,
    body: { data: { questionCount: 99, books: [] } }
  });
  assert.equal(badCount.status, 400);

  const valid = await callOwner(service, {
    method: "PUT",
    url: `/quizzes/${created.id}`,
    body: { data: { questionCount: 2, books: [book("b1"), book("b2"), book("b3"), book("b4")] } }
  });
  assert.equal(valid.status, 200);
  const stored = (valid.body as unknown as { data: { questionCount: number; books: unknown[] } }).data;
  assert.equal(stored.questionCount, 2);
  assert.equal(stored.books.length, 4);

  // The document is replace-on-PUT: omitted fields fall back to their
  // defaults, same whole-document semantics as PUT /library.
  assert.deepEqual((service.getQuiz("u1", created.id)!.data as { sourceLabel: string }).sourceLabel, "");
});

type QuizRoutesResolver = NonNullable<Parameters<typeof buildQuizRoutes>[1]>;

async function quizApp(resolveWorks?: QuizRoutesResolver, wrap: (service: Service) => Service = (service) => service) {
  const db = new DatabaseSync(":memory:");
  applyQuizzesMigrations(db);
  const service = createQuizzesService(createSqliteQuizzesRepository(db));
  const app = Fastify();
  app.decorate("authenticateAccessToken", (token: string) => ({ id: token, email: `${token}@example.test`, username: token, avatarId: null }));
  await app.register(buildQuizRoutes(wrap(service), resolveWorks));
  const send = (method: "POST" | "PUT", url: string, user: string, payload: unknown) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${user}` }, payload: payload as Record<string, unknown> });
  return { app, db, service, send };
}

function addLibraryBook(userId: string, position: number, bookKey: string, title: string, author: string, isbn: string | null) {
  const library = openLibraryDb();
  library.prepare("INSERT INTO library_books (user_id, position, book_key, title, author, isbn, row_hash) VALUES (?, ?, ?, ?, ?, ?, 'h')").run(userId, position, bookKey, title, author, isbn);
  library.close();
}

function catalogBookCount(): number {
  const catalog = new DatabaseSync(process.env.COVERS_DB_PATH!);
  applyBooksMigrations(catalog);
  const { count } = catalog.prepare("SELECT COUNT(*) AS count FROM books").get() as { count: number };
  catalog.close();
  return count;
}

const DUNE_A = book("isbn:0441013597", "Dune", "Frank Herbert");
const DUNE_B = book("isbn:9780441013593", "Dune", "Frank Herbert");

test("creating a quiz from a shelf keeps the first edition of each work", async () => {
  addLibraryBook("u1", 0, DUNE_A.key, "Dune", "Frank Herbert", "0441013597");
  addLibraryBook("u1", 1, DUNE_B.key, "Dune", "Frank Herbert", "9780441013593");
  const { app, db, send } = await quizApp();

  const res = await send("POST", "/quizzes", "u1", { name: "Shelf", data: { books: [DUNE_A, DUNE_B, book("pool-1984", "1984", "George Orwell")] } });
  assert.equal(res.statusCode, 201);
  const created = res.json() as { id: string; data: { books: Array<{ key: string }> } };
  assert.deepEqual(created.data.books.map((b) => b.key), [DUNE_A.key, "pool-1984"]);
  const rows = db.prepare("SELECT key, work_id FROM quiz_works WHERE quiz_id = ? ORDER BY key").all(created.id) as Array<{ key: string; work_id: string | null }>;
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.work_id !== null));
  await app.close();
});

test("updating a quiz with two editions of one work is a 409", async () => {
  addLibraryBook("u2", 0, DUNE_A.key, "Dune", "Frank Herbert", "0441013597");
  addLibraryBook("u2", 1, DUNE_B.key, "Dune", "Frank Herbert", "9780441013593");
  const { app, db, send } = await quizApp();

  const created = await send("POST", "/quizzes", "u2", { name: "One", data: { books: [DUNE_A] } });
  const id = (created.json() as { id: string }).id;
  const updated = await send("PUT", `/quizzes/${id}`, "u2", { data: { books: [DUNE_A, DUNE_B] } });
  assert.equal(updated.statusCode, 409);
  assert.match((updated.json() as { error: string }).error, /Dune/);
  const stored = db.prepare("SELECT key FROM quiz_works WHERE quiz_id = ?").all(id) as Array<{ key: string }>;
  assert.deepEqual(stored.map((row) => row.key), [DUNE_A.key]);
  await app.close();
});

test("a draft already holding two editions keeps both when saved again", async () => {
  addLibraryBook("u5", 0, DUNE_A.key, "Dune", "Frank Herbert", "0441013597");
  addLibraryBook("u5", 1, DUNE_B.key, "Dune", "Frank Herbert", "9780441013593");
  const { app, db, service, send } = await quizApp();
  const legacy = service.createQuiz("u5", "Legacy", { books: [DUNE_A, DUNE_B] });

  const kept = await send("PUT", `/quizzes/${legacy.id}`, "u5", { data: { questionCount: 3, books: [DUNE_A, DUNE_B] } });
  assert.equal(kept.statusCode, 200);
  const rows = db.prepare("SELECT key FROM quiz_works WHERE quiz_id = ? ORDER BY key").all(legacy.id) as Array<{ key: string }>;
  assert.deepEqual(rows.map((row) => row.key), [DUNE_A.key, DUNE_B.key].sort());

  await app.close();
});

test("an unreachable catalog is a 503 and stores nothing", async () => {
  const failing: QuizRoutesResolver = () => { throw new WorkResolutionError(new Error("down")); };
  const { app, db, service, send } = await quizApp(failing);

  const created = await send("POST", "/quizzes", "u1", { name: "Down", data: { books: [book("pool-a")] } });
  assert.equal(created.statusCode, 503);
  assert.equal((created.json() as { error: string }).error.length > 0, true);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM quizzes").get() as { count: number }).count, 0);

  const existing = service.createQuiz("u1", "Existing", { books: [book("old")] });
  const updated = await send("PUT", `/quizzes/${existing.id}`, "u1", { data: { books: [book("new")] } });
  assert.equal(updated.statusCode, 503);
  assert.deepEqual((service.getQuiz("u1", existing.id)!.data as { books: Array<{ key: string }> }).books.map((b) => b.key), ["old"]);
  await app.close();
});

test("a rejected quiz update resolves nothing and keeps its status", async () => {
  addLibraryBook("u3", 2, "isbn:9780441569595", "Neuromancer", "William Gibson", "9780441569595");
  addLibraryBook("u4", 0, "isbn:9780441569595", "Neuromancer", "William Gibson", "9780441569595");
  const { app, service, send } = await quizApp();
  const mine = service.createQuiz("u3", "Mine", { books: [] });
  const published = service.createQuiz("u3", "Published", { questionCount: 2, allowedTypes: ["cover_title"], books: Array.from({ length: 4 }, (_, i) => book(`p${i}`)) });
  assert.ok(service.publishQuiz("u3", published.id, []).ok);
  const data = { books: [book("isbn:9780441569595", "Neuromancer", "William Gibson")] };

  const before = catalogBookCount();
  assert.equal((await send("PUT", `/quizzes/${mine.id}`, "u4", { data })).statusCode, 404);
  assert.equal((await send("PUT", `/quizzes/${published.id}`, "u3", { data })).statusCode, 404);
  assert.equal((await send("PUT", `/quizzes/${mine.id}`, "u3", { data: "nope" })).statusCode, 400);
  assert.equal(catalogBookCount(), before);

  assert.equal((await send("PUT", `/quizzes/${mine.id}`, "u3", { data })).statusCode, 200);
  assert.equal(catalogBookCount(), before + 1);
  await app.close();
});

const quizHeaders = (user: string) => ({ authorization: `Bearer ${user}`, "x-scripta-works": "1" });
const named = (title: string) => resolveWorks([{ isbn: null, title, author: "Someone" }])[0]!;
const worksBook = (title: string, workId?: string) => ({ ...(workId ? { workId } : {}), title, author: "Someone", coverUrl: "https://covers.test/x.jpg", quote: null, blurb: null });

test("a works-format create resolves pool books by title, keeps one book per work, and answers works", async () => {
  const held = named("Quiz Held");
  openLibraryDb().prepare("INSERT INTO library_books (user_id, position, book_key, title, author, row_hash, work_id) VALUES ('q1', 0, 'ta:quiz held|someone', 'Quiz Held', 'Someone', 'h', ?)").run(held);
  const { app } = await quizApp();
  const created = await app.inject({ method: "POST", url: "/quizzes", headers: quizHeaders("q1"), payload: { name: "Mixed", data: { books: [worksBook("Quiz Held", held), worksBook("Pool Classic"), worksBook("Quiz Held again", held)] } } });
  assert.equal(created.statusCode, 201);
  const books = created.json().data.books as Array<{ workId: string; title: string }>;
  assert.deepEqual(books.map((entry) => entry.title), ["Quiz Held", "Pool Classic"]);
  assert.equal(books[0]!.workId, held);
  assert.equal(books[1]!.workId, named("Pool Classic"));
  assert.doesNotMatch(created.body, /"key"/);
  const legacy = await app.inject({ method: "GET", url: `/quizzes/${created.json().id}`, headers: { authorization: "Bearer q1" } });
  assert.deepEqual(legacy.json().data.books.map((entry: { key: string }) => entry.key), ["ta:quiz held|someone", named("Pool Classic")]);
  await app.close();
});

test("a works-format PUT keeps stored keys, rejects an unknown work and a second edition", async () => {
  const [a, b, old] = [named("Put A"), named("Put B"), named("Put B old edition")];
  openBooksDb().prepare("UPDATE works SET merged_into = ? WHERE id = ?").run(b, old);
  const { app } = await quizApp();
  const created = await app.inject({ method: "POST", url: "/quizzes", headers: quizHeaders("q2"), payload: { name: "Edit", data: { books: [worksBook("Put A", a)] } } });
  const id = created.json().id as string;
  const put = (books: unknown[]) => app.inject({ method: "PUT", url: `/quizzes/${id}`, headers: quizHeaders("q2"), payload: { data: { books } } });
  const ok = await put([worksBook("Put A", a), worksBook("Put B", b)]);
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(ok.json().data.books.map((entry: { workId: string }) => entry.workId), [a, b]);
  assert.equal((await put([worksBook("Put A", "not-a-work")])).statusCode, 400);
  assert.equal((await put([worksBook("Put B", b), worksBook("Put B old edition", old)])).statusCode, 409);
  await app.close();
});

test("a works-format create refuses a title the catalog can't resolve", async () => {
  const { app } = await quizApp();
  const created = await app.inject({ method: "POST", url: "/quizzes", headers: quizHeaders("q3"), payload: { name: "Bad", data: { books: [worksBook("???")] } } });
  assert.equal(created.statusCode, 400);
  assert.equal(created.json().error, "That book isn't in the catalog.");
  await app.close();
});

test("a works-format publish and read answer questions and books by work", async () => {
  const ids = ["Pub A", "Pub B", "Pub C", "Pub D"].map(named);
  const { app } = await quizApp();
  const created = await app.inject({
    method: "POST",
    url: "/quizzes",
    headers: quizHeaders("q4"),
    payload: { name: "Publish", data: { questionCount: 3, allowedTypes: ["cover_title"], books: ids.map((id, index) => worksBook(`Pub ${"ABCD"[index]}`, id)) } }
  });
  assert.equal(created.statusCode, 201);
  const published = await app.inject({ method: "POST", url: `/quizzes/${created.json().id}/publish`, headers: quizHeaders("q4") });
  assert.equal(published.statusCode, 201);
  const questions = published.json().quiz.data.questions as Array<Record<string, unknown>>;
  assert.equal(questions.length, 3);
  for (const question of questions) {
    assert.ok(ids.includes(question.workId as string));
    assert.equal("bookKey" in question, false);
  }
  const read = await app.inject({ method: "GET", url: `/quizzes/${created.json().id}`, headers: quizHeaders("q4") });
  const books = read.json().data.books as Array<{ workId: string }>;
  assert.deepEqual(books.map((entry) => entry.workId), ids);
  assert.doesNotMatch(read.body, /"key"/);
  await app.close();
});

test("a works-format PUT keeps the key a legacy book was stored under", async () => {
  const kept = named("Put Keep");
  const { app } = await quizApp();
  const created = await app.inject({ method: "POST", url: "/quizzes", headers: { authorization: "Bearer q5" }, payload: { name: "Keys", data: { books: [book("ta:put keep|someone", "Put Keep", "Someone")] } } });
  assert.equal(created.statusCode, 201);
  addLibraryBook("q5", 0, "isbn:9780000000099", "Put Keep", "Someone", null);
  openLibraryDb().prepare("UPDATE library_books SET work_id = ? WHERE user_id = 'q5'").run(kept);
  const put = await app.inject({ method: "PUT", url: `/quizzes/${created.json().id}`, headers: quizHeaders("q5"), payload: { data: { books: [worksBook("Put Keep", kept), worksBook("Put Second")] } } });
  assert.equal(put.statusCode, 200);
  const legacy = await app.inject({ method: "GET", url: `/quizzes/${created.json().id}`, headers: { authorization: "Bearer q5" } });
  assert.equal(legacy.json().data.books[0].key, "ta:put keep|someone");
  await app.close();
});

test("a works-format read leaves out an unresolved book and a second edition of one work", async () => {
  const [first, second] = [named("Edition One"), named("Edition Two")];
  const { app } = await quizApp();
  const created = await app.inject({
    method: "POST",
    url: "/quizzes",
    headers: { authorization: "Bearer q6" },
    payload: { name: "Reads", data: { books: [book("pool-q", "???"), book("pool-e1", "Edition One", "Someone"), book("pool-e2", "Edition Two", "Someone")] } }
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().data.books.length, 3);
  openBooksDb().prepare("UPDATE works SET merged_into = ? WHERE id = ?").run(first, second);
  const read = await app.inject({ method: "GET", url: `/quizzes/${created.json().id}`, headers: quizHeaders("q6") });
  assert.equal(read.statusCode, 200);
  assert.deepEqual(read.json().data.books.map((entry: { workId: string }) => entry.workId), [first]);
  assert.match(String(read.headers.vary), /X-Scripta-Works/);
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

test("a works-format publish with the catalog down is a 503 and writes nothing", async () => {
  const ids = ["Down A", "Down B", "Down C", "Down D"].map(named);
  const { app, service } = await quizApp();
  const created = await app.inject({
    method: "POST",
    url: "/quizzes",
    headers: quizHeaders("q6"),
    payload: { name: "Down", data: { questionCount: 3, allowedTypes: ["cover_title"], books: ids.map((id, index) => worksBook(`Down ${"ABCD"[index]}`, id)) } }
  });
  assert.equal(created.statusCode, 201);
  const id = created.json().id as string;
  const restore = breakCatalog();
  try {
    const published = await app.inject({ method: "POST", url: `/quizzes/${id}/publish`, headers: quizHeaders("q6") });
    assert.equal(published.statusCode, 503);
  } finally {
    restore();
  }
  const stored = service.getQuiz("q6", id)!;
  assert.equal(stored.voteCode, null);
  assert.equal((stored.data as { questions: unknown }).questions ?? null, null);
  const retried = await app.inject({ method: "POST", url: `/quizzes/${id}/publish`, headers: quizHeaders("q6") });
  assert.equal(retried.statusCode, 201);
  await app.close();
});

test("a works-format create answers from the books it resolved, even if the catalog dies right after the write", async () => {
  const ids = ["Gone A", "Gone B"].map(named);
  let restore = () => {};
  const { app, db } = await quizApp(undefined, (service) => ({
    ...service,
    createQuiz: (...args) => {
      const quiz = service.createQuiz(...args);
      restore = breakCatalog();
      return quiz;
    }
  }));
  try {
    const created = await app.inject({ method: "POST", url: "/quizzes", headers: quizHeaders("q7"), payload: { name: "Gone", data: { books: ids.map((id, index) => worksBook(`Gone ${"AB"[index]}`, id)) } } });
    assert.equal(created.statusCode, 201);
    assert.deepEqual(created.json().data.books.map((entry: { workId: string }) => entry.workId), ids);
    assert.doesNotMatch(created.body, /"key"/);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM quizzes").get() as { count: number }).count, 1);
  } finally {
    restore();
  }
  await app.close();
});

test("a header-less create and publish answer in the stored key shape", async () => {
  const { app } = await quizApp();
  const books = Array.from({ length: 4 }, (_, i) => book(`legacy-shape-${i}`, `Legacy Shape ${i}`));
  const created = await app.inject({ method: "POST", url: "/quizzes", headers: { authorization: "Bearer q8" }, payload: { name: "Legacy", data: { questionCount: 3, allowedTypes: ["cover_title"], books } } });
  assert.equal(created.statusCode, 201);
  assert.deepEqual(created.json().data.books.map((entry: { key: string }) => entry.key), books.map((entry) => entry.key));
  const published = await app.inject({ method: "POST", url: `/quizzes/${created.json().id}/publish`, headers: { authorization: "Bearer q8" } });
  assert.equal(published.statusCode, 201);
  assert.deepEqual(published.json().quiz.data.books.map((entry: { key: string }) => entry.key), books.map((entry) => entry.key));
  assert.equal(typeof published.json().voteCode, "string");
  assert.doesNotMatch(published.body, /workId/);
  await app.close();
});
