// Exercises service.ts against a hand-written in-memory QuizzesRepository
// fake — no real SQLite, same seam as tierlists' service.test.ts.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { QuizWorks, QuizzesRepository } from "./domain/ports.js";
import type { PublicBookData, QuizBook } from "@scripta/shared";
import type { AnswerRow, PlayRow, QuizRow } from "./domain/types.js";
import { normalizeWords } from "@scripta/shared";
import { createQuizzesPublicApi, createQuizzesService, type QuizWriteOutcome } from "./service.js";

function fakeWorks(options: { aliases?: Record<string, string>; titles?: Record<string, string>; covers?: Record<string, string> } = {}): QuizWorks {
  const alias = (id: string) => options.aliases?.[id] ?? id;
  return {
    knownWorkIds: (ids) => ids.map(alias),
    resolveTitleWorks: (books) => books.map((entry) => options.titles?.[entry.title] ?? null),
    canonicalByKey: (ids) => new Map([...ids].map(([key, id]) => [key, alias(id)])),
    publicBooksByWork: (_ownerUserId, workIds) =>
      new Map(workIds.flatMap((id) => (options.covers?.[id] ? [[id, { key: id, workId: id, title: id, author: "A", isbn: null, imageId: null, coverUrl: options.covers[id]!, readStatus: null } satisfies PublicBookData] as const] : [])))
  };
}

function created(outcome: QuizWriteOutcome) {
  assert.equal(outcome.ok, true);
  return outcome.ok ? outcome.quiz : (undefined as never);
}

function createInMemoryRepo(): QuizzesRepository {
  const quizzes = new Map<string, QuizRow>();
  const plays = new Map<string, PlayRow>();
  const answers = new Map<string, AnswerRow[]>();
  return {
    listByUser: (userId) => [...quizzes.values()].filter((q) => q.owner_user_id === userId),
    getOwned: (id, userId) => {
      const q = quizzes.get(id);
      return q && q.owner_user_id === userId ? q : undefined;
    },
    getById: (id) => quizzes.get(id),
    insert: (row) => quizzes.set(row.id, { ...row }),
    update: (id, userId, patch) => {
      const existing = quizzes.get(id);
      if (!existing || existing.owner_user_id !== userId) return undefined;
      const merged = { ...existing, ...patch, updated_at: new Date().toISOString() };
      quizzes.set(id, merged);
      return merged;
    },
    delete: (id, userId) => {
      const existing = quizzes.get(id);
      if (!existing || existing.owner_user_id !== userId) return false;
      quizzes.delete(id);
      return true;
    },
    deleteUserData: () => {},
    getByVoteCode: (code) => [...quizzes.values()].find((q) => q.vote_code === code),
    publish: (id, userId, data, code) => {
      const row = quizzes.get(id);
      if (!row || row.owner_user_id !== userId || row.vote_code) return undefined;
      const published = { ...row, data, vote_code: code, play_open: 1 };
      quizzes.set(id, published);
      return published;
    },
    setPlayOpen: (id, userId, open) => {
      const existing = quizzes.get(id);
      if (!existing || existing.owner_user_id !== userId) return undefined;
      const merged = { ...existing, play_open: open };
      quizzes.set(id, merged);
      return merged;
    },
    getPlayById: (quizId, playId) => {
      const p = plays.get(playId);
      return p && p.quiz_id === quizId ? p : undefined;
    },
    getPlayByVoter: (quizId, voter) => [...plays.values()].find((p) => p.quiz_id === quizId && p.voter_user_id === voter),
    savePlay: (play, rows) => {
      plays.set(play.id, { ...play });
      answers.set(play.id, [...rows]);
    },
    getAnswers: (playId) => answers.get(playId) ?? [],
    listPlays: (quizId) =>
      [...plays.values()]
        .filter((p) => p.quiz_id === quizId)
        .sort((a, b) => b.score - a.score || a.duration_ms - b.duration_ms),
    playCount: (quizId) => [...plays.values()].filter((p) => p.quiz_id === quizId).length,
    questionStats: (quizId) => {
      const byQuestion = new Map<string, { answerCount: number; correctCount: number; picks: Map<number, number> }>();
      for (const rows of answers.values()) {
        if (rows[0]?.quiz_id !== quizId) continue;
        for (const row of rows) {
          let stat = byQuestion.get(row.question_id);
          if (!stat) byQuestion.set(row.question_id, (stat = { answerCount: 0, correctCount: 0, picks: new Map() }));
          stat.answerCount += 1;
          stat.correctCount += row.correct;
          stat.picks.set(row.choice_index, (stat.picks.get(row.choice_index) ?? 0) + 1);
        }
      }
      return [...byQuestion.entries()].map(([questionId, s]) => ({
        questionId,
        answerCount: s.answerCount,
        correctCount: s.correctCount,
        picks: [...s.picks.entries()].map(([choiceIndex, count]) => ({ choiceIndex, count }))
      }));
    },
    listPublishedByWorks: () => [],
    topShelfFacts: () => [],
    getPublicById: (id) => [...quizzes.values()].find((q) => q.id === id && q.vote_code !== null),
    listPublicByUser: (ownerUserId) =>
      [...quizzes.values()]
        .filter((q) => q.owner_user_id === ownerUserId && q.vote_code !== null)
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    listPublicByIds: (ids) => [...quizzes.values()].filter((q) => q.vote_code !== null && ids.includes(q.id)),
    discoverWindow: (needle, limit) =>
      [...quizzes.values()]
        .filter((q) => q.vote_code !== null && normalizeWords(q.name).includes(needle))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, limit),
    playCountsFor: (ids) => {
      const counts = new Map<string, number>();
      for (const p of plays.values()) if (ids.includes(p.quiz_id)) counts.set(p.quiz_id, (counts.get(p.quiz_id) ?? 0) + 1);
      return counts;
    },
    votedAmong: (viewerUserId, ids) => ids.filter((id) => [...plays.values()].some((p) => p.quiz_id === id && p.voter_user_id === viewerUserId)),
    listParticipation: () => [],
    listRecentPlayers: () => []
  };
}

