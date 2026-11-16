import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "books-repo-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("./connection.js");
const { createSqliteBooksRepository } = await import("./sqliteBooksRepository.js");
const { GROUPABLE_KEYS_SQL, KEYED_EDITIONS_SQL, KEYED_WORKS_SQL, KEYLESS_CANDIDATES_SQL } = await import("./sqliteWorkMerges.js");
const { WorkMergeError } = await import("../../domain/errors.js");
const { groupKeylessWorks } = await import("../../duplicateWorks.js");

const NOW = "2026-10-01T00:00:00.000Z";

function freshRepo() {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  return { db, repo: createSqliteBooksRepository(db) };
}

interface WorkRow {
  id: string;
  ol_work_key: string | null;
  title: string;
  author: string;
  merged_into: string | null;
  summary: string | null;
  created_at: string;
}

const countOf = (db: DatabaseSync, table: string, where = "1") => (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get() as { n: number }).n;
const workById = (db: DatabaseSync, id: string | null) => db.prepare("SELECT * FROM works WHERE id = ?").get(id) as unknown as WorkRow;
const DAY_MS = 24 * 60 * 60 * 1000;
const at = (days: number) => new Date(Date.parse(NOW) + days * DAY_MS).toISOString();
const edition = (repo: ReturnType<typeof createSqliteBooksRepository>, isbn: string, title: string, author: string, workKey?: string, created = NOW) =>
  repo.createBook({ title, author, isbn, workKey }, [`isbn:${isbn}`], created);

const titled = (repo: ReturnType<typeof freshRepo>["repo"], title: string) => repo.createBook({ title, author: "A", isbn: null }, [`ta:${title.toLowerCase()}|a|`], NOW);
const AT = "2026-10-15T12:00:00.000Z";
const mergeRows = (db: DatabaseSync) => (db.prepare("SELECT from_work, into_work, source, confidence, moved_book_ids, repointed_work_ids, merged_at, undone_at FROM work_merges ORDER BY id").all() as Array<Record<string, unknown>>).map((row) => ({ ...row }));

test("mergeWorks moves every edition into the target, leaves merged_into, and keeps chains one hop long", () => {
  const { db, repo } = freshRepo();
  const empty = repo.createBook({ title: "", author: "", isbn: "9789720000001" }, ["isbn:9789720000001"], NOW);
  const portuguese = repo.createBook({ title: "Ensaio sobre a Cegueira", author: "José Saramago", isbn: "9789720000002" }, ["isbn:9789720000002"], NOW);
  const english = repo.createBook({ title: "Blindness", author: "José Saramago", isbn: "9780156007757", workKey: "OL1W" }, ["isbn:9780156007757"], NOW);

  assert.equal(repo.mergeWorks(portuguese.work_id!, empty.work_id!), empty.work_id);
  assert.deepEqual([workById(db, empty.work_id).title, workById(db, empty.work_id).author], ["Ensaio sobre a Cegueira", "José Saramago"]);
  assert.equal(repo.getBook(portuguese.id)!.work_id, empty.work_id);
  assert.equal(workById(db, portuguese.work_id).merged_into, empty.work_id);

  assert.equal(repo.mergeWorks(empty.work_id!, english.work_id!), english.work_id);
  assert.deepEqual([empty.id, portuguese.id, english.id].map((id) => repo.getBook(id)!.work_id), [english.work_id, english.work_id, english.work_id]);
  assert.deepEqual([empty.work_id, portuguese.work_id].map((id) => workById(db, id).merged_into), [english.work_id, english.work_id]);
  assert.deepEqual(repo.canonicalWorkIds([empty.work_id!, portuguese.work_id!, english.work_id!]), new Map([[empty.work_id!, english.work_id!], [portuguese.work_id!, english.work_id!], [english.work_id!, english.work_id!]]));
  assert.equal(workById(db, english.work_id).title, "Blindness");
  assert.equal(repo.getBook(portuguese.id)!.ol_work_key, null);
});

test("mergeWorks resolves a merged target first", () => {
  const { repo } = freshRepo();
  const a = repo.createBook({ title: "A", author: "X", isbn: "9789720000001" }, ["isbn:9789720000001"], NOW);
  const b = repo.createBook({ title: "B", author: "X", isbn: "9789720000002" }, ["isbn:9789720000002"], NOW);
  const c = repo.createBook({ title: "C", author: "X", isbn: "9789720000003" }, ["isbn:9789720000003"], NOW);
  repo.mergeWorks(b.work_id!, a.work_id!);
  assert.equal(repo.mergeWorks(c.work_id!, b.work_id!), a.work_id);
  assert.equal(repo.getBook(c.id)!.work_id, a.work_id);
});

test("mergeWorks refuses an unknown, merged or keyed source, an unknown target and a merge into itself, and changes nothing", () => {
  const { db, repo } = freshRepo();
  const keyed = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593", workKey: "OL1W" }, ["isbn:9780441013593"], NOW);
  const a = repo.createBook({ title: "A", author: "X", isbn: "9789720000001" }, ["isbn:9789720000001"], NOW);
  const b = repo.createBook({ title: "B", author: "X", isbn: "9789720000002" }, ["isbn:9789720000002"], NOW);
  repo.mergeWorks(b.work_id!, a.work_id!);
  const snapshot = () => ({ works: db.prepare("SELECT * FROM works ORDER BY id").all(), books: db.prepare("SELECT id, work_id FROM books ORDER BY id").all() });
  const before = snapshot();
  assert.throws(() => repo.mergeWorks("no-such-work", a.work_id!), WorkMergeError);
  assert.throws(() => repo.mergeWorks(b.work_id!, keyed.work_id!), WorkMergeError);
  assert.throws(() => repo.mergeWorks(keyed.work_id!, a.work_id!), WorkMergeError);
  assert.throws(() => repo.mergeWorks(a.work_id!, "no-such-work"), WorkMergeError);
  assert.throws(() => repo.mergeWorks(a.work_id!, b.work_id!), WorkMergeError);
  assert.deepEqual(snapshot(), before);
});

test("a merge chain longer than one hop is refused rather than followed", () => {
  const { db, repo } = freshRepo();
  const a = repo.createBook({ title: "A", author: "X", isbn: "9789720000001" }, ["isbn:9789720000001"], NOW);
  const b = repo.createBook({ title: "B", author: "X", isbn: "9789720000002" }, ["isbn:9789720000002"], NOW);
  const c = repo.createBook({ title: "C", author: "X", isbn: "9789720000003" }, ["isbn:9789720000003"], NOW);
  assert.deepEqual(repo.canonicalWorkIds(["no-such-work", a.work_id!]), new Map([[a.work_id!, a.work_id!]]));
  assert.equal(repo.workPageRows("no-such-work"), undefined);
  db.prepare("UPDATE works SET merged_into = ? WHERE id = ?").run(b.work_id, a.work_id);
  db.prepare("UPDATE works SET merged_into = ? WHERE id = ?").run(c.work_id, b.work_id);
  assert.throws(() => repo.workPageRows(a.work_id!), /one hop/);
});

test("a keyless work joins the single keyed work that shares its title key, and keeps no key of its own", async () => {
  const { db, repo } = freshRepo();
  const keyed = edition(repo, "9780441013593", "Dune", "Frank Herbert", "OL893415W");
  const keyless = edition(repo, "9780593099322", "Dune", "Frank Herbert");
  assert.equal(await groupKeylessWorks(repo, 250), 1);
  const moved = repo.getBook(keyless.id)!;
  assert.deepEqual([moved.work_id, moved.ol_work_key], [keyed.work_id, null]);
  assert.equal(workById(db, keyless.work_id).merged_into, keyed.work_id);
  assert.equal(await groupKeylessWorks(repo, 250), 0);
});

test("keyless works sharing a title key merge into the oldest of them", async () => {
  const { db, repo } = freshRepo();
  const oldest = edition(repo, "9789720000001", "Ensaio sobre a Cegueira", "José Saramago", undefined, at(0));
  const middle = edition(repo, "9789720000002", "Ensaio Sobre a Cegueira", "Saramago, José", undefined, at(1));
  const newest = edition(repo, "9789720000003", "Ensaio sobre a cegueira", "José Saramago", undefined, at(2));
  assert.equal(await groupKeylessWorks(repo, 250), 1);
  assert.deepEqual([oldest, newest].map((book) => repo.getBook(book.id)!.work_id), [oldest.work_id, oldest.work_id]);
  assert.equal(repo.getBook(middle.id)!.work_id, middle.work_id);
  assert.equal(workById(db, oldest.work_id).merged_into, null);
});

test("grouping skips ambiguous title keys, authorless and unkeyed editions, mixed works and blocked editions", async () => {
  const { db, repo } = freshRepo();
  edition(repo, "9780000000001", "Poems", "Emily Dickinson", "OL1W");
  edition(repo, "9780000000002", "Poems", "Emily Dickinson", "OL2W");
  edition(repo, "9780000000003", "Poems", "Emily Dickinson");
  edition(repo, "9780000000004", "Orlando", "");
  edition(repo, "9780000000005", "Orlando", "");
  const pending = edition(repo, "9780000000006", "Emma", "Jane Austen");
  edition(repo, "9780000000007", "Emma", "Jane Austen", "OL3W");
  db.prepare("UPDATE books SET title_key = NULL WHERE id = ?").run(pending.id);
  const english = edition(repo, "9780000000008", "Blindness", "José Saramago");
  const portuguese = edition(repo, "9780000000009", "Ensaio sobre a Cegueira", "José Saramago");
  repo.mergeWorks(portuguese.work_id!, english.work_id!);
  edition(repo, "9780000000010", "Blindness", "José Saramago", "OL4W");
  const blocked = edition(repo, "9780000000011", "Dune", "Frank Herbert");
  repo.detachEdition(blocked.id, at(1));
  edition(repo, "9780000000012", "Dune", "Frank Herbert", "OL5W");
  assert.equal(await groupKeylessWorks(repo, 250), 0);
  assert.equal(repo.getBook(blocked.id)!.work_id, blocked.work_id);
});

