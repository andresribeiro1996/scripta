import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "bnp-removal-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("../adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("../adapters/sqlite/sqliteBooksRepository.js");
const { planBnpRemoval, readRemovalHolds, removeBnpBooks, REMOVAL_CHUNK } = await import("./bnpRemoval.js");

const NOW = "2026-10-29T00:00:00.000Z";

function setup() {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  return createSqliteBooksRepository(db);
}

function holdsDbs() {
  const library = new DatabaseSync(":memory:");
  library.exec("CREATE TABLE library_books (work_id TEXT, isbn TEXT, book_key TEXT NOT NULL)");
  const games = {
    tierlists: new DatabaseSync(":memory:"),
    arena: new DatabaseSync(":memory:"),
    quizzes: new DatabaseSync(":memory:"),
    murals: new DatabaseSync(":memory:")
  };
  games.tierlists.exec("CREATE TABLE tierlist_works (work_id TEXT); CREATE TABLE tierlist_ballot_placements (work_id TEXT)");
  games.arena.exec("CREATE TABLE tournament_slots (work_id TEXT); CREATE TABLE duels (book_a_work_id TEXT, book_b_work_id TEXT)");
  games.quizzes.exec("CREATE TABLE quiz_works (work_id TEXT)");
  games.murals.exec("CREATE TABLE mural_works (work_id TEXT)");
  return { library, games };
}

const add = (repo: ReturnType<typeof setup>, title: string, isbn: string, publisher: string, createdBy: "bnp" | null = "bnp") =>
  repo.createBook({ title, author: "Autor", isbn, publisher, ...(createdBy ? { createdBy } : {}) }, [`isbn:${isbn}`], NOW);

test("only institutional bnp books are selected, and anything a reader or game holds is kept", () => {
  const repo = setup();
  const free = add(repo, "Livre", "9789720000001", "Câmara Municipal de Tavira");
  const byWork = add(repo, "Por obra", "9789720000002", "Universidade de Coimbra");
  add(repo, "Por isbn", "9789720000003", "Museu do Fado");
  add(repo, "Por chave", "9789720000004", "Museu do Fado");
  const byGame = add(repo, "Por jogo", "9789720000005", "Museu do Fado");
  const byDuel = add(repo, "Por duelo", "9789720000006", "Museu do Fado");
  add(repo, "Editora normal", "9789720000007", "Porto Editora");
  add(repo, "Outra origem", "9789720000008", "Câmara Municipal de Tavira", null);
  const { library, games } = holdsDbs();
  library.prepare("INSERT INTO library_books VALUES (?, NULL, 'a')").run(byWork.work_id);
  library.prepare("INSERT INTO library_books VALUES (NULL, '978-972-000-0003', 'b')").run();
  library.prepare("INSERT INTO library_books VALUES (NULL, NULL, 'isbn:9789720000004')").run();
  games.quizzes.prepare("INSERT INTO quiz_works VALUES (?)").run(byGame.work_id);
  games.arena.prepare("INSERT INTO duels VALUES (NULL, ?)").run(byDuel.work_id);
  const plan = planBnpRemoval(repo, readRemovalHolds(library, games));
  assert.equal(plan.selected, 6);
  assert.deepEqual(plan.removable, [free.id]);
  assert.deepEqual(plan.kept, { workHeld: 3, isbnHeld: 1, keyHeld: 1 });
  assert.deepEqual(plan.byPublisher, [{ publisher: "Câmara Municipal de Tavira", books: 1 }]);
  assert.deepEqual(plan.samples, [{ title: "Livre", publisher: "Câmara Municipal de Tavira", isbn: "9789720000001" }]);
});

test("a book is kept when a work merged into or from its work is held", () => {
  const repo = setup();
  const alias = add(repo, "Alias", "9789720000011", "Museu do Fado");
  const target = repo.createBook({ title: "Alvo", author: "Autor", isbn: "9789720000012" }, ["isbn:9789720000012"], NOW);
  repo.mergeTranslation(alias.work_id!, target.work_id!, "manual", null, NOW);
  const { library, games } = holdsDbs();
  library.prepare("INSERT INTO library_books VALUES (?, NULL, 'a')").run(target.work_id);
  assert.deepEqual(planBnpRemoval(repo, readRemovalHolds(library, games)).kept, { workHeld: 1, isbnHeld: 0, keyHeld: 0 });
});

test("removal runs in chunks, pauses between them, deletes both objects per cover and counts failures", async () => {
  const repo = setup();
  const ids = Array.from({ length: REMOVAL_CHUNK + 1 }, (_, i) => add(repo, `Livro ${i}`, `97897200${String(i).padStart(5, "0")}`, "Museu do Fado").id);
  repo.insertImage({ id: "cover-a", book_id: ids[0]!, source: "bnp", source_url: null, width: 900, height: 1400, byte_size: 1, color: "", created_at: NOW });
  const deleted: string[] = [];
  const pauses: number[] = [];
  const report = await removeBnpBooks(
    {
      repo,
      deleteObject: async (key) => {
        if (key.endsWith("-thumb.webp")) throw new Error("denied");
        deleted.push(key);
      },
      pause: async (ms) => void pauses.push(ms),
      log: () => {}
    },
    ids
  );
  assert.deepEqual(report, { removed: REMOVAL_CHUNK + 1, worksRemoved: REMOVAL_CHUNK + 1, coversDeleted: 1, coverDeleteFailures: 1 });
  assert.deepEqual(deleted, ["covers/cover-a.webp"]);
  assert.equal(pauses.length, 1);
  assert.equal(repo.bnpPublisherBooks().length, 0);
});