const book = (workId: string, extra: Partial<QuizBook> = {}): QuizBook => ({
  workId,
  title: `Title ${workId}`,
  author: "A",
  coverUrl: `https://covers.test/${workId}.jpg`,
  quote: `Quote ${workId}`,
  blurb: `Blurb ${workId}`,
  ...extra
});

function makeService() {
  const repo = createInMemoryRepo();
  const service = createQuizzesService(repo, fakeWorks());
  const made = created(service.createQuiz("u1", "My quiz", {
    sourceLabel: "Shelf",
    questionCount: 3,
    allowedTypes: ["cover_title", "title_cover", "quote_title", "blurb_title"],
    books: [book("b0", { coverUrl: null }), ...Array.from({ length: 5 }, (_, i) => book(`b${i + 1}`))]
  }));
  return { repo, service, quizId: made.id };
}

test("publish generates the full seeded set, mints a code, and opens play", () => {
  const { service, quizId } = makeService();
  const outcome = service.publishQuiz("u1", quizId);
  assert.ok(outcome.ok);
  if (!outcome.ok) return;
  assert.ok(outcome.quiz.voteCode);
  const data = outcome.quiz.data as { questions: Array<{ id: string; options: string[]; answerIndex: number }>; books: unknown[] };
  assert.equal(data.questions.length, 3);
  assert.equal(data.books.length, 6);
  assert.equal(outcome.quiz.playOpen, true);
});

test("publish fills a missing cover from the owner's library copy of that work and keeps a cover the book already has", () => {
  const repo = createInMemoryRepo();
  const draft = created(createQuizzesService(repo, fakeWorks()).createQuiz("u1", "My quiz", {
    sourceLabel: "",
    questionCount: 3,
    allowedTypes: ["cover_title"],
    books: [book("b0", { coverUrl: null }), ...Array.from({ length: 5 }, (_, i) => book(`b${i + 1}`))]
  }));
  const service = createQuizzesService(repo, fakeWorks({ covers: { b0: "https://library.test/b0.jpg", b1: "https://library.test/b1.jpg" } }));
  const outcome = service.publishQuiz("u1", draft.id);
  assert.ok(outcome.ok);
  const books = outcome.ok ? (outcome.quiz.data as { books: Array<{ workId: string; coverUrl: string | null }> }).books : [];
  assert.equal(books.find((b) => b.workId === "b0")!.coverUrl, "https://library.test/b0.jpg");
  assert.equal(books.find((b) => b.workId === "b1")!.coverUrl, "https://covers.test/b1.jpg");
});