test("a keyed edition arriving later pulls a keyless group into its work, and every old id resolves there", async () => {
  const { db, repo } = freshRepo();
  const first = edition(repo, "9789720000001", "Os Maias", "Eça de Queirós", undefined, at(0));
  const second = edition(repo, "9789720000002", "Os Maias", "Eça de Queirós", undefined, at(1));
  assert.equal(await groupKeylessWorks(repo, 250), 1);
  const keyed = edition(repo, "9789725681367", "Os Maias", "Eça de Queirós", "OL846513W", at(2));
  assert.equal(await groupKeylessWorks(repo, 250), 1);
  assert.deepEqual([first, second, keyed].map((book) => repo.getBook(book.id)!.work_id), [keyed.work_id, keyed.work_id, keyed.work_id]);
  assert.deepEqual([first.work_id, second.work_id].map((id) => workById(db, id).merged_into), [keyed.work_id, keyed.work_id]);
});

test("Open Library's key moves a title-grouped edition out to its own work, and grouping leaves it there", async () => {
  const { repo } = freshRepo();
  const keyed = edition(repo, "9780441013593", "Dune", "Frank Herbert", "OL1W");
  const grouped = edition(repo, "9780593099322", "Dune", "Frank Herbert");
  await groupKeylessWorks(repo, 250);
  repo.setWorkKey(grouped.id, "OL9W");
  const moved = repo.getBook(grouped.id)!;
  assert.notEqual(moved.work_id, keyed.work_id);
  assert.equal(repo.getWorkView(moved.work_id!)!.olWorkKey, "OL9W");
  assert.equal(repo.getBook(keyed.id)!.work_id, keyed.work_id);
  assert.equal(await groupKeylessWorks(repo, 250), 0);
});

test("groupKeylessWorks merges at most its limit per batch", async () => {
  const { repo } = freshRepo();
  edition(repo, "9780441013593", "Dune", "Frank Herbert", "OL1W");
  edition(repo, "9780593099322", "Dune", "Frank Herbert");
  edition(repo, "9780141439587", "Emma", "Jane Austen", "OL2W");
  edition(repo, "9780141439588", "Emma", "Jane Austen");
  assert.equal(await groupKeylessWorks(repo, 1), 1);
  assert.equal(await groupKeylessWorks(repo, 1), 1);
  assert.equal(await groupKeylessWorks(repo, 1), 0);
});

function groupingFixture() {
  const { db, repo } = freshRepo();
  const label = new Map<string, string>();
  let isbn = 9780000000000;
  const add = (name: string, title: string, author: string, workKey?: string, created = NOW) => {
    const book = edition(repo, String(++isbn), title, author, workKey, created);
    label.set(book.work_id!, name);
    return book;
  };

  add("keyed", "Dune", "Frank Herbert", "OL1W", at(0));
  add("k1", "Dune", "Frank Herbert", undefined, at(2));
  add("k2", "Dune", "Frank Herbert", undefined, at(1));

  add("ambiguous-a", "Poems", "Emily Dickinson", "OL2W", at(0));
  add("ambiguous-b", "Poems", "Emily Dickinson", "OL3W", at(0));
  add("ambiguous-keyless", "Poems", "Emily Dickinson", undefined, at(1));

  add("m3", "Os Maias", "Eça de Queirós", undefined, at(3));
  add("m1", "Os Maias", "Eça de Queirós", undefined, at(1));
  add("m0", "Os Maias", "Eça de Queirós", undefined, at(0));
  add("m2", "Os Maias", "Eça de Queirós", undefined, at(2));

  const first = edition(repo, String(++isbn), "Hamlet", "William Shakespeare", undefined, at(5));
  const second = edition(repo, String(++isbn), "Hamlet", "William Shakespeare", undefined, at(5));
  const [low, high] = first.work_id! < second.work_id! ? [first, second] : [second, first];
  label.set(low.work_id!, "tie-lo");
  label.set(high.work_id!, "tie-hi");

  const blockedKeyed = add("blocked-keyed", "Emma", "Jane Austen", "OL4W", at(0));
  db.prepare("UPDATE books SET title_group_blocked_at = ? WHERE id = ?").run(at(1), blockedKeyed.id);
  add("b0", "Emma", "Jane Austen", undefined, at(0));
  add("b1", "Emma", "Jane Austen", undefined, at(1));

  add("blocked-keyless-keyed", "Persuasion", "Jane Austen", "OL5W", at(0));
  const detached = add("blocked-keyless", "Persuasion", "Jane Austen", undefined, at(1));
  repo.detachEdition(detached.id, at(1));

  const english = add("mixed-english", "Blindness", "José Saramago", undefined, at(0));
  const portuguese = add("mixed-portuguese", "Ensaio sobre a Cegueira", "José Saramago", undefined, at(1));
  repo.mergeWorks(portuguese.work_id!, english.work_id!, at(1));
  add("mixed-newer", "Blindness", "José Saramago", undefined, at(2));

  add("empty-a", "Orlando", "", undefined, at(0));
  add("empty-b", "Orlando", "", undefined, at(1));

  const nullA = add("null-a", "Middlemarch", "George Eliot", undefined, at(0));
  const nullB = add("null-b", "Middlemarch", "George Eliot", undefined, at(1));
  const nullWork = nullA.work_id!;
  repo.mergeWorks(nullB.work_id!, nullWork, at(1));
  db.prepare("UPDATE books SET title_key = NULL WHERE id = ?").run(nullB.id);
  add("null-c", "Middlemarch", "George Eliot", undefined, at(2));

  return { db, repo, label };
}

function mergedPairs(db: DatabaseSync, label: Map<string, string>) {
  const rows = db.prepare("SELECT from_work, into_work FROM work_merges WHERE source = 'title-key' ORDER BY id").all() as Array<{ from_work: string; into_work: string }>;
  return rows.map((row) => `${label.get(row.from_work) ?? row.from_work}>${label.get(row.into_work) ?? row.into_work}`);
}

test("grouping picks the same source and target for every rule case", async () => {
  const { db, repo, label } = groupingFixture();
  assert.equal(await groupKeylessWorks(repo, 250, { at: NOW }), 7);
  assert.deepEqual(mergedPairs(db, label).sort(), ["b1>b0", "k1>keyed", "k2>keyed", "m1>m0", "m2>m0", "m3>m0", "tie-hi>tie-lo"]);
  assert.equal(await groupKeylessWorks(repo, 250, { at: NOW }), 0);
});

test("batches of one merge the same pairs as one call, oldest first within a title key", async () => {
  const one = groupingFixture();
  let merged = 0;
  while (merged < 20 && await groupKeylessWorks(one.repo, 1, { at: NOW }) === 1) merged++;
  assert.equal(merged, 7);
  const all = groupingFixture();
  await groupKeylessWorks(all.repo, 250, { at: NOW });
  assert.deepEqual(mergedPairs(one.db, one.label).sort(), mergedPairs(all.db, all.label).sort());
  assert.deepEqual(mergedPairs(one.db, one.label).filter((pair) => pair.endsWith(">m0")), ["m1>m0", "m2>m0", "m3>m0"]);
});

test("keyless grouping one title key a page, each page its own transaction, merges the same pairs in the same order as one page", async () => {
  const paged = groupingFixture();
  const events: string[] = [];
  const open: boolean[] = [];
  const spy = {
    ...paged.repo,
    groupableTitleKeys: (...args: Parameters<typeof paged.repo.groupableTitleKeys>) => {
      open.push(paged.db.isTransaction);
      events.push("keys");
      setImmediate(() => events.push("tick"));
      return paged.repo.groupableTitleKeys(...args);
    },
    groupTitleKeys: (...args: Parameters<typeof paged.repo.groupTitleKeys>) => {
      open.push(paged.db.isTransaction);
      events.push("group");
      setImmediate(() => events.push("tick"));
      return paged.repo.groupTitleKeys(...args);
    }
  };
  assert.equal(await groupKeylessWorks(spy, 250, { at: NOW, pageSize: 1 }), 7);
  const all = groupingFixture();
  assert.equal(await groupKeylessWorks(all.repo, 250, { at: NOW }), 7);
  assert.deepEqual(mergedPairs(paged.db, paged.label), mergedPairs(all.db, all.label));
  assert.ok(open.length > 0 && open.every((inTransaction) => !inTransaction));
  assert.ok(events.filter((event) => event === "keys").length > 1);
  assert.ok(events.includes("group"));
  events.forEach((event, i) => {
    if (event === "group") assert.deepEqual(events.slice(i - 2, i), ["keys", "tick"]);
    if (event === "keys" && i > 0) assert.equal(events[i - 1], "tick");
  });
});

test("keyless grouping stops on an aborted signal", async () => {
  const { db, repo } = groupingFixture();
  const aborted = new AbortController();
  aborted.abort();
  assert.equal(await groupKeylessWorks(repo, 250, { at: NOW, signal: aborted.signal }), 0);
  assert.equal(countOf(db, "work_merges", "source = 'title-key'"), 0);

  const reading = new AbortController();
  let grouped = 0;
  const spy = {
    ...repo,
    groupableTitleKeys: (...args: Parameters<typeof repo.groupableTitleKeys>) => {
      setImmediate(() => reading.abort());
      return repo.groupableTitleKeys(...args);
    },
    groupTitleKeys: (...args: Parameters<typeof repo.groupTitleKeys>) => {
      grouped++;
      return repo.groupTitleKeys(...args);
    }
  };
  assert.equal(await groupKeylessWorks(spy, 250, { at: NOW, signal: reading.signal }), 0);
  assert.equal(grouped, 0);
  assert.equal(countOf(db, "work_merges", "source = 'title-key'"), 0);
});

