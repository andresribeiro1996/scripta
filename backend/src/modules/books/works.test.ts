import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { BooksRepository } from "./domain/ports.js";

const scratch = mkdtempSync(join(tmpdir(), "books-works-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("./adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("./adapters/sqlite/sqliteBooksRepository.js");
const { resolveWorksWith, canonicalWorksWith, getWorkPageWith, getRecentAwardsWith, ANNOUNCE_DAYS, matchWorksWith, catalogGenresWith } = await import("./works.js");
const { summaryHashOf } = await import("./domain/synopsis.js");

function freshRepo() {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  return { db, repo: createSqliteBooksRepository(db) };
}

test("resolveWorks creates an edition and returns its work, then finds it again", () => {
  const { repo, db } = freshRepo();
  const [first] = resolveWorksWith(repo, [{ isbn: "9780441013593", title: "Dune", author: "Frank Herbert" }]);
  const [again] = resolveWorksWith(repo, [{ isbn: "0441013597", title: "Dune", author: "Frank Herbert" }]);
  assert.ok(first);
  assert.equal(again, first);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM books").get() as { n: number }).n, 1);
});

test("resolveWorks returns null for a lookup with neither ISBN nor title", () => {
  const { repo } = freshRepo();
  assert.deepEqual(resolveWorksWith(repo, [{ isbn: null, title: "", author: "Someone" }]), [null]);
});

test("resolveWorks and canonicalWorks follow merged_into", () => {
  const { repo, db } = freshRepo();
  const [lone] = resolveWorksWith(repo, [{ title: "Hábitos Atômicos", author: "James Clear" }]);
  assert.ok(lone);
  const keyed = repo.createBook({ title: "Atomic Habits", author: "James Clear", isbn: "9780735211292", workKey: "OL17930368W" }, ["isbn:9780735211292"], "2026-10-04T00:00:00.000Z");
  db.prepare("UPDATE works SET merged_into = ? WHERE id = ?").run(keyed.work_id, lone);
  assert.deepEqual(resolveWorksWith(repo, [{ title: "Hábitos Atômicos", author: "James Clear" }]), [keyed.work_id]);
  assert.equal(canonicalWorksWith(repo, [lone]).get(lone), keyed.work_id);
  assert.equal(canonicalWorksWith(repo, [keyed.work_id!]).get(keyed.work_id!), keyed.work_id);
});

test("resolveWorks gives an existing edition without a work its work", () => {
  const { repo, db } = freshRepo();
  const book = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593" }, ["isbn:9780441013593"], "2026-10-04T00:00:00.000Z");
  db.prepare("UPDATE books SET work_id = NULL WHERE id = ?").run(book.id);
  const [id] = resolveWorksWith(repo, [{ isbn: "9780441013593", title: "Dune", author: "Frank Herbert" }]);
  assert.ok(id);
  assert.equal((db.prepare("SELECT work_id FROM books WHERE id = ?").get(book.id) as { work_id: string }).work_id, id);
});

test("resolveWorks resolves 2,000 new books in one transaction quickly", () => {
  const { repo } = freshRepo();
  const lookups = Array.from({ length: 2000 }, (_, i) => ({ title: `Book ${i}`, author: `Author ${i}` }));
  const started = performance.now();
  const ids = resolveWorksWith(repo, lookups);
  assert.equal(ids.filter(Boolean).length, 2000);
  assert.ok(performance.now() - started < 3000, `took ${performance.now() - started} ms`);
});

test("a work page lists the canonical work, its editions and every alias, and an old id resolves to it", () => {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  const repo = createSqliteBooksRepository(db);
  const [kept] = resolveWorksWith(repo, [{ isbn: "9780441013593", title: "Dune", author: "Frank Herbert" }]);
  const [gone] = resolveWorksWith(repo, [{ isbn: null, title: "Duna", author: "Frank Herbert" }]);
  db.prepare("UPDATE books SET summary = 'Spice.', language = 'en', year = 1965 WHERE work_id = ?").run(kept!);
  repo.mergeWorks(gone!, kept!);
  const page = getWorkPageWith(repo, (imageId) => `cover:${imageId}`, gone!);
  assert.equal(page!.id, kept);
  assert.deepEqual(new Set(page!.aliasIds), new Set([kept, gone]));
  assert.equal(page!.editions.length, 2);
  assert.equal(page!.editions.find((e) => e.isbn === "9780441013593")!.summary, "Spice.");
  assert.equal(getWorkPageWith(repo, () => "x", "not-a-work"), undefined);
});

test("a work page answers works.summary, from the canonical work even through a merged-away id", () => {
  const { db, repo } = freshRepo();
  const [kept] = resolveWorksWith(repo, [{ isbn: "9780441013593", title: "Dune", author: "Frank Herbert" }]);
  const [gone] = resolveWorksWith(repo, [{ isbn: null, title: "Duna", author: "Frank Herbert" }]);
  assert.equal(getWorkPageWith(repo, () => "x", kept!)!.summary, null);
  db.prepare("UPDATE works SET summary = ? WHERE id = ?").run("Spice.", kept!);
  repo.mergeWorks(gone!, kept!);
  assert.equal(getWorkPageWith(repo, () => "x", kept!)!.summary, "Spice.");
  assert.equal(getWorkPageWith(repo, () => "x", gone!)!.summary, "Spice.");
  db.prepare("UPDATE works SET summary = '  ' WHERE id = ?").run(kept!);
  assert.equal(getWorkPageWith(repo, () => "x", kept!)!.summary, null);
});

test("a keyless work with no summary or cover answers nulls", () => {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  const repo = createSqliteBooksRepository(db);
  const [id] = resolveWorksWith(repo, [{ isbn: null, title: "Quiet Book", author: "Nobody" }]);
  const page = getWorkPageWith(repo, () => "never", id!)!;
  assert.deepEqual(page.editions.map((e) => [e.summary, e.coverUrl]), [[null, null]]);
});

test("a work page edition carries the colour of its cover image, empty and missing as null", () => {
  const { db, repo } = freshRepo();
  const [work] = resolveWorksWith(repo, [
    { isbn: "9780441013593", title: "Dune", author: "Frank Herbert" },
    { isbn: "9788576573135", title: "Duna", author: "Frank Herbert" },
    { isbn: "9780441172719", title: "Dune Messiah", author: "Frank Herbert" }
  ]);
  const ids = (db.prepare("SELECT id FROM books ORDER BY rowid").all() as Array<{ id: string }>).map((row) => row.id);
  db.prepare("UPDATE books SET work_id = ? WHERE work_id IS NOT ?").run(work!, work!);
  const now = new Date().toISOString();
  repo.insertImage({ id: "tinted", book_id: ids[0]!, source: "apple", source_url: null, width: 900, height: 1400, byte_size: 10, color: "#e0a82e", created_at: now });
  repo.insertImage({ id: "plain", book_id: ids[1]!, source: "apple", source_url: null, width: 900, height: 1400, byte_size: 10, color: "", created_at: now });
  repo.setCover(ids[0]!, { imageId: "tinted", status: "good", checkedAt: now });
  repo.setCover(ids[1]!, { imageId: "plain", status: "good", checkedAt: now });
  const editions = getWorkPageWith(repo, (imageId) => `cover:${imageId}`, work!)!.editions;
  assert.deepEqual(editions.map((e) => [e.coverUrl, e.coverColor]), [["cover:tinted", "#e0a82e"], ["cover:plain", null], [null, null]]);
});

test("a work page edition carries normalised genres, rating and pages", () => {
  const { db, repo } = freshRepo();
  const [work] = resolveWorksWith(repo, [{ isbn: "9780441013593", title: "Dune", author: "Frank Herbert" }]);
  db.prepare("UPDATE books SET genres = ?, rating = 4.25, rating_count = 120, pages = 412 WHERE work_id = ?").run(JSON.stringify(["Science Fiction", "Space opera"]), work!);
  const [edition] = getWorkPageWith(repo, () => "x", work!)!.editions;
  assert.deepEqual(edition!.genres, ["Science Fiction"]);
  assert.equal(edition!.rating, 4.25);
  assert.equal(edition!.ratingCount, 120);
  assert.equal(edition!.pages, 412);
});

test("matchWorks returns the best matching works and the works merged into them", () => {
  const { repo, db } = freshRepo();
  const at = "2026-10-04T00:00:00.000Z";
  const dune = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593", createdBy: "seed" }, ["isbn:9780441013593"], at);
  const older = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780593099322", createdBy: "seed" }, ["isbn:9780593099322"], at);
  repo.createBook({ title: "Orlando", author: "Virginia Woolf", isbn: "9780141184272", createdBy: "seed" }, ["isbn:9780141184272"], at);
  db.prepare("UPDATE works SET merged_into = ? WHERE id = ?").run(dune.work_id, older.work_id);
  assert.deepEqual(matchWorksWith(repo, "dun", 20), [dune.work_id, older.work_id]);
  assert.deepEqual(matchWorksWith(repo, "zzz", 20), []);
  assert.deepEqual(matchWorksWith(repo, "", 20), []);
});

test("catalog genres rank each work's editions and split Jev guesses below the confident line", () => {
  const { db, repo } = freshRepo();
  const [dune, orlando, blank] = resolveWorksWith(repo, [
    { isbn: "9780441013593", title: "Dune", author: "Frank Herbert" },
    { isbn: null, title: "Orlando", author: "Virginia Woolf" },
    { isbn: null, title: "Blank", author: "Nobody" }
  ]);
  db.prepare("UPDATE books SET genres = ? WHERE work_id = ?").run(JSON.stringify(["Science Fiction"]), dune!);
  db.prepare("UPDATE books SET genres = ?, genres_source = 'jev', genres_confidence = 0.6 WHERE work_id = ?").run(JSON.stringify(["Biography & Memoir"]), orlando!);
  const genres = catalogGenresWith(repo, [dune!, orlando!, blank!]);
  assert.deepEqual(genres.get(dune!), { genres: ["Science Fiction"], possibleGenres: [] });
  assert.deepEqual(genres.get(orlando!), { genres: [], possibleGenres: ["Biography & Memoir"] });
  assert.equal(genres.has(blank!), false);
  assert.deepEqual(catalogGenresWith(repo, []), new Map());
});

test("a work page marks Jev editions below the confident line as possible", () => {
  const { db, repo } = freshRepo();
  const [work] = resolveWorksWith(repo, [{ isbn: null, title: "Orlando", author: "Virginia Woolf" }]);
  db.prepare("UPDATE books SET genres = ?, genres_source = 'jev', genres_confidence = 0.6 WHERE work_id = ?").run(JSON.stringify(["Biography & Memoir"]), work!);
  assert.equal(getWorkPageWith(repo, () => "x", work!)!.editions[0]!.possible, true);
  db.prepare("UPDATE books SET genres_confidence = 0.9 WHERE work_id = ?").run(work!);
  assert.equal(getWorkPageWith(repo, () => "x", work!)!.editions[0]!.possible, false);
});

test("the genre source columns are added to an existing database once", () => {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  db.exec("ALTER TABLE books DROP COLUMN genres_source");
  db.exec("ALTER TABLE books DROP COLUMN genres_confidence");
  applyBooksMigrations(db);
  applyBooksMigrations(db);
  const names = (db.prepare("PRAGMA table_info(books)").all() as Array<{ name: string }>).map((column) => column.name);
  assert.ok(names.includes("genres_source"));
  assert.ok(names.includes("genres_confidence"));
});

test("getWorkPage leaves out hidden summaries and keeps the rest", () => {
  const { repo } = freshRepo();
  const at = "2026-10-01T00:00:00.000Z";
  const book = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593", workKey: "OL1W" }, ["isbn:9780441013593"], at);
  repo.mergeDetails(book.id, { summary: "Praise, praise, praise.", pages: null, year: null, publisher: null, translator: null }, "publisher");
  repo.setWorkSummary(book.id, "Spice must flow.");
  const judge = (text: string, usable: number) => repo.saveSynopsisJudgment(summaryHashOf(text)!, { model: "jev-1.13.0", usable, kind: "praise", askedAt: at });
  judge("Praise, praise, praise.", 0.1);
  judge("Spice must flow.", 0.9);
  const page = getWorkPageWith(repo, (id) => id, book.work_id!)!;
  assert.equal(page.summary, "Spice must flow.");
  assert.equal(page.editions[0]!.summary, null);
  judge("Spice must flow.", 0.1);
  assert.equal(getWorkPageWith(repo, (id) => id, book.work_id!)!.summary, null);
});

test("a work page carries the work's best series and each edition's collection, also through a merged-away id", () => {
  const { repo } = freshRepo();
  const at = "2026-10-20T00:00:00.000Z";
  const first = repo.createBook({ title: "Gardens of the Moon", author: "Steven Erikson", isbn: "9780765348807", workKey: "OL1W" }, ["isbn:9780765348807"], at);
  repo.createBook({ title: "Gardens of the Moon", author: "Steven Erikson", isbn: "9780765348999", workKey: "OL1W" }, ["isbn:9780765348999"], at);
  const alias = repo.createBook({ title: "Jardins da Lua", author: "Steven Erikson", isbn: "9789720000401" }, ["isbn:9789720000401"], at);
  repo.addWorkSeries(first.work_id!, [{ name: "Malazan Book of the Fallen", position: "1" }], "wikidata", at);
  repo.addBookCollection(first.id, { name: "Bang!", position: "248" }, "bnp", at);
  repo.addWorkSeries(alias.work_id!, [{ name: "Malazan Book of the Fallen", position: "1" }], "ol-subject", at);
  const page = getWorkPageWith(repo, () => "x", first.work_id!)!;
  assert.deepEqual(page.series, { name: "Malazan Book of the Fallen", position: "1" });
  assert.deepEqual(page.editions.map((e) => e.collection), [{ name: "Bang!", position: "248" }, null]);
  repo.mergeTranslation(alias.work_id!, first.work_id!, "manual", null, at);
  assert.deepEqual(getWorkPageWith(repo, () => "x", alias.work_id!)!.series, { name: "Malazan Book of the Fallen", position: "1" });
});

test("a work page without a series or a collection answers null for both", () => {
  const { repo } = freshRepo();
  const [id] = resolveWorksWith(repo, [{ isbn: "9780441013593", title: "Dune", author: "Frank Herbert" }]);
  const page = getWorkPageWith(repo, () => "x", id!)!;
  assert.equal(page.series, null);
  assert.deepEqual(page.editions.map((e) => e.collection), [null]);
});

const AWARDS_NOW = new Date("2026-10-25T12:00:00.000Z");
const daysAgo = (days: number) => new Date(AWARDS_NOW.getTime() - days * 86_400_000).toISOString();
const awardOf = (workId: string, prize: string, year: number, won: boolean, honoree: string | null = null) => ({ workId, prize, year, won, honoree });

function awardedBook(repo: ReturnType<typeof freshRepo>["repo"], title: string, author: string, isbn: string, workKey?: string) {
  return repo.createBook({ title, author, isbn, workKey }, [`isbn:${isbn}`], "2026-10-01T00:00:00.000Z");
}

test("getWorkPageWith includes the work's awards, wins first, newest first", () => {
  const { repo } = freshRepo();
  const dune = awardedBook(repo, "Dune", "Frank Herbert", "9780441013593");
  const quiet = awardedBook(repo, "Quiet Book", "Nobody", "9780441172719");
  repo.addWorkAward(awardOf(dune.work_id!, "booker", 2019, false), daysAgo(40));
  repo.addWorkAward(awardOf(dune.work_id!, "hugo-novel", 1966, true), daysAgo(40));
  repo.addWorkAward(awardOf(dune.work_id!, "pulitzer-fiction", 1999, true), daysAgo(40));
  repo.addWorkAward(awardOf(dune.work_id!, "goodreads-choice", 2020, true), daysAgo(40));
  assert.deepEqual(getWorkPageWith(repo, () => "x", dune.work_id!)!.awards, [
    { prize: "pulitzer-fiction", year: 1999, won: true },
    { prize: "hugo-novel", year: 1966, won: true },
    { prize: "booker", year: 2019, won: false }
  ]);
  assert.deepEqual(getWorkPageWith(repo, () => "x", quiet.work_id!)!.awards, []);
});

test("getRecentAwardsWith builds book-prize winners with title, author and the first edition cover", () => {
  const { repo } = freshRepo();
  const bare = awardedBook(repo, "Shuggie Bain", "Douglas Stuart", "9780802129703", "OL1W");
  const covered = awardedBook(repo, "Shuggie Bain", "Douglas Stuart", "9781529068801", "OL1W");
  const second = awardedBook(repo, "Girl, Woman, Other", "Bernardine Evaristo", "9780241984949", "OL2W");
  const nominee = awardedBook(repo, "Nominee", "Someone", "9780441172719", "OL3W");
  assert.equal(bare.work_id, covered.work_id);
  repo.insertImage({ id: "shuggie", book_id: covered.id, source: "apple", source_url: null, width: 900, height: 1400, byte_size: 10, color: "#aa0000", created_at: daysAgo(10) });
  repo.setCover(covered.id, { imageId: "shuggie", status: "good", checkedAt: daysAgo(10) });
  repo.addWorkAward(awardOf(bare.work_id!, "booker", 2026, true), daysAgo(3));
  repo.addWorkAward(awardOf(second.work_id!, "booker", 2026, true), daysAgo(3));
  repo.addWorkAward(awardOf(nominee.work_id!, "booker", 2026, false), daysAgo(40));
  assert.deepEqual(getRecentAwardsWith(repo, (imageId) => `cover:${imageId}`, AWARDS_NOW), [{
    prize: "booker",
    year: 2026,
    announcedAt: daysAgo(3),
    winners: [
      { workId: bare.work_id, title: "Shuggie Bain", author: "Douglas Stuart", coverUrl: "cover:shuggie" },
      { workId: second.work_id, title: "Girl, Woman, Other", author: "Bernardine Evaristo", coverUrl: null }
    ],
    nomineeWorkIds: [nominee.work_id],
    honoree: null
  }]);
});

test("getRecentAwardsWith gives an author prize its honoree and work ids and no winners", () => {
  const { repo } = freshRepo();
  const first = awardedBook(repo, "The Vegetarian", "Han Kang", "9780553448184");
  const second = awardedBook(repo, "Human Acts", "Han Kang", "9781101906118");
  const camoes = awardedBook(repo, "Sonetos", "Luís Vaz", "9789720000001");
  repo.addWorkAward(awardOf(first.work_id!, "nobel-literature", 2026, true, "Kang Han-gang"), daysAgo(1));
  repo.addWorkAward(awardOf(second.work_id!, "nobel-literature", 2026, true, "Kang Han-gang"), daysAgo(1));
  repo.addWorkAward(awardOf(camoes.work_id!, "camoes", 2026, true), daysAgo(2));
  assert.deepEqual(getRecentAwardsWith(repo, () => "x", AWARDS_NOW), [
    { prize: "nobel-literature", year: 2026, announcedAt: daysAgo(1), winners: [], nomineeWorkIds: [], honoree: { name: "Kang Han-gang", workIds: [first.work_id, second.work_id] } },
    { prize: "camoes", year: 2026, announcedAt: daysAgo(2), winners: [], nomineeWorkIds: [], honoree: { name: "Luís Vaz", workIds: [camoes.work_id] } }
  ]);
});

test("getRecentAwardsWith asks for the current UTC year and ANNOUNCE_DAYS back", () => {
  const calls: Array<[number, string]> = [];
  const books = { recentAwards: (year: number, since: string) => { calls.push([year, since]); return []; } } as unknown as BooksRepository;
  assert.deepEqual(getRecentAwardsWith(books, () => "x", new Date("2027-01-01T00:30:00+02:00")), []);
  assert.deepEqual(calls, [[2026, "2026-12-17T22:30:00.000Z"]]);
  assert.equal(ANNOUNCE_DAYS, 14);
});

test("getRecentAwardsWith breaks announcedAt ties in prize-list order", () => {
  const { repo } = freshRepo();
  const winner = awardedBook(repo, "Winner", "Someone", "9780441172719");
  for (const prize of ["ape-novel", "saramago", "booker"]) repo.addWorkAward(awardOf(winner.work_id!, prize, 2026, true), daysAgo(5));
  repo.addWorkAward(awardOf(winner.work_id!, "nebula-novel", 2026, true), daysAgo(1));
  assert.deepEqual(getRecentAwardsWith(repo, () => "x", AWARDS_NOW).map((announcement) => announcement.prize), ["nebula-novel", "booker", "saramago", "ape-novel"]);
});

test("getRecentAwardsWith skips unknown prizes, gone winners, and announcements left with nobody to show", () => {
  const { repo } = freshRepo();
  const winner = awardedBook(repo, "Winner", "Someone", "9780441172719");
  repo.addWorkAward(awardOf(winner.work_id!, "goodreads-choice", 2026, true), daysAgo(1));
  repo.addWorkAward(awardOf("gone-work", "hugo-novel", 2026, true), daysAgo(2));
  repo.addWorkAward(awardOf(winner.work_id!, "hugo-novel", 2026, true), daysAgo(2));
  repo.addWorkAward(awardOf("gone-work", "nebula-novel", 2026, true), daysAgo(3));
  repo.addWorkAward(awardOf("gone-work", "camoes", 2026, true), daysAgo(4));
  const announcements = getRecentAwardsWith(repo, () => "x", AWARDS_NOW);
  assert.deepEqual(announcements.map((announcement) => announcement.prize), ["hugo-novel"]);
  assert.deepEqual(announcements[0]!.winners.map((entry) => entry.workId), [winner.work_id]);
});