test("publish counts one book per work after two editions merge", () => {
  const { repo, quizId } = makeService();
  const merged = createQuizzesService(repo, fakeWorks({ aliases: { b1: "b0", b2: "b0", b3: "b0" } }));
  const outcome = merged.publishQuiz("u1", quizId);
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.equal(outcome.reason, "invalid");
    assert.match((outcome as { error: string }).error, /at least 4 books/i);
  }
});

const input = (books: Array<{ workId?: string; title: string; author: string }>) => ({ sourceLabel: "", questionCount: 3, allowedTypes: ["cover_title" as const], books });

test("a create resolves books by work id or by title and keeps the first book per work", () => {
  const service = createQuizzesService(createInMemoryRepo(), fakeWorks({ aliases: { old: "w1" }, titles: { Pool: "w2" } }));
  const outcome = service.createQuiz("u1", "Mixed", input([{ workId: "w1", title: "One", author: "A" }, { title: "Pool", author: "A" }, { workId: "old", title: "One again", author: "A" }, { workId: "w2", title: "Pool again", author: "A" }]));
  assert.ok(outcome.ok);
  if (!outcome.ok) return;
  assert.deepEqual((outcome.quiz.data as { books: Array<{ workId: string; title: string }> }).books.map((b) => [b.workId, b.title]), [["w1", "One"], ["w2", "Pool"]]);
  assert.deepEqual([...outcome.canonical], [["w1", "w1"], ["w2", "w2"]]);
});

test("a create with a book the catalog can't place is invalid: That book isn't in the catalog.", () => {
  const repo = createInMemoryRepo();
  const outcome = createQuizzesService(repo, fakeWorks()).createQuiz("u1", "Bad", input([{ title: "???", author: "A" }]));
  assert.deepEqual(outcome, { ok: false, reason: "invalid", error: "That book isn't in the catalog." });
  assert.deepEqual(repo.listByUser("u1"), []);
});

test("an update with two editions of one work is a duplicate-work outcome carrying the second book's title", () => {
  const repo = createInMemoryRepo();
  const draft = created(createQuizzesService(repo, fakeWorks()).createQuiz("u1", "Draft", input([])));
  const service = createQuizzesService(repo, fakeWorks({ aliases: { w2: "w1" } }));
  const outcome = service.updateQuiz("u1", draft.id, { data: input([{ workId: "w1", title: "First", author: "A" }, { workId: "w2", title: "Second", author: "A" }]) });
  assert.deepEqual(outcome, { ok: false, reason: "duplicate-work", title: "Second" });
  assert.deepEqual((service.getQuiz("u1", draft.id)!.data as { books: unknown[] }).books, []);
});

test("an update of a published quiz is not-found", () => {
  const { service, quizId } = makeService();
  assert.ok(service.publishQuiz("u1", quizId).ok);
  assert.deepEqual(service.updateQuiz("u1", quizId, { name: "Renamed" }), { ok: false, reason: "not-found", error: "No quiz with that id." });
  assert.equal(service.getQuiz("u1", quizId)!.name, "My quiz");
});

test("a name-only update returns the canonical map of the stored books", () => {
  const { repo, quizId } = makeService();
  const service = createQuizzesService(repo, fakeWorks({ aliases: { b1: "b0" } }));
  const outcome = service.updateQuiz("u1", quizId, { name: "Renamed" });
  assert.ok(outcome.ok);
  if (!outcome.ok) return;
  assert.equal(outcome.quiz.name, "Renamed");
  assert.equal(outcome.canonical.get("b1"), "b0");
  assert.equal(outcome.canonical.get("b2"), "b2");
});

test("publish refuses another user's quiz and a second publish", () => {
  const { service, quizId } = makeService();
  const byOther = service.publishQuiz("u2", quizId);
  assert.equal(byOther.ok, false);
  if (!byOther.ok) assert.equal(byOther.reason, "not-found");
  assert.ok(service.publishQuiz("u1", quizId).ok);
  const again = service.publishQuiz("u1", quizId);
  assert.equal(again.ok, false);
  if (!again.ok) assert.equal(again.reason, "already-published");
});

test("publish rejects too few books", () => {
  const { service } = makeService();
  const few = created(service.createQuiz("u1", "Few", {
    sourceLabel: "",
    questionCount: 10,
    allowedTypes: ["cover_title"],
    books: Array.from({ length: 3 }, (_, i) => book(`f${i}`))
  }));
  const outcome = service.publishQuiz("u1", few.id);
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.equal(outcome.reason, "invalid");
    assert.match(outcome.error, /at least 4 books/i);
  }
});