test("shared title keys that never pair don't end a batch early", async () => {
  const { db, repo } = freshRepo();
  edition(repo, "9780000000001", "Alpha Tale", "Ann Author", "OL1W");
  edition(repo, "9780000000002", "Alpha Tale", "Ann Author", "OL2W");
  edition(repo, "9780000000003", "Bravo Tale", "Ann Author", "OL3W");
  edition(repo, "9780000000004", "Bravo Tale", "Ann Author", "OL4W");
  edition(repo, "9780000000005", "Charlie Tale", "Ann Author", "OL5W");
  edition(repo, "9780000000006", "Charlie Tale", "Ann Author", "OL6W");
  const detached = edition(repo, "9780000000007", "Delta Tale", "Ann Author", undefined, at(0));
  repo.detachEdition(detached.id, at(1));
  edition(repo, "9780000000008", "Delta Tale", "Ann Author", undefined, at(1));
  const echo = edition(repo, "9780000000009", "Echo Tale", "Ann Author", undefined, at(0));
  const foxtrot = edition(repo, "9780000000010", "Foxtrot Tale", "Ann Author", undefined, at(1));
  repo.mergeWorks(foxtrot.work_id!, echo.work_id!, at(1));
  edition(repo, "9780000000011", "Echo Tale", "Ann Author", undefined, at(2));
  const oldest = edition(repo, "9780000000012", "Zulu Tale", "Ann Author", undefined, at(0));
  const newest = edition(repo, "9780000000013", "Zulu Tale", "Ann Author", undefined, at(1));
  assert.equal(await groupKeylessWorks(repo, 1, { at: NOW }), 1);
  assert.equal(workById(db, newest.work_id).merged_into, oldest.work_id);
  assert.equal(await groupKeylessWorks(repo, 1, { at: NOW }), 0);
});

test("a batch never merges more than its limit when shared keys yield uneven pairs", async () => {
  const { db, repo } = freshRepo();
  edition(repo, "9780000000001", "Alpha Tale", "Ann Author", undefined, at(0));
  edition(repo, "9780000000002", "Alpha Tale", "Ann Author", undefined, at(1));
  edition(repo, "9780000000003", "Bravo Tale", "Ann Author", "OL1W");
  edition(repo, "9780000000004", "Bravo Tale", "Ann Author", "OL2W");
  edition(repo, "9780000000005", "Charlie Tale", "Ann Author", undefined, at(0));
  edition(repo, "9780000000006", "Charlie Tale", "Ann Author", undefined, at(1));
  edition(repo, "9780000000007", "Charlie Tale", "Ann Author", undefined, at(2));
  assert.deepEqual([await groupKeylessWorks(repo, 2, { at: NOW }), await groupKeylessWorks(repo, 2, { at: NOW }), await groupKeylessWorks(repo, 2, { at: NOW })], [2, 1, 0]);
  assert.equal(countOf(db, "work_merges", "source = 'title-key'"), 3);
});

test("grouping reads shared title keys from the covering index, with no temp sort", () => {
  const { db } = freshRepo();
  const plan = (sql: string, ...params: Array<string | number>) => (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as Array<{ detail: string }>).map((row) => row.detail).join(" | ");
  const keys = plan(GROUPABLE_KEYS_SQL, "", 250);
  assert.match(keys, /USING COVERING INDEX idx_books_title_work\b/, keys);
  assert.doesNotMatch(keys, /TEMP B-TREE/, keys);
});

test("looking up keyed works and keyless candidates for a title key reads through the title index, never a scan of books, and enters works by their key", () => {
  const { db } = freshRepo();
  for (const sql of [KEYED_WORKS_SQL, KEYED_EDITIONS_SQL, KEYLESS_CANDIDATES_SQL]) {
    const plan = (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all("[]") as Array<{ detail: string }>).map((row) => row.detail).join(" | ");
    assert.match(plan, /SEARCH books USING (COVERING )?INDEX idx_books_title_work \(title_key=\?\)/, plan);
    assert.doesNotMatch(plan, /SCAN books/, plan);
    assert.match(plan, /SEARCH works USING INDEX sqlite_autoindex_works_1 \(id=\?\)/, plan);
    assert.doesNotMatch(plan, /AUTOMATIC|SEARCH works USING (COVERING )?INDEX idx_/, plan);
  }
  const editions = (db.prepare(`EXPLAIN QUERY PLAN ${KEYED_EDITIONS_SQL}`).all("[]") as Array<{ detail: string }>).map((row) => row.detail).join(" | ");
  assert.match(editions, /SEARCH merged USING INDEX idx_works_merged_into \(merged_into=\?\)/, editions);
  assert.match(editions, /SEARCH m USING INDEX idx_work_merges_from \(from_work=\?\)/, editions);
  assert.doesNotMatch(editions, /SCAN (works|work_merges|merged|m)\b/, editions);
  const keyed = (db.prepare(`EXPLAIN QUERY PLAN ${KEYED_WORKS_SQL}`).all("[]") as Array<{ detail: string }>).map((row) => row.detail).join(" | ");
  assert.match(keyed, /SEARCH work_merges USING COVERING INDEX idx_work_merges_into \(into_work=\? AND source=\? AND undone_at=\?\)/, keyed);
  assert.doesNotMatch(keyed, /SCAN work_merges/, keyed);
});

test("a work key whose work was merged away maps to the merge target", () => {
  const { db, repo } = freshRepo();
  const keyed = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593", workKey: "OL1W" }, ["isbn:9780441013593"], NOW);
  const target = titled(repo, "Duna");
  db.prepare("UPDATE works SET merged_into = ? WHERE id = ?").run(target.work_id, keyed.work_id);
  assert.deepEqual(repo.workIdsByWorkKeys(["OL1W"]), new Map([["OL1W", target.work_id!]]));
});

test("a new edition carrying a merged work's key lands on the original, by every path", () => {
  const { db, repo } = freshRepo();
  const pt = repo.createBook({ title: "Passeio ao Farol", author: "Virginia Woolf", isbn: "9789720000201", workKey: "OL900W" }, ["isbn:9789720000201"], NOW);
  const en = repo.createBook({ title: "To the Lighthouse", author: "Virginia Woolf", isbn: "9780156907392", workKey: "OL901W" }, ["isbn:9780156907392"], NOW);
  assert.equal(repo.mergeTranslation(pt.work_id!, en.work_id!, "jev", 0.95, AT), en.work_id);
  const created = repo.createBook({ title: "Passeio ao Farol", author: "Virginia Woolf", isbn: "9789720000202", workKey: "OL900W" }, ["isbn:9789720000202"], NOW);
  assert.equal(created.work_id, en.work_id);
  const keyed = repo.createBook({ title: "Rumo ao Farol", author: "Virginia Woolf", isbn: "9789720000203" }, ["isbn:9789720000203"], NOW);
  repo.setWorkKey(keyed.id, "OL900W");
  assert.equal(repo.getBook(keyed.id)!.work_id, en.work_id);
  db.exec(`UPDATE books SET work_id = NULL WHERE id = '${created.id}'`);
  assert.equal(repo.assignWork(created.id), en.work_id);
  assert.equal(workById(db, pt.work_id).merged_into, en.work_id);
});

test("a translation merge keeps the original's own summary empty; title-key and admin merges still carry it", () => {
  const { db, repo } = freshRepo();
  const pt = repo.createBook({ title: "Passeio ao Farol", author: "Virginia Woolf", isbn: "9789720000204", workKey: "OL902W" }, ["isbn:9789720000204"], NOW);
  const en = repo.createBook({ title: "To the Lighthouse", author: "Virginia Woolf", isbn: "9780156907393", workKey: "OL903W" }, ["isbn:9780156907393"], NOW);
  repo.setWorkSummary(pt.id, "Uma família numa casa de férias na Escócia.");
  repo.mergeTranslation(pt.work_id!, en.work_id!, "code", null, AT);
  assert.equal(workById(db, en.work_id).summary, null);
  const a = repo.createBook({ title: "A", author: "X", isbn: "9789720000205" }, ["isbn:9789720000205"], NOW);
  const b = repo.createBook({ title: "B", author: "X", isbn: "9789720000206" }, ["isbn:9789720000206"], NOW);
  repo.setWorkSummary(a.id, "Carried.");
  repo.mergeWorks(a.work_id!, b.work_id!, AT);
  assert.equal(workById(db, b.work_id).summary, "Carried.");
});

test("every merge is recorded with the editions it moved and the works it repointed", async () => {
  const { db, repo } = freshRepo();
  const alias = repo.createBook({ title: "Alias", author: "X", isbn: "9789720000207" }, ["isbn:9789720000207"], NOW);
  const pt = repo.createBook({ title: "Passeio", author: "X", isbn: "9789720000208" }, ["isbn:9789720000208"], NOW);
  const en = repo.createBook({ title: "Walk", author: "X", isbn: "9789720000209", workKey: "OL904W" }, ["isbn:9789720000209"], NOW);
  repo.mergeWorks(alias.work_id!, pt.work_id!, AT);
  repo.mergeTranslation(pt.work_id!, en.work_id!, "jev", 0.93, AT);
  const twin1 = repo.createBook({ title: "Twin", author: "Y", isbn: "9789720000219" }, ["isbn:9789720000219"], NOW);
  const twin2 = repo.createBook({ title: "Twin", author: "Y", isbn: "9789720000210" }, ["isbn:9789720000210"], NOW);
  assert.equal(await groupKeylessWorks(repo, 10, { at: AT }), 1);
  const rows = mergeRows(db);
  assert.deepEqual(rows.map((row) => row.source), ["admin", "jev", "title-key"]);
  assert.deepEqual(rows[0], { from_work: alias.work_id, into_work: pt.work_id, source: "admin", confidence: null, moved_book_ids: JSON.stringify([alias.id]), repointed_work_ids: "[]", merged_at: AT, undone_at: null });
  assert.deepEqual(JSON.parse(String(rows[1]!.moved_book_ids)).sort(), [alias.id, pt.id].sort());
  assert.deepEqual(rows[1]!.repointed_work_ids, JSON.stringify([alias.work_id]));
  assert.equal(rows[1]!.confidence, 0.93);
  assert.ok([twin1.work_id, twin2.work_id].includes(String(rows[2]!.from_work)));
});

