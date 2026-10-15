import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "translation-judgments-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("./adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("./adapters/sqlite/sqliteBooksRepository.js");
const { planMatch } = await import("./translationJudgments.js");

type Repo = ReturnType<typeof createSqliteBooksRepository>;
const AT = "2026-10-15T12:00:00.000Z";

function freshRepo(): Repo {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  return createSqliteBooksRepository(db);
}

type Fields = { title: string; author: string; workKey?: string; language?: string; summary?: string; originalTitle?: string; year?: number };
function edition(repo: Repo, isbn: string, fields: Fields) {
  const book = repo.createBook({ title: fields.title, author: fields.author, isbn, workKey: fields.workKey, year: fields.year }, [`isbn:${isbn}`], AT);
  if (fields.language) repo.setLanguage(book.id, fields.language);
  if (fields.summary) repo.mergeDetails(book.id, { summary: fields.summary, pages: null, year: null, publisher: null, translator: null }, "publisher");
  if (fields.originalTitle) repo.fillOriginalTitle(book.id, fields.originalTitle);
  return repo.getBook(book.id)!;
}

test("a work whose original title is its own title is a Portuguese original", () => {
  const repo = freshRepo();
  const pt = edition(repo, "9789720000401", { title: "Memorial do Convento", author: "José Saramago", language: "pt-PT", originalTitle: "Memorial do Convento" });
  assert.deepEqual(planMatch(repo, pt.work_id!), { kind: "original" });
});

test("one title match whose author's surname the work names is settled by code", () => {
  const repo = freshRepo();
  const en = edition(repo, "9780156907401", { title: "To the Lighthouse", author: "Virginia Woolf", workKey: "OL930W" });
  const pt = edition(repo, "9789720000402", { title: "Passeio ao Farol", author: "V. Woolf", language: "pt-PT", originalTitle: "To the Lighthouse — A Novel" });
  assert.deepEqual(planMatch(repo, pt.work_id!), { kind: "code", intoWorkId: en.work_id });
});

test("a title match the work can't vouch for, or two of them, goes to Jev", () => {
  const repo = freshRepo();
  const en = edition(repo, "9780156907402", { title: "To the Lighthouse", author: "Virginia Woolf", workKey: "OL931W", year: 1927 });
  const pt = edition(repo, "9789720000403", { title: "Passeio ao Farol", author: "", language: "pt-PT", originalTitle: "To the Lighthouse", summary: "Uma família, uma casa, um farol ao longe e dez anos de distância." });
  const plan = planMatch(repo, pt.work_id!);
  assert.equal(plan?.kind, "ask");
  assert.deepEqual(plan?.kind === "ask" ? plan.candidates : null, [{ id: en.work_id, title: "To the Lighthouse", author: "Virginia Woolf", year: 1927 }]);

  edition(repo, "9780000000404", { title: "Poems", author: "Emily Dickinson", workKey: "OL932W" });
  edition(repo, "9780000000405", { title: "Poems", author: "John Keats", workKey: "OL933W" });
  const poems = edition(repo, "9789720000406", { title: "Poemas", author: "John Keats", language: "pt-PT", originalTitle: "Poems" });
  const both = planMatch(repo, poems.work_id!);
  assert.equal(both?.kind, "ask");
  assert.deepEqual(both?.kind === "ask" ? both.candidates.map((candidate) => candidate.author).sort() : null, ["Emily Dickinson", "John Keats"]);
});

test("with no original title, the author's works with a non-Portuguese edition are the candidates, most editions first", () => {
  const repo = freshRepo();
  const idiot = edition(repo, "9780000000407", { title: "The Idiot", author: "Fyodor Dostoevsky", workKey: "OL934W" });
  edition(repo, "9780000000408", { title: "The Idiot", author: "Fyodor Dostoevsky", workKey: "OL934W" });
  const crime = edition(repo, "9780000000409", { title: "Crime and Punishment", author: "Fyodor Dostoevsky", workKey: "OL935W" });
  edition(repo, "9789720000410", { title: "Os Irmãos Karamázov", author: "Fyodor Dostoevsky", language: "pt-PT" });
  const pt = edition(repo, "9789720000411", { title: "O Idiota", author: "Fyodor Dostoevsky", language: "pt-PT" });
  const plan = planMatch(repo, pt.work_id!);
  assert.deepEqual(plan?.kind === "ask" ? plan.candidates.map((candidate) => candidate.id) : plan, [idiot.work_id, crime.work_id]);
});

test("no original title and no author leaves nothing to ask", () => {
  const repo = freshRepo();
  const pt = edition(repo, "9789720000412", { title: "Livro Sem Autor", author: "", language: "pt-PT" });
  assert.deepEqual(planMatch(repo, pt.work_id!), { kind: "none" });
});

test("only live, all-Portuguese, unjudged works under the strike limit need a match", () => {
  const repo = freshRepo();
  const pt = edition(repo, "9789720000413", { title: "Um", author: "A", language: "pt-PT" });
  const mixed = edition(repo, "9789720000414", { title: "Dois", author: "A", language: "pt-PT", workKey: "OL936W" });
  edition(repo, "9780000000415", { title: "Two", author: "A", workKey: "OL936W" });
  const judged = edition(repo, "9789720000416", { title: "Três", author: "A", language: "pt-BR" });
  const struck = edition(repo, "9789720000417", { title: "Quatro", author: "A", language: "pt" });
  const old = edition(repo, "9789720000418", { title: "Cinco", author: "A", language: "pt-PT" });
  repo.saveWorkMatchJudgment(judged.work_id!, { model: "code", intoWorkId: null, confidence: null, askedAt: AT });
  repo.saveWorkMatchJudgment(old.work_id!, { model: "jev-1.13.0", intoWorkId: null, confidence: 0.8, askedAt: "2026-08-01T00:00:00.000Z" });
  for (let n = 0; n < 3; n++) repo.recordJevRejection({ task: "works", subject: struck.work_id!, status: 400, reason: "HTTP 400", at: AT });
  assert.deepEqual(repo.portugueseWorksNeedingMatch(null, 10, 3, null), [pt.work_id]);
  assert.deepEqual(repo.portugueseWorksNeedingMatch(null, 10, 3, "2026-09-15T00:00:00.000Z").sort(), [pt.work_id, old.work_id].sort());
  assert.deepEqual(repo.portugueseWorksNeedingMatch([mixed.work_id!, pt.work_id!], 10, 3, null), [pt.work_id]);
  assert.deepEqual(repo.workMatchJudgments([judged.work_id!]).get(judged.work_id!), { model: "code", intoWorkId: null, confidence: null, askedAt: AT });
});