test("getPlayBoard strips the answer key and carries the prompt", () => {
  const { service, quizId } = makeService();
  const published = service.publishQuiz("u1", quizId);
  assert.ok(published.ok);
  const board = service.getPlayBoard(published.ok ? published.quiz.voteCode! : "");
  assert.ok(board);
  assert.equal(board!.questions.length, 3);
  for (const q of board!.questions) {
    assert.equal("answerIndex" in q, false);
    assert.ok(q.prompt.length > 0);
    assert.equal(q.options.length, 4);
  }
});

test("submitPlay grades server-side and locks one play per player", () => {
  const { service, quizId } = makeService();
  const published = service.publishQuiz("u1", quizId);
  assert.ok(published.ok);
  const code = published.ok ? published.quiz.voteCode! : "";
  const board = service.getPlayBoard(code)!;
  const key = (service.getQuiz("u1", quizId)!.data as { questions: Array<{ id: string; answerIndex: number }> }).questions;
  const answers = board.questions.map((q) => ({ questionId: q.id, choiceIndex: key.find((k) => k.id === q.id)!.answerIndex }));
  const first = service.submitPlay(code, answers, 20000, "Alice", { kind: "user", userId: "u9" });
  assert.equal(first.ok, true);
  if (first.ok) assert.equal(first.score, board.questions.length);
  const second = service.submitPlay(code, answers, 20000, "Alice", { kind: "user", userId: "u9" });
  assert.equal(second.ok, false);
  if (!second.ok) assert.equal(second.reason, "already-played");
});

test("submitPlay rejects wrong-shaped answers and closed quizzes", () => {
  const { service, quizId } = makeService();
  const published = service.publishQuiz("u1", quizId);
  assert.ok(published.ok);
  const code = published.ok ? published.quiz.voteCode! : "";
  const short = service.submitPlay(code, [{ questionId: "q0", choiceIndex: 0 }], 1, null, { kind: "anonymous", playId: null });
  assert.equal(short.ok, false);
  if (!short.ok) assert.equal(short.reason, "invalid");
  const unknownQuestion = service.submitPlay(code, [{ questionId: "zz", choiceIndex: 0 }, { questionId: "q0", choiceIndex: 0 }, { questionId: "q1", choiceIndex: 0 }], 1, null, { kind: "anonymous", playId: null });
  assert.equal(unknownQuestion.ok, false);
  if (!unknownQuestion.ok) assert.equal(unknownQuestion.reason, "invalid");
  service.setPlayState("u1", quizId, false);
  const closed = service.submitPlay(code, [{ questionId: "q0", choiceIndex: 0 }, { questionId: "q1", choiceIndex: 0 }, { questionId: "q2", choiceIndex: 0 }], 1, null, { kind: "anonymous", playId: null });
  assert.equal(closed.ok, false);
  if (!closed.ok) assert.equal(closed.reason, "closed");
});

test("anonymous players recover their play by the id handle", () => {
  const { service, quizId } = makeService();
  const published = service.publishQuiz("u1", quizId);
  assert.ok(published.ok);
  const code = published.ok ? published.quiz.voteCode! : "";
  const board = service.getPlayBoard(code)!;
  const answers = board.questions.map((q) => ({ questionId: q.id, choiceIndex: 0 }));
  const play = service.submitPlay(code, answers, 1000, null, { kind: "anonymous", playId: null });
  assert.ok(play.ok);
  const recovered = service.getPlay(code, { kind: "anonymous", playId: play.ok ? play.playId : null });
  assert.equal(recovered.ok, true);
  assert.equal(service.getPlay(code, { kind: "anonymous", playId: "nope" }).ok, false);
});

test("results order plays score-then-speed and include per-question stats", () => {
  const { service, quizId } = makeService();
  const published = service.publishQuiz("u1", quizId);
  assert.ok(published.ok);
  const code = published.ok ? published.quiz.voteCode! : "";
  const board = service.getPlayBoard(code)!;
  const answers = board.questions.map((q) => ({ questionId: q.id, choiceIndex: 0 }));
  service.submitPlay(code, answers, 9000, "Slow", { kind: "anonymous", playId: null });
  service.submitPlay(code, answers, 1000, "Fast", { kind: "anonymous", playId: null });
  const results = service.getResults("u1", quizId);
  assert.ok(results);
  assert.deepEqual(results!.plays.map((p) => p.playerName), ["Fast", "Slow"]);
  assert.ok(results!.stats.length > 0);
  assert.equal(results!.questionCount, 3);
});