test("genre state follows a merge: it moves to a target without any, and drops when the target has its own", () => {
  const { repo } = freshRepo();
  const pt = repo.createBook({ title: "Passeio", author: "X", isbn: "9789720000211", workKey: "OL905W" }, ["isbn:9789720000211"], NOW);
  const en = repo.createBook({ title: "Walk", author: "X", isbn: "9789720000212", workKey: "OL906W" }, ["isbn:9789720000212"], NOW);
  repo.saveGenreJudgment({ workId: pt.work_id!, model: "jev-1.13.0", genre: "Literary Fiction", confidence: 0.86, askedAt: AT });
  repo.recordGenreRejection({ workId: pt.work_id!, status: 400, reason: "HTTP 400", at: AT });
  repo.mergeTranslation(pt.work_id!, en.work_id!, "code", null, AT);
  assert.equal(repo.genreJudgments([en.work_id!]).get(en.work_id!)?.genre, "Literary Fiction");
  assert.equal(repo.genreJudgments([pt.work_id!]).size, 0);
  assert.equal(repo.genreRejections([en.work_id!]).get(en.work_id!)?.attempts, 1);

  const other = repo.createBook({ title: "Outro", author: "Z", isbn: "9789720000213", workKey: "OL907W" }, ["isbn:9789720000213"], NOW);
  const target = repo.createBook({ title: "Other", author: "Z", isbn: "9789720000214", workKey: "OL908W" }, ["isbn:9789720000214"], NOW);
  repo.saveGenreJudgment({ workId: other.work_id!, model: "jev-1.13.0", genre: "Poetry", confidence: 0.9, askedAt: AT });
  repo.saveGenreJudgment({ workId: target.work_id!, model: "manual", genre: null, confidence: 1, askedAt: AT });
  repo.mergeTranslation(other.work_id!, target.work_id!, "manual", null, AT);
  assert.equal(repo.genreJudgments([target.work_id!]).get(target.work_id!)?.model, "manual");
  assert.equal(repo.genreJudgments([other.work_id!]).size, 0);
});

test("mergeTranslation refuses a merged or missing work and a work into itself; mergeWorks still refuses keyed works", () => {
  const { repo } = freshRepo();
  const a = repo.createBook({ title: "A", author: "X", isbn: "9789720000217", workKey: "OL910W" }, ["isbn:9789720000217"], NOW);
  const b = repo.createBook({ title: "B", author: "X", isbn: "9789720000218", workKey: "OL911W" }, ["isbn:9789720000218"], NOW);
  assert.throws(() => repo.mergeTranslation(a.work_id!, a.work_id!, "manual", null, AT), WorkMergeError);
  assert.throws(() => repo.mergeTranslation("missing", b.work_id!, "manual", null, AT), WorkMergeError);
  assert.throws(() => repo.mergeWorks(a.work_id!, b.work_id!, AT), WorkMergeError);
  repo.mergeTranslation(a.work_id!, b.work_id!, "manual", null, AT);
  assert.throws(() => repo.mergeTranslation(a.work_id!, b.work_id!, "manual", null, AT), WorkMergeError);
});

test("undo reverses a translation merge, later arrivals with the key and repointed aliases included", () => {
  const { db, repo } = freshRepo();
  const alias = repo.createBook({ title: "Alias", author: "X", isbn: "9789720000301" }, ["isbn:9789720000301"], NOW);
  const pt = repo.createBook({ title: "Passeio", author: "X", isbn: "9789720000302", workKey: "OL920W" }, ["isbn:9789720000302"], NOW);
  const en = repo.createBook({ title: "Walk", author: "X", isbn: "9789720000303", workKey: "OL921W" }, ["isbn:9789720000303"], NOW);
  repo.mergeWorks(alias.work_id!, pt.work_id!, AT);
  repo.mergeTranslation(pt.work_id!, en.work_id!, "jev", 0.92, AT);
  const later = repo.createBook({ title: "Passeio", author: "X", isbn: "9789720000304", workKey: "OL920W" }, ["isbn:9789720000304"], NOW);
  assert.equal(later.work_id, en.work_id);

  assert.deepEqual(repo.undoMerge(pt.work_id!, "2026-10-16T00:00:00.000Z"), { into: en.work_id, editions: 3 });
  assert.equal(workById(db, pt.work_id).merged_into, null);
  for (const id of [alias.id, pt.id, later.id]) assert.equal(repo.getBook(id)!.work_id, pt.work_id);
  assert.equal(repo.getBook(en.id)!.work_id, en.work_id);
  assert.equal(workById(db, alias.work_id).merged_into, pt.work_id);
  assert.equal((db.prepare("SELECT undone_at FROM work_merges WHERE from_work = ? AND source = 'jev'").get(pt.work_id) as { undone_at: string }).undone_at, "2026-10-16T00:00:00.000Z");
  assert.equal(repo.createBook({ title: "Passeio", author: "X", isbn: "9789720000305", workKey: "OL920W" }, ["isbn:9789720000305"], NOW).work_id, pt.work_id);
  assert.throws(() => repo.undoMerge(pt.work_id!, AT), WorkMergeError);
});

test("undo refuses once the target itself merged elsewhere", () => {
  const { repo } = freshRepo();
  const pt = repo.createBook({ title: "Passeio", author: "X", isbn: "9789720000306", workKey: "OL922W" }, ["isbn:9789720000306"], NOW);
  const en = repo.createBook({ title: "Walk", author: "X", isbn: "9789720000307", workKey: "OL923W" }, ["isbn:9789720000307"], NOW);
  const other = repo.createBook({ title: "Walking", author: "X", isbn: "9789720000308", workKey: "OL924W" }, ["isbn:9789720000308"], NOW);
  repo.mergeTranslation(pt.work_id!, en.work_id!, "code", null, AT);
  repo.mergeTranslation(en.work_id!, other.work_id!, "manual", null, AT);
  assert.throws(() => repo.undoMerge(pt.work_id!, AT), WorkMergeError);
});

test("active merges list one source's merges that are not undone, newest first, with the books they moved", () => {
  const { repo } = freshRepo();
  const target = repo.createBook({ title: "Walk", author: "X", isbn: "9780000000401", workKey: "OL940W" }, ["isbn:9780000000401"], NOW);
  const [first, second, third, judged] = ["9789720000402", "9789720000403", "9789720000404", "9789720000405"].map((isbn) => repo.createBook({ title: `Passeio ${isbn}`, author: "X", isbn }, [`isbn:${isbn}`], NOW));
  for (const edition of [first!, second!, third!]) repo.mergeTranslation(edition.work_id!, target.work_id!, "code", null, AT);
  repo.mergeTranslation(judged!.work_id!, target.work_id!, "jev", 0.95, AT);
  repo.undoMerge(second!.work_id!, "2026-10-16T00:00:00.000Z");
  assert.deepEqual(repo.activeMerges("code"), [
    { id: 3, fromWork: third!.work_id, intoWork: target.work_id, movedBookIds: [third!.id], mergedAt: AT, confidence: null },
    { id: 1, fromWork: first!.work_id, intoWork: target.work_id, movedBookIds: [first!.id], mergedAt: AT, confidence: null }
  ]);
  assert.deepEqual(repo.activeMerges("jev").map((merge) => merge.fromWork), [judged!.work_id]);
  assert.deepEqual(repo.activeMerges("manual"), []);
});

test("an undone translation merge stays undone through the next title-key grouping, and takes back a later keyless copy", async () => {
  const { db, repo } = freshRepo();
  const pt = repo.createBook({ title: "Poemas", author: "John Keats", isbn: "9789720000351" }, ["isbn:9789720000351"], NOW);
  const en = repo.createBook({ title: "Poems", author: "Emily Dickinson", isbn: "9780000000352", workKey: "OL930W" }, ["isbn:9780000000352"], NOW);
  repo.mergeTranslation(pt.work_id!, en.work_id!, "jev", 0.92, AT);
  const copy = repo.createBook({ title: "Poemas", author: "John Keats", isbn: "9789720000353" }, ["isbn:9789720000353"], NOW);
  assert.equal(await groupKeylessWorks(repo, 10, { at: AT }), 1);
  assert.equal(repo.getBook(copy.id)!.work_id, en.work_id);

  repo.undoMerge(pt.work_id!, "2026-10-16T00:00:00.000Z");
  assert.equal(repo.getBook(copy.id)!.work_id, pt.work_id);
  assert.equal(workById(db, copy.work_id).merged_into, pt.work_id);
  assert.equal(await groupKeylessWorks(repo, 10, { at: "2026-10-17T00:00:00.000Z" }), 0);
  assert.equal(workById(db, pt.work_id).merged_into, null);
  assert.equal(repo.getBook(pt.id)!.work_id, pt.work_id);
});

const fourthWing = () => {
  const { db, repo } = freshRepo();
  const novel = edition(repo, "9780000000401", "Fourth Wing", "Rebecca Yarros", "OL1W", at(0));
  const novelAgain = edition(repo, "9780000000406", "Fourth Wing", "Rebecca Yarros", "OL1W", at(0));
  const graphic = edition(repo, "9780000000402", "Fourth Wing: The Graphic Novel", "Rebecca Yarros", "OL2W", at(0));
  const piatkus = edition(repo, "9780000000403", "Fourth wing", "Rebecca Yarros", undefined, at(1));
  const graphicKeyless = edition(repo, "9780000000404", "Fourth Wing: The Graphic Novel", "Rebecca Yarros", undefined, at(2));
  const coloring = edition(repo, "9780000000405", "Fourth Wing: The Coloring Book", "Rebecca Yarros", undefined, at(1));
  return { db, repo, novel, novelAgain, graphic, piatkus, graphicKeyless, coloring, key: repo.getBook(novel.id)!.title_key! };
};

test("keyedWorksWithTitleKeys lists live keyed works with an edition under the key", () => {
  const { db, repo } = freshRepo();
  const novel = edition(repo, "9780000000501", "Fourth Wing", "Rebecca Yarros", "OL1W", at(1));
  edition(repo, "9780000000502", "Quarta Asa", "Rebecca Yarros", "OL1W", at(1));
  const graphic = edition(repo, "9780000000503", "Fourth Wing: The Graphic Novel", "Rebecca Yarros", "OL2W", at(2));
  const flame = edition(repo, "9780000000504", "Iron Flame", "Rebecca Yarros", "OL3W", at(3));
  const both = edition(repo, "9780000000505", "Fourth Wing", "Rebecca Yarros", "OL4W", at(4));
  edition(repo, "9780000000506", "Iron Flame", "Rebecca Yarros", "OL4W", at(4));
  edition(repo, "9780000000507", "Fourth Wing", "Rebecca Yarros", undefined, at(5));
  const merged = edition(repo, "9780000000508", "Fourth Wing", "Rebecca Yarros", "OL5W", at(6));
  repo.mergeTranslation(merged.work_id!, novel.work_id!, "manual", null, AT);
  const blocked = edition(repo, "9780000000509", "Fourth Wing", "Rebecca Yarros", "OL6W", at(7));
  db.prepare("UPDATE books SET title_group_blocked_at = ? WHERE id = ?").run(AT, blocked.id);
  const partlyBlocked = edition(repo, "9780000000510", "Fourth Wing", "Rebecca Yarros", "OL7W", at(8));
  const sibling = edition(repo, "9780000000511", "Fourth Wing", "Rebecca Yarros", "OL7W", at(8));
  db.prepare("UPDATE books SET title_group_blocked_at = ? WHERE id = ?").run(AT, sibling.id);
  const key = repo.getBook(novel.id)!.title_key!;
  const flameKey = repo.getBook(flame.id)!.title_key!;
  const row = (titleKey: string, book: { work_id: string | null }, title: string, editions: number, createdAt: string) => ({ titleKey, id: book.work_id, title, author: "Rebecca Yarros", editions, absorbed: 0, createdAt });

  assert.deepEqual(repo.keyedWorksWithTitleKeys([key]).map((work) => ({ ...work })), [
    row(key, novel, "Fourth Wing", 3, at(1)),
    row(key, graphic, "Fourth Wing: The Graphic Novel", 1, at(2)),
    row(key, both, "Fourth Wing", 2, at(4)),
    row(key, partlyBlocked, "Fourth Wing", 2, at(8))
  ]);
  const pairs = repo.keyedWorksWithTitleKeys([key, flameKey]).map((work) => `${work.titleKey}>${work.id}`);
  assert.deepEqual(pairs.sort(), [key, flameKey].flatMap((titleKey) => (titleKey === key ? [novel, graphic, both, partlyBlocked] : [flame, both]).map((book) => `${titleKey}>${book.work_id}`)).sort());
  assert.deepEqual(repo.keyedWorksWithTitleKeys([]), []);
});

test("keyedWorksWithTitleKeys counts only a work's live ol-duplicate merges as absorbed", () => {
  const { db, repo } = freshRepo();
  const target = edition(repo, "9780000000521", "Fourth Wing", "Rebecca Yarros", "OL1W", at(0));
  edition(repo, "9780000000522", "Fourth Wing", "Rebecca Yarros", undefined, at(1));
  const key = repo.getBook(target.id)!.title_key!;
  assert.equal(repo.groupTitleKeys([key], 10, AT), 1);
  const keyless = edition(repo, "9780000000523", "Iron Flame", "Rebecca Yarros", undefined, at(2));
  repo.mergeWorks(keyless.work_id!, target.work_id!, AT);
  const translated = edition(repo, "9780000000524", "Quarta Asa", "Rebecca Yarros", undefined, at(3));
  repo.mergeTranslation(translated.work_id!, target.work_id!, "code", null, AT);
  const first = edition(repo, "9780000000525", "Fourth Wing", "Rebecca Yarros", "OL2W", at(4));
  const second = edition(repo, "9780000000526", "Fourth Wing", "Rebecca Yarros", "OL3W", at(5));
  repo.mergeDuplicateWork(first.work_id!, target.work_id!, AT);
  repo.mergeDuplicateWork(second.work_id!, target.work_id!, AT);
  repo.undoMerge(second.work_id!, "2026-10-16T00:00:00.000Z");

  assert.deepEqual(mergeRows(db).map((merge) => [merge.source, merge.undone_at]), [
    ["title-key", null],
    ["admin", null],
    ["code", null],
    ["ol-duplicate", null],
    ["ol-duplicate", "2026-10-16T00:00:00.000Z"]
  ]);
  assert.deepEqual(repo.keyedWorksWithTitleKeys([key]).map((work) => [work.id, work.absorbed]), [[target.work_id, 1], [second.work_id, 0]]);

  repo.mergeDuplicateWork(second.work_id!, target.work_id!, AT);
  assert.deepEqual(repo.keyedWorksWithTitleKeys([key]).map((work) => [work.id, work.absorbed]), [[target.work_id, 2]]);
});

test("a joined survivor's duplicates stay with it", () => {
  const { repo } = freshRepo();
  const survivor = edition(repo, "9780000000531", "Quarta Asa", "Rebecca Yarros", "OL1W", at(0));
  const duplicate = edition(repo, "9780000000532", "Quarta Asa", "Rebecca Yarros", "OL2W", at(1));
  const other = edition(repo, "9780000000533", "Fourth Wing", "Rebecca Yarros", "OL3W", at(2));
  const keys = [survivor, other].map((book) => repo.getBook(book.id)!.title_key!);
  const absorbed = () => Object.fromEntries(repo.keyedWorksWithTitleKeys(keys).map((work) => [work.id, work.absorbed]));

  repo.mergeDuplicateWork(duplicate.work_id!, survivor.work_id!, AT);
  assert.deepEqual(absorbed(), { [survivor.work_id!]: 1, [other.work_id!]: 0 });

  repo.mergeTranslation(survivor.work_id!, other.work_id!, "code", null, AT);
  assert.deepEqual(absorbed(), { [other.work_id!]: 0 });

  repo.undoMerge(survivor.work_id!, "2026-10-16T00:00:00.000Z");
  assert.deepEqual(absorbed(), { [survivor.work_id!]: 1, [other.work_id!]: 0 });
});

test("mergeDuplicateWork moves editions and logs an ol-duplicate merge", () => {
  const { db, repo } = freshRepo();
  const from = edition(repo, "9780000000601", "Fourth WIng", "Rebecca Yarros", "OL1W", at(1));
  const fromOther = edition(repo, "9780000000602", "Quarta Asa", "Rebecca Yarros", "OL1W", at(1));
  const into = edition(repo, "9780000000603", "Fourth Wing", "Rebecca Yarros", "OL2W", at(0));
  repo.setWorkSummary(from.id, "Carried.");

  assert.equal(repo.mergeDuplicateWork(from.work_id!, into.work_id!, AT), into.work_id);
  assert.deepEqual(mergeRows(db), [{ from_work: from.work_id, into_work: into.work_id, source: "ol-duplicate", confidence: null, moved_book_ids: JSON.stringify([from.id, fromOther.id]), repointed_work_ids: "[]", merged_at: AT, undone_at: null }]);
  assert.equal(repo.canonicalWorkIds([from.work_id!]).get(from.work_id!), into.work_id);
  for (const book of [from, fromOther, into]) assert.equal(repo.getBook(book.id)!.work_id, into.work_id);
  assert.equal(workById(db, into.work_id).summary, "Carried.");
  assert.equal(workById(db, from.work_id).ol_work_key, "OL1W");

  const later = repo.createBook({ title: "Fourth Wing", author: "Rebecca Yarros", isbn: "9780000000604" }, ["isbn:9780000000604"], NOW);
  repo.setWorkKey(later.id, "OL1W");
  assert.equal(repo.getBook(later.id)!.work_id, into.work_id);
});

test("mergeDuplicateWork refuses a keyless or already merged work", () => {
  const { db, repo } = freshRepo();
  const a = edition(repo, "9780000000701", "Fourth Wing", "Rebecca Yarros", "OL1W");
  const b = edition(repo, "9780000000702", "Fourth Wing", "Rebecca Yarros", "OL2W");
  const c = edition(repo, "9780000000703", "Fourth Wing", "Rebecca Yarros", "OL3W");
  const keyless = edition(repo, "9780000000704", "Fourth Wing", "Rebecca Yarros");
  assert.throws(() => repo.mergeDuplicateWork(keyless.work_id!, a.work_id!, AT), WorkMergeError);
  assert.throws(() => repo.mergeDuplicateWork(a.work_id!, keyless.work_id!, AT), WorkMergeError);
  assert.throws(() => repo.mergeDuplicateWork("no-such-work", a.work_id!, AT), WorkMergeError);
  assert.throws(() => repo.mergeDuplicateWork(a.work_id!, "no-such-work", AT), WorkMergeError);
  assert.throws(() => repo.mergeDuplicateWork(a.work_id!, a.work_id!, AT), WorkMergeError);
  assert.equal(countOf(db, "work_merges"), 0);

  repo.mergeDuplicateWork(b.work_id!, a.work_id!, AT);
  assert.throws(() => repo.mergeDuplicateWork(b.work_id!, c.work_id!, AT), WorkMergeError);
  assert.throws(() => repo.mergeDuplicateWork(c.work_id!, b.work_id!, AT), WorkMergeError);
  assert.equal(countOf(db, "work_merges"), 1);
  assert.equal(repo.getBook(b.id)!.work_id, a.work_id);
  assert.equal(repo.getBook(c.id)!.work_id, c.work_id);
});