test("the play board looks each question's book up by its stored work", () => {
  const { service, quizId } = makeService();
  const published = service.publishQuiz("u1", quizId);
  assert.ok(published.ok);
  const code = published.ok ? published.quiz.voteCode! : "";
  const stored = service.getQuiz("u1", quizId)!.data as { books: QuizBook[]; questions: Array<{ id: string; type: string; workId: string }> };
  const board = service.getPlayBoard(code)!;
  for (const question of board.questions) {
    const source = stored.questions.find((q) => q.id === question.id)!;
    const owner = stored.books.find((b) => b.workId === source.workId)!;
    const expected = { cover_title: owner.coverUrl, title_cover: owner.title, quote_title: owner.quote, blurb_title: owner.blurb }[source.type];
    assert.equal(question.prompt, expected);
  }
});

function makeEmittingService() {
  const published: Array<[string, string]> = [];
  const played: Array<[string, string, string]> = [];
  const repo = createInMemoryRepo();
  const service = createQuizzesService(
    repo,
    fakeWorks(),
    (quizId, ownerUserId) => published.push([quizId, ownerUserId]),
    (playerUserId, quizId, quizName) => played.push([playerUserId, quizId, quizName])
  );
  const made = created(service.createQuiz("u1", "My quiz", {
    sourceLabel: "Shelf",
    questionCount: 3,
    allowedTypes: ["cover_title", "title_cover", "quote_title", "blurb_title"],
    books: Array.from({ length: 6 }, (_, i) => book(`b${i}`))
  }));
  return { service, published, played, quizId: made.id };
}

function answerFirst(service: ReturnType<typeof createQuizzesService>, code: string) {
  return service.getPlayBoard(code)!.questions.map((q) => ({ questionId: q.id, choiceIndex: 0 }));
}

test("publish emits exactly once with the quiz and its owner, and a second publish emits nothing", () => {
  const { service, published, quizId } = makeEmittingService();
  assert.ok(service.publishQuiz("u1", quizId).ok);
  assert.deepEqual(published, [[quizId, "u1"]]);
  assert.equal(service.publishQuiz("u1", quizId).ok, false);
  assert.deepEqual(published, [[quizId, "u1"]]);
});

test("a refused publish emits nothing", () => {
  const { service, published, quizId } = makeEmittingService();
  assert.equal(service.publishQuiz("u2", quizId).ok, false);
  const few = created(service.createQuiz("u1", "Few", { sourceLabel: "", questionCount: 10, allowedTypes: ["cover_title"], books: [book("f0")] }));
  assert.equal(service.publishQuiz("u1", few.id).ok, false);
  assert.deepEqual(published, []);
});

test("a signed-in play emits once with the player, quiz and name, and the owner's own play emits too", () => {
  const { service, played, quizId } = makeEmittingService();
  const outcome = service.publishQuiz("u1", quizId);
  assert.ok(outcome.ok);
  const code = outcome.ok ? outcome.quiz.voteCode! : "";
  const answers = answerFirst(service, code);
  assert.ok(service.submitPlay(code, answers, 1000, "Bob", { kind: "user", userId: "u9" }).ok);
  assert.deepEqual(played, [["u9", quizId, "My quiz"]]);
  assert.equal(service.submitPlay(code, answers, 1000, "Bob", { kind: "user", userId: "u9" }).ok, false);
  assert.equal(played.length, 1);
  assert.ok(service.submitPlay(code, answers, 1000, "Owner", { kind: "user", userId: "u1" }).ok);
  assert.deepEqual(played[1], ["u1", quizId, "My quiz"]);
});

test("an anonymous play and a play on a closed quiz emit nothing", () => {
  const { service, played, quizId } = makeEmittingService();
  const outcome = service.publishQuiz("u1", quizId);
  assert.ok(outcome.ok);
  const code = outcome.ok ? outcome.quiz.voteCode! : "";
  const answers = answerFirst(service, code);
  assert.ok(service.submitPlay(code, answers, 1000, null, { kind: "anonymous", playId: null }).ok);
  service.setPlayState("u1", quizId, false);
  assert.equal(service.submitPlay(code, answers, 1000, "Bob", { kind: "user", userId: "u9" }).ok, false);
  assert.deepEqual(played, []);
});