test("addWorkAlias leaves a merged work holding the key, so the key maps to the target and a later edition lands there", () => {
  const { db, repo } = freshRepo();
  const target = edition(repo, "9780000000901", "Fourth Wing", "Rebecca Yarros", "OL1W");
  repo.setWorkSummary(target.id, "Kept.");
  repo.addWorkAlias("OL2W", target.work_id!, AT);

  const alias = db.prepare("SELECT * FROM works WHERE ol_work_key = 'OL2W'").get() as unknown as WorkRow;
  assert.deepEqual([alias.merged_into, alias.title, alias.author, alias.created_at], [target.work_id, "Fourth Wing", "Rebecca Yarros", AT]);
  assert.deepEqual(repo.workIdsByWorkKeys(["OL1W", "OL2W"]), new Map([["OL1W", target.work_id!], ["OL2W", target.work_id!]]));
  assert.deepEqual(mergeRows(db), [{ from_work: alias.id, into_work: target.work_id, source: "ol-duplicate", confidence: null, moved_book_ids: "[]", repointed_work_ids: "[]", merged_at: AT, undone_at: null }]);
  assert.equal(countOf(db, "books"), 1);
  assert.equal(workById(db, target.work_id).summary, "Kept.");

  const later = repo.createBook({ title: "Fourth Wing", author: "Rebecca Yarros", isbn: "9780000000902", workKey: "OL2W" }, ["isbn:9780000000902"], NOW);
  assert.equal(repo.getBook(later.id)!.work_id, target.work_id);
});

test("addWorkAlias onto a merged work aliases its target, and refuses a missing work", () => {
  const { db, repo } = freshRepo();
  const from = edition(repo, "9780000000911", "Fourth WIng", "Rebecca Yarros", "OL1W", at(1));
  const into = edition(repo, "9780000000912", "Fourth Wing", "Rebecca Yarros", "OL2W", at(0));
  repo.mergeDuplicateWork(from.work_id!, into.work_id!, AT);
  repo.addWorkAlias("OL3W", from.work_id!, AT);
  assert.equal(repo.workIdsByWorkKeys(["OL3W"]).get("OL3W"), into.work_id);
  const alias = db.prepare("SELECT * FROM works WHERE ol_work_key = 'OL3W'").get() as unknown as WorkRow;
  assert.equal(alias.merged_into, into.work_id);

  assert.throws(() => repo.addWorkAlias("OL4W", "no-such-work", AT), WorkMergeError);
  assert.equal(repo.workIdsByWorkKeys(["OL4W"]).size, 0);
  assert.equal(countOf(db, "works"), 3);
});

test("undoneMergeAmong is true after undoMerge, whichever way the ids are listed", () => {
  const { repo } = freshRepo();
  const a = edition(repo, "9780000000801", "Fourth Wing", "Rebecca Yarros", "OL1W");
  const b = edition(repo, "9780000000802", "Fourth Wing", "Rebecca Yarros", "OL2W");
  const c = edition(repo, "9780000000803", "Fourth Wing", "Rebecca Yarros", "OL3W");
  const [wa, wb, wc] = [a.work_id!, b.work_id!, c.work_id!];
  repo.mergeDuplicateWork(wb, wa, AT);
  assert.equal(repo.undoneMergeAmong([wa, wb]), false);
  repo.undoMerge(wb, "2026-10-16T00:00:00.000Z");
  for (const ids of [[wa, wb], [wb, wa], [wa, wc, wb], [wc, wb, wa]]) assert.equal(repo.undoneMergeAmong(ids), true, ids.join());
  for (const ids of [[wa, wc], [wb, wc], [wa], []]) assert.equal(repo.undoneMergeAmong(ids), false, ids.join());
});

test("undoing an ol-duplicate merge keeps the survivor's own keyless editions", async () => {
  const { db, repo } = freshRepo();
  const survivor = edition(repo, "9780000000901", "Fourth Wing", "Rebecca Yarros", "OL2W", at(0));
  const before = edition(repo, "9780000000902", "Fourth Wing", "Rebecca Yarros", undefined, at(1));
  assert.equal(await groupKeylessWorks(repo, 10, { at: at(2) }), 1);
  const duplicate = edition(repo, "9780000000903", "Fourth Wing", "Rebecca Yarros", "OL1W", at(3));
  const duplicateOther = edition(repo, "9780000000904", "Quarta Asa", "Rebecca Yarros", "OL1W", at(3));
  repo.mergeDuplicateWork(duplicate.work_id!, survivor.work_id!, at(4));
  const after = edition(repo, "9780000000905", "Fourth Wing", "Rebecca Yarros", undefined, at(5));
  assert.equal(await groupKeylessWorks(repo, 10, { at: at(6) }), 1);
  assert.deepEqual([survivor, before, after, duplicate].map((book) => repo.getBook(book.id)!.work_id), Array(4).fill(survivor.work_id));

  assert.deepEqual(repo.undoMerge(duplicate.work_id!, at(7)), { into: survivor.work_id, editions: 2 });
  for (const book of [survivor, before, after]) assert.equal(repo.getBook(book.id)!.work_id, survivor.work_id);
  for (const book of [duplicate, duplicateOther]) assert.equal(repo.getBook(book.id)!.work_id, duplicate.work_id);
  assert.equal(workById(db, duplicate.work_id).merged_into, null);
  assert.equal(workById(db, before.work_id).merged_into, survivor.work_id);
  assert.equal((db.prepare("SELECT undone_at FROM work_merges WHERE source = 'ol-duplicate'").get() as { undone_at: string }).undone_at, at(7));
});

const lupin = (workKey?: string) => {
  const { db, repo } = freshRepo();
  const volumes = [
    ["9789720001001", "Arsène Lupin: Gentleman Ladrão", workKey],
    ["9789720001002", "Arsène Lupin: A Agulha Oca", undefined],
    ["9789720001003", "Arsène Lupin: O Triângulo de Ouro", undefined]
  ] as const;
  const [first, second, third] = volumes.map(([isbn, title, key], day) => edition(repo, isbn, title, "Maurice Leblanc", key, at(day)));
  return { db, repo, first: first!, second: second!, third: third! };
};

const blockedBooks = (db: DatabaseSync) => (db.prepare("SELECT id FROM books WHERE title_group_blocked_at IS NOT NULL").all() as Array<{ id: string }>).map((row) => row.id);

const foldAsTitleKey = (db: DatabaseSync, repo: ReturnType<typeof createSqliteBooksRepository>, into: { work_id: string | null }, ...sources: Array<{ work_id: string | null }>) => {
  for (const source of sources) {
    repo.mergeWorks(source.work_id!, into.work_id!, AT);
    db.prepare("UPDATE work_merges SET source = 'title-key' WHERE from_work = ?").run(source.work_id);
  }
};

for (const [name, workKey] of [["keyless", undefined], ["keyed", "OL1W"]] as const) {
  test(`undoing a title-key merge in a ${name} target restores only that merge's edition and blocks no book`, async () => {
    const { db, repo, first, second, third } = lupin(workKey);
    foldAsTitleKey(db, repo, first, second, third);
    for (const book of [first, second, third]) assert.equal(repo.getBook(book.id)!.work_id, first.work_id);

    assert.deepEqual(repo.undoMerge(second.work_id!, at(7)), { into: first.work_id, editions: 1 });
    assert.equal(repo.getBook(second.id)!.work_id, second.work_id);
    assert.equal(workById(db, second.work_id).merged_into, null);
    for (const book of [first, third]) assert.equal(repo.getBook(book.id)!.work_id, first.work_id);
    assert.equal(workById(db, third.work_id).merged_into, first.work_id);
    assert.deepEqual(
      (db.prepare("SELECT from_work, undone_at FROM work_merges WHERE source = 'title-key' ORDER BY id").all() as Array<Record<string, unknown>>).map((row) => ({ ...row })),
      [{ from_work: second.work_id, undone_at: at(7) }, { from_work: third.work_id, undone_at: null }]
    );

    assert.equal(await groupKeylessWorks(repo, 10, { at: at(8) }), 0);
    assert.equal(repo.getBook(second.id)!.work_id, second.work_id);
    assert.equal(workById(db, second.work_id).merged_into, null);
    assert.deepEqual(blockedBooks(db), []);
  });
}

test("two copies of one volume folded into the same target and both undone stay apart from it, unblocked", async () => {
  const { db, repo } = freshRepo();
  const target = edition(repo, "9789720001101", "Arsène Lupin: Gentleman Ladrão", "Maurice Leblanc", undefined, at(0));
  const [copy, other] = ["9789720001102", "9789720001103"].map((isbn, n) => edition(repo, isbn, "Arsène Lupin: A Agulha Oca", "Maurice Leblanc", undefined, at(n + 1)));
  foldAsTitleKey(db, repo, target, copy!, other!);
  for (const book of [copy!, other!]) assert.equal(repo.getBook(book.id)!.work_id, target.work_id);
  for (const book of [copy!, other!]) repo.undoMerge(book.work_id!, at(7));

  assert.equal(await groupKeylessWorks(repo, 10, { at: at(8) }), 1);
  assert.equal(repo.getBook(other!.id)!.work_id, copy!.work_id);
  assert.equal(repo.getBook(copy!.id)!.work_id, copy!.work_id);
  assert.equal(repo.getBook(target.id)!.work_id, target.work_id);
  assert.deepEqual(blockedBooks(db), []);
});