function publishedFixture() {
  const repo = createInMemoryRepo();
  const service = createQuizzesService(repo, fakeWorks());
  const make = (owner: string, name: string, books: QuizBook[], questionCount = 3) => {
    const made = created(service.createQuiz(owner, name, { sourceLabel: "", questionCount, allowedTypes: ["title_cover"], books }));
    const outcome = service.publishQuiz(owner, made.id);
    assert.ok(outcome.ok);
    return made.id;
  };
  return { repo, service, make };
}

test("published refs carry counts, play state and the first three non-empty covers", () => {
  const { service, make } = publishedFixture();
  const books = [book("c0", { coverUrl: null }), book("c1"), book("c2", { coverUrl: "" }), book("c3"), book("c4"), book("c5")];
  const id = make("u1", "Covers", books, 2);
  const code = service.getQuiz("u1", id)!.voteCode!;
  service.submitPlay(code, answerFirst(service, code), 1000, "A", { kind: "anonymous", playId: null });
  service.submitPlay(code, answerFirst(service, code), 1000, "B", { kind: "user", userId: "u9" });
  service.setPlayState("u1", id, false);

  const ref = createQuizzesPublicApi(service).getPublished(id);
  assert.deepEqual(ref, {
    id,
    ownerUserId: "u1",
    createdAt: service.getQuiz("u1", id)!.createdAt,
    voteCode: code,
    name: "Covers",
    questionCount: 2,
    playCount: 2,
    playOpen: false,
    covers: ["https://covers.test/c1.jpg", "https://covers.test/c3.jpg", "https://covers.test/c4.jpg"],
    preview: { type: "title_cover", prompt: service.getPlayBoard(code)!.questions[0]!.prompt }
  });
});

test("the public reads return only published quizzes", () => {
  const { service, make } = publishedFixture();
  const six = Array.from({ length: 6 }, (_, i) => book(`b${i}`));
  const first = make("u1", "First", six);
  const second = make("u1", "Second", six);
  const other = make("u2", "Other", six);
  const draft = created(service.createQuiz("u1", "Draft", { sourceLabel: "", questionCount: 3, allowedTypes: ["title_cover"], books: six }));
  const api = createQuizzesPublicApi(service);

  assert.equal(api.getPublished(draft.id), undefined);
  assert.equal(api.getPublished("ghost"), undefined);
  assert.deepEqual(api.listPublishedByOwner("u1").map((r) => r.id).sort(), [first, second].sort());
  assert.deepEqual(api.getPublishedMany([first, draft.id, other, "ghost"]).map((r) => r.id).sort(), [first, other].sort());
  assert.deepEqual(api.getPublishedMany([]), []);
});

test("discoverWindow filters by normalized name and returns id, createdAt and owner only", () => {
  const { service, make } = publishedFixture();
  const six = Array.from({ length: 6 }, (_, i) => book(`b${i}`));
  const habits = make("u1", "Hábitos Atómicos", six);
  make("u2", "Fantasy", six);
  const api = createQuizzesPublicApi(service);

  assert.deepEqual(api.discoverWindow("habitos", 10), [{ id: habits, createdAt: service.getQuiz("u1", habits)!.createdAt, ownerUserId: "u1" }]);
  assert.equal(api.discoverWindow("", 10).length, 2);
  assert.equal(api.discoverWindow("", 1).length, 1);
  assert.deepEqual(api.discoverWindow("nothing like it", 10), []);
});

test("votedAmong lists the published quizzes the viewer has played", () => {
  const { service, make } = publishedFixture();
  const six = Array.from({ length: 6 }, (_, i) => book(`b${i}`));
  const played = make("u1", "Played", six);
  const unplayed = make("u1", "Unplayed", six);
  const code = service.getQuiz("u1", played)!.voteCode!;
  service.submitPlay(code, answerFirst(service, code), 1000, null, { kind: "user", userId: "u9" });
  const api = createQuizzesPublicApi(service);

  assert.deepEqual(api.votedAmong("u9", [played, unplayed]), [played]);
  assert.deepEqual(api.votedAmong("u8", [played, unplayed]), []);
});