const heldNeedle = (otherKeyed: boolean) => {
  const { db, repo } = freshRepo();
  const keyed = edition(repo, "9789720001201", "Arsène Lupin: Gentleman Ladrão", "Maurice Leblanc", "OL1W", at(0));
  const held = edition(repo, "9789720001202", "Arsène Lupin: A Agulha Oca", "Maurice Leblanc", undefined, at(1));
  if (otherKeyed) edition(repo, "9789720001203", "Arsène Lupin: O Triângulo de Ouro", "Maurice Leblanc", "OL2W", at(2));
  foldAsTitleKey(db, repo, keyed, held);
  const copy = edition(repo, "9789720001204", "Arsène Lupin: A Agulha Oca", "Maurice Leblanc", undefined, at(3));
  return { db, repo, keyed, held, copy };
};

for (const [name, otherKeyed] of [["beside another keyed volume", true], ["alone", false]] as const) {
  test(`an edition a title-key merge moved into a keyed work ${name} attracts no keyless copy, and the copy folds with it once the merge is undone`, async () => {
    const { db, repo, keyed, held, copy } = heldNeedle(otherKeyed);
    assert.equal(await groupKeylessWorks(repo, 250, { at: at(4) }), 0);
    assert.equal(repo.getBook(copy.id)!.work_id, copy.work_id);
    assert.equal(repo.getBook(held.id)!.work_id, keyed.work_id);

    repo.undoMerge(held.work_id!, at(7));
    assert.equal(await groupKeylessWorks(repo, 250, { at: at(8) }), 1);
    assert.equal(repo.getBook(copy.id)!.work_id, held.work_id);
    assert.equal(repo.getBook(held.id)!.work_id, held.work_id);
    assert.equal(repo.getBook(keyed.id)!.work_id, keyed.work_id);
    assert.deepEqual(blockedBooks(db), []);
  });
}

test("an edition an undone title-key merge once moved in attracts keyless copies again when an admin merge moves it back in", async () => {
  const { db, repo, keyed, held, copy } = heldNeedle(false);
  repo.undoMerge(held.work_id!, at(7));
  repo.mergeWorks(held.work_id!, keyed.work_id!, at(8));
  assert.equal(countOf(db, "work_merges", "source = 'title-key' AND undone_at IS NOT NULL"), 1);

  assert.equal(await groupKeylessWorks(repo, 250, { at: at(9) }), 1);
  assert.equal(repo.getBook(copy.id)!.work_id, keyed.work_id);
});

test("a pair skipped for an undone merge does not use up the batch limit", async () => {
  const { repo } = freshRepo();
  const [target, ...copies] = ["9789720001101", "9789720001102", "9789720001103"].map((isbn, n) => edition(repo, isbn, "O Profeta", "Kahlil Gibran", undefined, at(n)));
  assert.equal(await groupKeylessWorks(repo, 10, { at: AT }), 2);
  for (const copy of copies) repo.undoMerge(copy.work_id!, at(7));
  const later = edition(repo, "9789720001104", "O Profeta", "Kahlil Gibran", undefined, at(9));

  assert.equal(await groupKeylessWorks(repo, 1, { at: at(10) }), 1);
  assert.equal(repo.getBook(later.id)!.work_id, target!.work_id);
  for (const copy of copies) assert.notEqual(repo.getBook(copy.id)!.work_id, target!.work_id);
});

test("grouping does not redo an undone translation join between works that share a title key", async () => {
  const { db, repo } = freshRepo();
  const keyed = edition(repo, "9780000001201", "Fourth Wing", "Rebecca Yarros", "OL1W", at(0));
  const keyless = edition(repo, "9780000001202", "Fourth Wing", "Rebecca Yarros", undefined, at(1));
  repo.mergeTranslation(keyless.work_id!, keyed.work_id!, "jev", 0.9, AT);
  repo.undoMerge(keyless.work_id!, at(7));

  assert.equal(await groupKeylessWorks(repo, 10, { at: at(8) }), 0);
  assert.equal(repo.getBook(keyless.id)!.work_id, keyless.work_id);
  assert.equal(workById(db, keyless.work_id).merged_into, null);
});

test("groupTitleKeys does not redo an undone merge when a key has several keyed works", () => {
  const { repo, graphic, piatkus, graphicKeyless, key } = fourthWing();
  assert.equal(repo.groupTitleKeys([key], 10, AT), 2);
  repo.undoMerge(piatkus.work_id!, at(7));

  assert.equal(repo.groupTitleKeys([key], 10, at(8)), 0);
  assert.equal(repo.getBook(piatkus.id)!.work_id, piatkus.work_id);
  assert.equal(repo.getBook(graphicKeyless.id)!.work_id, graphic.work_id);
});

test("grouping does not redo an undone merge into a work that has since been joined onward", async () => {
  const { repo } = freshRepo();
  const a = edition(repo, "9780000001301", "Fourth Wing", "Rebecca Yarros", undefined, at(0));
  const b = edition(repo, "9780000001302", "Fourth Wing", "Rebecca Yarros", undefined, at(1));
  assert.equal(await groupKeylessWorks(repo, 10, { at: AT }), 1);
  repo.undoMerge(b.work_id!, at(7));
  const keyed = edition(repo, "9780000001303", "Fourth Wing", "Rebecca Yarros", "OL1W", at(8));
  repo.mergeTranslation(a.work_id!, keyed.work_id!, "code", null, at(8));

  assert.equal(await groupKeylessWorks(repo, 10, { at: at(9) }), 0);
  assert.equal(repo.getBook(b.id)!.work_id, b.work_id);
  assert.equal(repo.getBook(a.id)!.work_id, keyed.work_id);
});

test("grouping does not redo an undone merge whose restored work has since been joined into the keyed original", async () => {
  const { repo } = freshRepo();
  const a = edition(repo, "9780000001601", "Fourth Wing", "Rebecca Yarros", undefined, at(0));
  const b = edition(repo, "9780000001602", "Fourth Wing", "Rebecca Yarros", undefined, at(1));
  assert.equal(await groupKeylessWorks(repo, 10, { at: AT }), 1);
  repo.undoMerge(b.work_id!, at(7));
  const original = edition(repo, "9780000001603", "Fourth Wing", "Rebecca Yarros", "OL1W", at(8));
  repo.mergeTranslation(b.work_id!, original.work_id!, "code", null, at(8));
  assert.equal(repo.undoneMergeAmong([a.work_id!, original.work_id!]), true);

  assert.equal(await groupKeylessWorks(repo, 10, { at: at(9) }), 0);
  assert.equal(repo.getBook(a.id)!.work_id, a.work_id);
  assert.equal(repo.getBook(b.id)!.work_id, original.work_id);
});

test("an undone merge whose two ends were later merged into the same work blocks no pair", async () => {
  const { repo } = freshRepo();
  const x = edition(repo, "9780000001701", "Duna", "Frank Herbert", undefined, at(0));
  const y = edition(repo, "9780000001702", "Duna", "Frank Herbert", undefined, at(1));
  assert.equal(await groupKeylessWorks(repo, 10, { at: AT }), 1);
  repo.undoMerge(y.work_id!, at(7));
  const original = edition(repo, "9780000001703", "Dune", "Frank Herbert", "OL1W", at(8));
  const other = edition(repo, "9780000001704", "Dune Messiah", "Frank Herbert", "OL2W", at(8));
  for (const portuguese of [x, y]) repo.mergeTranslation(portuguese.work_id!, original.work_id!, "code", null, at(8));
  assert.equal(repo.undoneMergeAmong([original.work_id!, other.work_id!]), false);
  const unrelated = edition(repo, "9780000001705", "Dune", "Frank Herbert", undefined, at(9));

  assert.equal(await groupKeylessWorks(repo, 10, { at: at(10) }), 1);
  assert.equal(repo.getBook(unrelated.id)!.work_id, original.work_id);
});

test("undoneMergeAmong also counts an undone merge into a work that has since been merged into one of the ids", () => {
  const { repo } = freshRepo();
  const [a, b, c] = ["9780000001401", "9780000001402", "9780000001403"].map((isbn, n) => edition(repo, isbn, "Fourth Wing", "Rebecca Yarros", `OL${n + 1}W`));
  const [wa, wb, wc] = [a!.work_id!, b!.work_id!, c!.work_id!];
  repo.mergeDuplicateWork(wb, wa, AT);
  repo.undoMerge(wb, at(7));
  repo.mergeDuplicateWork(wa, wc, at(8));
  for (const ids of [[wc, wb], [wb, wc], [wa, wb]]) assert.equal(repo.undoneMergeAmong(ids), true, ids.join());
  for (const ids of [[wa, wc], [wb], [wc]]) assert.equal(repo.undoneMergeAmong(ids), false, ids.join());
});

test("undoing a title-key merge takes back the synopsis it carried onto the target, and only that one", () => {
  const { db, repo, first, second } = lupin();
  repo.setWorkSummary(second.id, "Um ladrão cavalheiro em Paris.");
  foldAsTitleKey(db, repo, first, second);
  assert.equal(workById(db, first.work_id).summary, "Um ladrão cavalheiro em Paris.");

  repo.undoMerge(second.work_id!, at(7));
  assert.deepEqual({ summary: workById(db, first.work_id).summary, hash: (db.prepare("SELECT summary_hash AS hash FROM works WHERE id = ?").get(first.work_id) as { hash: string | null }).hash }, { summary: null, hash: null });
  assert.equal(workById(db, second.work_id).summary, "Um ladrão cavalheiro em Paris.");
});

test("undoing an ol-duplicate merge leaves the synopsis it carried, since it is the same book's", () => {
  const { db, repo } = freshRepo();
  const survivor = edition(repo, "9780000001501", "Fourth Wing", "Rebecca Yarros", "OL2W", at(0));
  const duplicate = edition(repo, "9780000001502", "Fourth Wing", "Rebecca Yarros", "OL1W", at(1));
  repo.setWorkSummary(duplicate.id, "Carried.");
  repo.mergeDuplicateWork(duplicate.work_id!, survivor.work_id!, at(2));
  repo.undoMerge(duplicate.work_id!, at(7));
  assert.equal(workById(db, survivor.work_id).summary, "Carried.");
});

test("undoing a title-key merge leaves a target that had its own synopsis before the fold alone", () => {
  const { db, repo, first, second } = lupin();
  repo.setWorkSummary(first.id, "Own synopsis.");
  repo.setWorkSummary(second.id, "Another synopsis.");
  foldAsTitleKey(db, repo, first, second);

  repo.undoMerge(second.work_id!, at(7));
  assert.equal(workById(db, first.work_id).summary, "Own synopsis.");
  assert.equal(workById(db, second.work_id).summary, "Another synopsis.");
});

test("groupTitleKeys folds a keyless edition into the keyed work with its full title when a key has several keyed works", () => {
  const { db, repo, novel, graphic, piatkus, graphicKeyless, coloring, key } = fourthWing();
  assert.equal(repo.groupTitleKeys([key], 10, AT), 2);
  assert.equal(repo.getBook(piatkus.id)!.work_id, novel.work_id);
  assert.equal(repo.getBook(graphicKeyless.id)!.work_id, graphic.work_id);
  assert.equal(repo.getBook(coloring.id)!.work_id, coloring.work_id);
  assert.deepEqual(
    (db.prepare("SELECT from_work, into_work, source, merged_at FROM work_merges ORDER BY id").all() as Array<Record<string, unknown>>).map((row) => ({ ...row })),
    [
      { from_work: piatkus.work_id, into_work: novel.work_id, source: "title-key", merged_at: AT },
      { from_work: graphicKeyless.work_id, into_work: graphic.work_id, source: "title-key", merged_at: AT }
    ]
  );
  assert.equal(repo.groupTitleKeys([key], 10, AT), 0);
});

test("groupKeylessWorks folds each keyless edition into the keyed work with its full title when a key has several keyed works", async () => {
  const { repo, novel, graphic, piatkus, graphicKeyless, coloring } = fourthWing();
  assert.equal(await groupKeylessWorks(repo, 250, { at: AT }), 2);
  assert.deepEqual([piatkus, graphicKeyless, coloring].map((book) => repo.getBook(book.id)!.work_id), [novel.work_id, graphic.work_id, coloring.work_id]);
  assert.equal(await groupKeylessWorks(repo, 250, { at: AT }), 0);
});

test("groupTitleKeys leaves a keyless edition alone when two keyed works have its full title", () => {
  const { repo } = freshRepo();
  edition(repo, "9780000001001", "Fourth Wing", "Rebecca Yarros", "OL1W");
  edition(repo, "9780000001002", "Fourth WIng", "Rebecca Yarros", "OL2W");
  const keyless = edition(repo, "9780000001003", "Fourth Wing", "Rebecca Yarros");
  assert.equal(repo.groupTitleKeys([repo.getBook(keyless.id)!.title_key!], 10, AT), 0);
  assert.equal(repo.getBook(keyless.id)!.work_id, keyless.work_id);
});

for (const [name, workKey] of [["three keyless volumes of one series stay three works", undefined], ["two keyless volumes beside the keyed first volume of a series stay apart from it and from each other", "OL1W"]] as const) {
  test(name, async () => {
    const { db, repo, first, second, third } = lupin(workKey);
    assert.equal(await groupKeylessWorks(repo, 250, { at: AT }), 0);
    for (const book of [first, second, third]) assert.equal(repo.getBook(book.id)!.work_id, book.work_id);
    assert.equal(countOf(db, "works", "merged_into IS NOT NULL"), 0);
    assert.equal(countOf(db, "work_merges"), 0);
  });
}

test("two keyless copies of one volume fold together and not into the keyed volume beside them", async () => {
  const { repo, first, second, third } = lupin("OL1W");
  const copy = edition(repo, "9789720001004", "Arsène Lupin: A Agulha Oca", "Maurice Leblanc", undefined, at(3));
  assert.equal(await groupKeylessWorks(repo, 250, { at: AT }), 1);
  assert.equal(repo.getBook(copy.id)!.work_id, second.work_id);
  for (const book of [first, second, third]) assert.equal(repo.getBook(book.id)!.work_id, book.work_id);
});

test("a keyless copy of a Portuguese edition folds into the English keyed work that holds it through a translation join", async () => {
  const { repo } = freshRepo();
  const english = edition(repo, "9780000002001", "1984", "George Orwell", "OL1W", at(0));
  const portuguese = edition(repo, "9780000002002", "Mil Novecentos e Oitenta e Quatro", "George Orwell", undefined, at(1));
  repo.mergeTranslation(portuguese.work_id!, english.work_id!, "jev", 0.9, AT);
  const copy = edition(repo, "9780000002003", "Mil Novecentos e Oitenta e Quatro", "George Orwell", undefined, at(2));
  assert.equal(await groupKeylessWorks(repo, 250, { at: AT }), 1);
  assert.equal(repo.getBook(copy.id)!.work_id, english.work_id);
});

test("the plain book and its graphic novel stay apart", async () => {
  const { repo } = freshRepo();
  const graphic = edition(repo, "9789720001101", "O Profeta: Novela Gráfica", "Kahlil Gibran", undefined, at(0));
  const [plain, copy] = ["9789720001102", "9789720001103"].map((isbn, n) => edition(repo, isbn, "O Profeta", "Kahlil Gibran", undefined, at(n + 1)));
  assert.equal(await groupKeylessWorks(repo, 250, { at: AT }), 1);
  assert.equal(repo.getBook(copy!.id)!.work_id, plain!.work_id);
  assert.equal(repo.getBook(plain!.id)!.work_id, plain!.work_id);
  assert.equal(repo.getBook(graphic.id)!.work_id, graphic.work_id);
});

test("groupTitleKeys groups only the keys it is given", () => {
  const { repo } = freshRepo();
  const dune = edition(repo, "9780000001101", "Dune", "Frank Herbert", "OL1W");
  const duneKeyless = edition(repo, "9780000001102", "Dune", "Frank Herbert");
  const emma = edition(repo, "9780000001103", "Emma", "Jane Austen", "OL2W");
  const emmaKeyless = edition(repo, "9780000001104", "Emma", "Jane Austen");
  const keyOf = (book: { id: string }) => repo.getBook(book.id)!.title_key!;
  assert.equal(repo.groupTitleKeys([keyOf(dune)], 10, AT), 1);
  assert.equal(repo.getBook(duneKeyless.id)!.work_id, dune.work_id);
  assert.equal(repo.getBook(emmaKeyless.id)!.work_id, emmaKeyless.work_id);
  assert.equal(repo.groupTitleKeys([], 10, AT), 0);
  assert.equal(repo.groupTitleKeys([keyOf(emma)], 10, AT), 1);
  assert.equal(repo.getBook(emmaKeyless.id)!.work_id, emma.work_id);
});

test("groupTitleKeys stops at its limit across the keys it is given, and the next call finishes the rest", () => {
  const { repo, key } = fourthWing();
  const dune = edition(repo, "9780000001201", "Dune", "Frank Herbert", "OL9W");
  edition(repo, "9780000001202", "Dune", "Frank Herbert", undefined, at(1));
  edition(repo, "9780000001203", "Dune", "Frank Herbert", undefined, at(2));
  const keys = [repo.getBook(dune.id)!.title_key!, key];
  assert.deepEqual([repo.groupTitleKeys(keys, 3, AT), repo.groupTitleKeys(keys, 3, AT), repo.groupTitleKeys(keys, 3, AT)], [3, 1, 0]);
});

test("groupTitleKeys leaves a pair apart when skip rejects it, and still makes another", () => {
  const { repo, novel, graphic, piatkus, graphicKeyless, key } = fourthWing();
  const seen: Array<[string, string]> = [];
  const skip = (from: string, into: string) => {
    seen.push([from, into]);
    return from === piatkus.work_id;
  };
  assert.equal(repo.groupTitleKeys([key], 10, AT, skip), 1);
  assert.equal(repo.getBook(piatkus.id)!.work_id, piatkus.work_id);
  assert.equal(repo.getBook(graphicKeyless.id)!.work_id, graphic.work_id);
  assert.deepEqual(seen, [[piatkus.work_id, novel.work_id], [graphicKeyless.work_id, graphic.work_id]]);
});

test("groupTitleKeys counts only the merges it makes against its limit when skip rejects a groupable pair", () => {
  const { repo } = freshRepo();
  const dune = edition(repo, "9780000001301", "Dune", "Frank Herbert", "OL9W", at(0));
  const first = edition(repo, "9780000001302", "Dune", "Frank Herbert", undefined, at(1));
  const second = edition(repo, "9780000001303", "Dune", "Frank Herbert", undefined, at(2));
  const key = repo.getBook(dune.id)!.title_key!;
  assert.equal(repo.groupTitleKeys([key], 1, AT, (from) => from === first.work_id), 1);
  assert.equal(repo.getBook(first.id)!.work_id, first.work_id);
  assert.equal(repo.getBook(second.id)!.work_id, dune.work_id);
});

test("groupKeylessWorks leaves a pair apart when skip rejects it, and makes it once skip stops rejecting", async () => {
  const { repo, novel, graphic, piatkus, graphicKeyless } = fourthWing();
  const skip = (from: string) => from === piatkus.work_id;
  assert.equal(await groupKeylessWorks(repo, 250, { at: AT, skip }), 1);
  assert.deepEqual([piatkus, graphicKeyless].map((book) => repo.getBook(book.id)!.work_id), [piatkus.work_id, graphic.work_id]);
  assert.equal(await groupKeylessWorks(repo, 250, { at: AT, skip }), 0);
  assert.equal(await groupKeylessWorks(repo, 250, { at: AT }), 1);
  assert.equal(repo.getBook(piatkus.id)!.work_id, novel.work_id);
});
