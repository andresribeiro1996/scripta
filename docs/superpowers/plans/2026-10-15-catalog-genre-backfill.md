# Catalog Genre Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Label the catalog's 76k genre-less works in one afternoon. Open Library subjects for seed works and publisher feed labels go first, both free. A bounded Jev pass covers publisher works left with a synopsis, and a catalog-scope genre-pass export hands Jev's doubts to Claude.

**Architecture:**
- **Seed and feed passes:** two owner-run passes reuse the existing seed and feed readers, behind `--fill-genres` flags on `seed-catalog.mjs` and `import-publisher-covers.mjs`. They write genres only to editions whose `genres` is `'[]'`, through one new repository method.
- **Jev backlog:** a third script runs the genre review plan's `classifyWork` over catalog works with a synopsis. Its hard request limit is `--max`, recorded under its own budget source.

**Tech Stack:** TypeScript, `node:sqlite`, Node scripts that import `backend/dist`, `node:test` through tsx.

**Spec:** `docs/superpowers/specs/2026-10-15-catalog-genre-backfill-design.md`

**Two phases, two PRs:**
- **Phase 1 (Tasks 1–4):** Portuguese rules, the source fill, the seed pass and the feed pass. They don't depend on the genre review plan or on a key. Build and ship them first.
- **Phase 2 (Tasks 5–6):** the Jev backlog pass and the catalog-scope export. They need `docs/superpowers/plans/2026-10-15-genre-review.md` merged first:
  - `classifyWork`, `GENRE_REJECTION_LIMIT` and `GENRE_SAVE_LINE` (its Task 5);
  - `spendTypesafe`, `TypesafeBudgetSpentError`, `failureKind` and `utcDay` (Tasks 1–2);
  - `genre_rejections` and judgments with `model` (Task 3);
  - `labelWork` and the export's manual skip (Task 6).

  Branch Phase 2 from `main` after both of those PRs merge.

## Global Constraints

- No comments in code (root `AGENTS.md`). The why goes in the commit message.
- Minimum code that works. Reuse `@scripta/shared` before writing a helper.
- Consumers read shared's `dist/`. Run `npm run build --workspace @scripta/shared` before any backend, frontend or mobile typecheck or test.
- A new backend `*.test.ts` file goes into the explicit list in `backend/package.json` `"test"`, or CI never runs it. Backend tests set the env preamble before `await import(...)`.
- Scripts import from `backend/dist`. The owner runs them in the production container over `railway ssh`; this plan never runs them against production.
- **Fill rule:**
  - The seed and feed passes write only to editions whose `genres` is `'[]'`, and set `genres_source = NULL` and `genres_confidence = NULL`.
  - They never overwrite any genre: source, Jev or manual.
  - They write to every edition of the matched canonical work.
  - A second run writes nothing new. `--dry-run` writes nothing.
- One transaction per chunk of at most 1,000 seed entries or 250 feed products, so the live server's writes aren't held up.
- Constants:
  - feed age labels map to Children's only for ages up to 12;
  - the backlog's minimum synopsis is 40 characters (`BACKLOG_MIN_SYNOPSIS`);
  - its budget source is `genres-backlog`;
  - it runs 4 requests in flight;
  - its estimated cost is $0.00012 per request (2026-10-14: $0.017 for 142).
- `PUBLISHERS` has 15 sites.
- The GitHub repo is public. No real reader names or library details anywhere.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage and commit in one command.
- Verify commands:
  - shared: `npm test --workspace @scripta/shared`
  - backend: `npm run typecheck --workspace backend && npm test --workspace backend`
  - mobile (rules): `npm run typecheck --workspace mobile && npm test --workspace mobile`

## Review Focus

1. **A subject or label never overwrites a genre an edition already has**, whether from a source, Jev or the owner. Pinned in Tasks 2, 3 and 4.
2. **Numbers in non-age labels never become Children's.** Examples: "+ 13 anos", "100 anos", "Guerra dos 30 anos". Pinned in Task 4.
3. **A feed product several catalog books share labels all of them.** The importer and the title fill both attach one product URL to more than one book. Pinned in Task 4.
4. **The backlog never sends more than `--max` requests**, retries and 4 workers included. Pinned in Task 5.
5. **Dry runs write nothing, and the backlog's dry run calls no TypeSafe at all.** Pinned in Tasks 3, 4 and 5.

---

## Phase 1

### Task 1: Portuguese romance and children's words

**Files:**
- Modify: `packages/shared/src/library/bookGenres.ts` (`RULES`)
- Test: `packages/shared/src/library/bookGenres.test.ts`

**Interfaces:**
- Produces: `normalizeBookGenres` maps "literatura romântica" to Romance, and "infantojuvenil" or "infanto-juvenil" to Children's.

- [ ] **Step 1: Write the failing test**

Append to `bookGenres.test.ts`:

```ts
test("Portuguese romantic literature and children's-and-youth labels", () => {
  assert.deepEqual(normalizeBookGenres(["Literatura Romântica"]), ["Romance"]);
  assert.deepEqual(normalizeBookGenres(["Literatura Romântica e Erótica"]), ["Romance"]);
  assert.deepEqual(normalizeBookGenres(["Infantojuvenil"]), ["Children's"]);
  assert.deepEqual(normalizeBookGenres(["Infanto-juvenil"]), ["Children's"]);
  assert.deepEqual(normalizeBookGenres(["Literatura juvenil"]), ["Young Adult"]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --workspace @scripta/shared`
Expected: FAIL on "Literatura Romântica" (today `[]`).

- [ ] **Step 3: Implement**

In `RULES`:
- Insert `["Children's", /\binfanto ?juvenil\b/],` right before the `["Young Adult", …]` rule.
- Change the Romance rule to `["Romance", /\bromance\b|\bliteratura romantica\b/],`.

- [ ] **Step 4: Run to verify**

Run: `npm test --workspace @scripta/shared && npm run build --workspace @scripta/shared && npm test --workspace mobile`
Expected: PASS, including "every canonical genre name normalizes to itself" and the existing Portuguese cases.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/library/bookGenres.ts packages/shared/src/library/bookGenres.test.ts && git commit -m "$(cat <<'EOF'
Map Portuguese romantic literature and infantojuvenil labels

Publisher feeds label romance novels "Literatura Romântica (e Erótica)"
and children's-and-youth books "Infantojuvenil"; both mapped to nothing.
The infanto-juvenil rule sits before the Young Adult rule so its
"juvenil" doesn't win.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

### Task 2: Repository lookups and the source fill

**Files:**
- Modify: `backend/src/modules/books/domain/ports.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Test: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`

**Interfaces:**
- Produces, repo:
  - `workIdsByWorkKeys(keys: string[]): Map<string, string>`, from a normalised Open Library work key (`OL…W`) to its canonical work id;
  - `listPublisherUrls(): Array<{ work_id: string | null; publisher_url: string }>`;
  - `fillSourceGenres(workId: string, genres: string[]): number`, the editions written under the fill rule.

- [ ] **Step 1: Write the failing tests**

Append to `sqliteBooksRepository.test.ts`. It already has `freshRepo`, `NOW`, `genreRow` and `titled`.

```ts
test("source genres fill only editions without genres, and repeat as a no-op", () => {
  const { db, repo } = freshRepo();
  const a = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593", workKey: "OL1W" }, ["isbn:9780441013593"], NOW);
  const b = repo.createBook({ title: "Duna", author: "Frank Herbert", isbn: "9789722345671", workKey: "OL1W" }, ["isbn:9789722345671"], NOW);
  const c = repo.createBook({ title: "Dune Messiah", author: "Frank Herbert", isbn: "9780441172696", workKey: "OL1W" }, ["isbn:9780441172696"], NOW);
  db.prepare("UPDATE books SET genres = ?, genres_source = 'manual' WHERE id = ?").run(JSON.stringify(["Classics"]), c.id);
  const work = a.work_id!;
  assert.equal(b.work_id, work);
  assert.equal(repo.fillSourceGenres(work, ["Science Fiction"]), 2);
  assert.deepEqual(genreRow(db, a.id), { genres: JSON.stringify(["Science Fiction"]), genres_source: null, genres_confidence: null });
  assert.deepEqual(genreRow(db, b.id), { genres: JSON.stringify(["Science Fiction"]), genres_source: null, genres_confidence: null });
  assert.deepEqual(genreRow(db, c.id), { genres: JSON.stringify(["Classics"]), genres_source: "manual", genres_confidence: null });
  assert.equal(repo.fillSourceGenres(work, ["Fantasy"]), 0);
});

test("work keys map to work ids, and publisher URLs list with their works", () => {
  const { repo } = freshRepo();
  const keyed = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593", workKey: "OL1W" }, ["isbn:9780441013593"], NOW);
  const shop = titled(repo, "Shop Book");
  repo.setPublisherUrl(shop.id, "https://shop.test/products/shop-book");
  assert.deepEqual(repo.workIdsByWorkKeys(["OL1W", "OL2W"]), new Map([["OL1W", keyed.work_id!]]));
  assert.deepEqual(repo.listPublisherUrls(), [{ work_id: shop.work_id, publisher_url: "https://shop.test/products/shop-book" }]);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run typecheck --workspace backend`
Expected: FAIL. The three repo methods don't exist.

- [ ] **Step 3: Implement**

1. **Port.** `domain/ports.ts`, after `editionGenres(...)`:

```ts
  workIdsByWorkKeys(keys: string[]): Map<string, string>;
  listPublisherUrls(): Array<{ work_id: string | null; publisher_url: string }>;
  fillSourceGenres(workId: string, genres: string[]): number;
```

2. **Statements.** `sqliteBooksRepository.ts`, after `editionGenresStmt`:

```ts
  const workIdsByKeysStmt = db.prepare(`SELECT ol_work_key AS key, COALESCE(merged_into, id) AS id FROM works WHERE ol_work_key IN (SELECT value FROM json_each(?))`);
  const publisherUrlsStmt = db.prepare(`SELECT work_id, publisher_url FROM books WHERE publisher_url IS NOT NULL ORDER BY created_at, rowid`);
  const fillSourceGenresStmt = db.prepare(`UPDATE books SET genres = ?, genres_source = NULL, genres_confidence = NULL WHERE work_id = ? AND genres = '[]'`);
```

3. **Methods.** In the returned object, after `editionGenres`:

```ts
    workIdsByWorkKeys(keys) {
      const rows = workIdsByKeysStmt.all(JSON.stringify(keys)) as Array<{ key: string; id: string }>;
      return new Map(rows.map((row) => [row.key, row.id]));
    },
    listPublisherUrls() {
      return publisherUrlsStmt.all() as Array<{ work_id: string | null; publisher_url: string }>;
    },
    fillSourceGenres(workId, genres) {
      return Number(fillSourceGenresStmt.run(JSON.stringify(genres), workId).changes);
    },
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm run build --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend`
Expected: PASS. If `createBook` doesn't group two editions with the same `workKey` into one work, read `createBook` in `sqliteBooksRepository.ts` and give the test the input it needs for one work (it must). Don't loosen the assertion.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/books/domain/ports.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts && git commit -m "$(cat <<'EOF'
Add the repository pieces for filling catalog genres from sources

fillSourceGenres writes a data source's genres only to editions that
have none, so a backfill can never overwrite Open Library, Jev or the
owner's genres and re-running it changes nothing. The seed pass finds
works by Open Library work key; the feed pass by the product URLs the
importer stored.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

### Task 3: The seed subjects pass

**Files:**
- Modify: `backend/src/modules/books/seed/rankedWorks.ts`. Keep every subject.
- Modify: `backend/src/modules/books/seed/rankedWorks.test.ts`
- Create: `backend/src/modules/books/seed/seedGenres.ts`
- Create: `backend/src/modules/books/seed/seedGenres.test.ts`. Add `src/modules/books/seed/seedGenres.test.ts` to `backend/package.json` `"test"`, after `src/modules/books/seed/seedCatalog.test.ts`.
- Modify: `backend/scripts/seed-catalog.mjs`. Add `--fill-genres` and `--dry-run`.
- Modify: `backend/README.md`. Add a "Catalog genre backfill" section after "Genre pass".

**Interfaces:**
- Consumes: `workIdsByWorkKeys`, `findBooksByKeys`, `editionGenres` and `fillSourceGenres` (Task 2); `normalizeWorkKey` (`domain/normalize.ts`); `canonicalIsbn` and `normalizeBookGenres` (`@scripta/shared`).
- Produces:
  - `type SeedGenresReport = { fetched: number; matched: number; labelled: number; editions: number; noGenre: number; unmatched: number }`
  - `fillSeedGenres(entries: SeedEntry[], repo, options: { dryRun: boolean }): SeedGenresReport`

- [ ] **Step 1: Write the failing tests**

Append to `rankedWorks.test.ts`:

```ts
test("a ranked work keeps every subject, as the details lookup reads them", () => {
  const subjects = Array.from({ length: 12 }, (_, index) => `Subject ${index}`);
  const [entry] = parseRankedWorks({ docs: [{ key: "/works/OL1W", title: "Dune", author_name: ["Frank Herbert"], subject: subjects, editions: { docs: [{ title: "Dune", isbn: ["9780441013593"], language: ["eng"] }] } }] }, "eng");
  assert.deepEqual(entry?.subjects, subjects);
});
```

`backend/src/modules/books/seed/seedGenres.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "seed-genres-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("../adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("../adapters/sqlite/sqliteBooksRepository.js");
const { fillSeedGenres } = await import("./seedGenres.js");

const AT = "2026-10-15T00:00:00.000Z";
const entry = (isbn: string, workKey: string, subjects: string[]) => ({ isbn, title: "T", author: "A", lang: "eng" as const, workKey, readers: 1, subjects, languages: [] });

function setup() {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  const repo = createSqliteBooksRepository(db);
  const book = (title: string, isbn: string, workKey?: string) => repo.createBook({ title, author: "A", isbn, workKey, createdBy: "seed" }, [`isbn:${isbn}`], AT);
  const genres = (id: string) => (db.prepare("SELECT genres, genres_source FROM books WHERE id = ?").get(id) as { genres: string; genres_source: string | null });
  return { db, repo, book, genres };
}

test("seed subjects label works found by work key or ISBN, once each", () => {
  const s = setup();
  const keyed = s.book("Dune", "9780441013593", "OL1W");
  const byIsbn = s.book("Emma", "9780141439587");
  const report = fillSeedGenres([
    entry("9780441013593", "/works/OL1W", ["Science fiction", "Large type books"]),
    entry("9780441013593", "/works/OL1W", ["Fantasy"]),
    entry("9780141439587", "/works/OL999W", ["Fiction, romance, general"]),
    entry("9780000000002", "/works/OL404W", ["Poetry"]),
    entry("9780441172696", "/works/OL404W", [])
  ], s.repo, { dryRun: false });
  assert.deepEqual(report, { fetched: 5, matched: 2, labelled: 2, editions: 2, noGenre: 0, unmatched: 2 });
  assert.deepEqual(s.genres(keyed.id), { genres: JSON.stringify(["Science Fiction"]), genres_source: null });
  assert.deepEqual(s.genres(byIsbn.id), { genres: JSON.stringify(["Romance"]), genres_source: null });
});

test("subjects that map to nothing are counted, and genres already present stay", () => {
  const s = setup();
  const bare = s.book("Notes", "9780000000019", "OL2W");
  const owned = s.book("Owned", "9780000000026", "OL3W");
  s.db.prepare("UPDATE books SET genres = ?, genres_source = 'jev', genres_confidence = 0.6 WHERE id = ?").run(JSON.stringify(["History"]), owned.id);
  const report = fillSeedGenres([entry("9780000000019", "/works/OL2W", ["Large type books"]), entry("9780000000026", "/works/OL3W", ["Poetry"])], s.repo, { dryRun: false });
  assert.deepEqual(report, { fetched: 2, matched: 2, labelled: 0, editions: 0, noGenre: 1, unmatched: 0 });
  assert.equal(s.genres(bare.id).genres, "[]");
  assert.deepEqual(s.genres(owned.id), { genres: JSON.stringify(["History"]), genres_source: "jev" });
});

test("a dry run writes nothing but counts what it would label, and a repeat labels nothing", () => {
  const s = setup();
  const dune = s.book("Dune", "9780441013593", "OL1W");
  const entries = [entry("9780441013593", "/works/OL1W", ["Science fiction"])];
  assert.deepEqual(fillSeedGenres(entries, s.repo, { dryRun: true }), { fetched: 1, matched: 1, labelled: 1, editions: 0, noGenre: 0, unmatched: 0 });
  assert.equal(s.genres(dune.id).genres, "[]");
  fillSeedGenres(entries, s.repo, { dryRun: false });
  assert.deepEqual(fillSeedGenres(entries, s.repo, { dryRun: false }), { fetched: 1, matched: 1, labelled: 0, editions: 0, noGenre: 0, unmatched: 0 });
});
```

Add the file to `backend/package.json` `"test"`.

- [ ] **Step 2: Run to verify they fail**

Run: `npm run typecheck --workspace backend`
Expected: FAIL with "Cannot find module './seedGenres.js'". The `rankedWorks` test fails on its 12 subjects.

- [ ] **Step 3: Implement**

1. **Ranked works.** `rankedWorks.ts`: delete `const MAX_SUBJECTS = 10;`. Change `subjects: strings(work.subject).slice(0, MAX_SUBJECTS),` to `subjects: strings(work.subject),`.

2. **Module.** `backend/src/modules/books/seed/seedGenres.ts`:

```ts
import { canonicalIsbn, normalizeBookGenres } from "@scripta/shared";
import { normalizeWorkKey } from "../domain/normalize.js";
import type { BooksRepository } from "../domain/ports.js";
import type { SeedEntry } from "./rankedWorks.js";

const CHUNK = 1000;

export type SeedGenresReport = { fetched: number; matched: number; labelled: number; editions: number; noGenre: number; unmatched: number };

const isbnKey = (entry: SeedEntry) => `isbn:${canonicalIsbn(entry.isbn)}`;

export function fillSeedGenres(
  entries: SeedEntry[],
  repo: Pick<BooksRepository, "workIdsByWorkKeys" | "findBooksByKeys" | "editionGenres" | "fillSourceGenres" | "transaction">,
  options: { dryRun: boolean }
): SeedGenresReport {
  const report: SeedGenresReport = { fetched: entries.length, matched: 0, labelled: 0, editions: 0, noGenre: 0, unmatched: 0 };
  const seen = new Set<string>();
  for (let start = 0; start < entries.length; start += CHUNK) {
    const chunk = entries.slice(start, start + CHUNK);
    const byWorkKey = repo.workIdsByWorkKeys(chunk.flatMap((entry) => normalizeWorkKey(entry.workKey) ?? []));
    const byIsbn = repo.findBooksByKeys(chunk.map(isbnKey));
    repo.transaction(() => {
      for (const entry of chunk) {
        const key = normalizeWorkKey(entry.workKey);
        const workId = (key ? byWorkKey.get(key) : undefined) ?? byIsbn.get(isbnKey(entry))?.work_id ?? null;
        if (!workId) {
          report.unmatched += 1;
          continue;
        }
        if (seen.has(workId)) continue;
        seen.add(workId);
        report.matched += 1;
        const genres = normalizeBookGenres(entry.subjects);
        if (genres.length === 0) {
          report.noGenre += 1;
          continue;
        }
        if (options.dryRun) {
          if (repo.editionGenres([workId]).length === 0) report.labelled += 1;
          continue;
        }
        const changed = repo.fillSourceGenres(workId, genres);
        if (changed > 0) {
          report.labelled += 1;
          report.editions += changed;
        }
      }
    });
  }
  return report;
}
```

3. **Script.** `backend/scripts/seed-catalog.mjs`:
   - Add `"fill-genres": { type: "boolean", default: false },` and `"dry-run": { type: "boolean", default: false }` to the `parseArgs` options.
   - Move the counts validation out of `seed()` into a function both callers use:

```js
function seedCounts() {
  const counts = { eng: Number(values.eng), por: Number(values.por) };
  for (const [flag, count] of Object.entries(counts)) {
    if (!Number.isFinite(count) || count < 0) {
      console.error(`--${flag} must be a non-negative number, got "${values[flag]}"`);
      process.exit(1);
    }
  }
  return counts;
}
```

   - `seed()` starts with `const counts = seedCounts();` in place of its old validation block.
   - Add:

```js
async function fillGenres() {
  const counts = seedCounts();
  const { collectRanked } = await import("../dist/modules/books/seed/fetchRankedWorks.js");
  const { mergeSeedLists } = await import("../dist/modules/books/seed/seedList.js");
  const { fillSeedGenres } = await import("../dist/modules/books/seed/seedGenres.js");
  const { openBooksDb } = await import("../dist/modules/books/adapters/sqlite/connection.js");
  const { createSqliteBooksRepository } = await import("../dist/modules/books/adapters/sqlite/sqliteBooksRepository.js");
  const merged = mergeSeedLists(await collectRanked("por", counts.por, log), await collectRanked("eng", counts.eng, log), counts);
  log(`list ready: ${merged.length} entries`);
  console.log(JSON.stringify(fillSeedGenres(merged, createSqliteBooksRepository(openBooksDb()), { dryRun: values["dry-run"] }), null, 2));
}
```

   - The last line becomes:

```js
if (values.status) printStatus();
else if (values["fill-genres"]) await fillGenres();
else await seed();
```

4. **README.** `backend/README.md`, a new `#### Catalog genre backfill` section after "Genre pass":

````markdown
#### Catalog genre backfill

One-off passes that label catalog works with no genres. Each writes only to editions whose genres are empty, never overwrites a genre, repeats as a no-op, and prints a JSON report. Run each with `--dry-run` first. Check the volume's free space first (`railway volume list --json`), and hold merges to `main` while a pass runs, because a deploy kills `railway ssh` jobs.

1. Seed subjects: re-reads the seed's Open Library lists (about 60–100 requests, one a second) and stores each work's subjects as genres. Use the same `--eng`/`--por` the catalog was seeded with (defaults 35000/15000).

   ```bash
   npx -y @railway/cli@latest ssh --project 404b0e4a-701b-47ea-83fc-a82a80ae5094 --environment 39833834-0e18-4dde-a57f-3bf0bf0bab51 --service scripta -- sh -c 'cd /app/backend && node scripts/seed-catalog.mjs --fill-genres --dry-run'
   ```
````

- [ ] **Step 4: Run to verify they pass**

Run: `npm run build --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend`
Expected: PASS. Then build and dry-run the script against a scratch database. This calls Open Library about 6 times with tiny counts and writes nothing:

```bash
npm run build --workspace backend && (cd backend && COVERS_DB_PATH=$(mktemp -d)/covers.sqlite AUTH_DB_PATH=$(mktemp -d)/auth.sqlite LIBRARY_DB_PATH=$(mktemp -d)/library.sqlite GALLERY_DB_PATH=$(mktemp -d)/gallery.sqlite JWT_ACCESS_SECRET=$(printf 'a%.0s' {1..64}) JWT_REFRESH_SECRET=$(printf 'b%.0s' {1..64}) node scripts/seed-catalog.mjs --fill-genres --dry-run --eng 5 --por 5 | tail -n 9)
```

Expected: a JSON report with `fetched` above 0 and `matched` 0 (empty catalog).

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/books/seed backend/scripts/seed-catalog.mjs backend/package.json backend/README.md && git commit -m "$(cat <<'EOF'
Fill seed works' genres from their Open Library subjects

The seed fetched every work's subjects and threw them away, so 56k
seeded works had no genres. seed-catalog.mjs --fill-genres re-reads the
same ranked lists (about a hundred requests) and stores the subjects
through the same rules the details lookup uses, only on editions with no
genres. Subjects are no longer cut at ten, matching the details lookup.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

### Task 4: The feed labels pass

**Files:**
- Modify: `backend/src/modules/books/seed/publisherFeed.ts`. Add `PublisherBook.labels`.
- Modify: `backend/src/modules/books/seed/publisherFeed.test.ts`
- Create: `backend/src/modules/books/seed/feedGenres.ts`
- Create: `backend/src/modules/books/seed/feedGenres.test.ts`. Add `src/modules/books/seed/feedGenres.test.ts` to `backend/package.json` `"test"`, after `src/modules/books/seed/fillBlankTitles.test.ts`.
- Modify: `backend/scripts/import-publisher-covers.mjs`. Add `--fill-genres`.
- Modify: `backend/README.md`. Add step 2 to "Catalog genre backfill".

**Interfaces:**
- Consumes: `listPublisherUrls`, `findBooksByKeys`, `editionGenres` and `fillSourceGenres` (Task 2); `readSiteFeed`, `createThrottle`, `SiteSkipped` and `ImportDeps` (`importPublisherCovers.ts`).
- Produces:
  - `PublisherBook.labels: string[]`: Shopify `tags` and `product_type`; WooCommerce `categories[].name` and `tags[].name`. They are trimmed, entity-decoded and non-empty.
  - `feedLabelGenres(labels: string[]): BookGenre[]`
  - `fillFeedGenres(deps, sites, options: { dryRun: boolean }): Promise<GenreFillReport>`, where:
    - `GenreFillReport = { sites: Record<string, GenreFillSiteReport>; unmatchedLabels: Array<[string, number]> }`
    - `GenreFillSiteReport = { products: number; matched: number; labelled: number; editions: number; skipped?: string }`

- [ ] **Step 1: Write the failing tests**

Append to `publisherFeed.test.ts`. Add `readFileSync` from `node:fs` and `parseShopifyProducts`, `parseWooProducts` to its imports if they aren't there.

```ts
test("products carry their tags, types and categories as labels", () => {
  const shop = { name: "Shop", origin: "https://shop.test", platform: "shopify" as const, authorFromVendor: false };
  const woo = { name: "Woo", origin: "https://woo.test", platform: "woocommerce" as const, authorFromVendor: false };
  const shopify = parseShopifyProducts(JSON.parse(readFileSync(new URL("./fixtures/shopify-products.json", import.meta.url), "utf8")), shop);
  assert.deepEqual(shopify.find((book) => book.title === "O Museu dos Esforços Inúteis")?.labels, ["américa latina", "Contos", "Livro"]);
  const wooBooks = parseWooProducts(JSON.parse(readFileSync(new URL("./fixtures/woo-products.json", import.meta.url), "utf8")), woo);
  assert.ok(wooBooks.some((book) => book.labels.length === 1 && book.labels[0] === "Ensaios"));
  const stringTags = parseShopifyProducts({ products: [{ title: "Tagged", handle: "tagged", product_type: "", tags: "Romance,  Policial ", variants: [], images: [{ src: "https://shop.test/files/9789722031240.jpg" }] }] }, shop);
  assert.deepEqual(stringTags[0]?.labels, ["Romance", "Policial"]);
});
```

If "O Museu dos Esforços Inúteis" isn't among the parsed Shopify books (the parser drops products without an image or handle), assert on another fixture product that has tags. Keep the expected labels in fixture order: tags, then `product_type`.

`backend/src/modules/books/seed/feedGenres.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "feed-genres-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("../adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("../adapters/sqlite/sqliteBooksRepository.js");
const { feedLabelGenres, fillFeedGenres } = await import("./feedGenres.js");

type Site = Parameters<typeof fillFeedGenres>[1][number];
const AT = "2026-10-15T00:00:00.000Z";
const SHOP: Site = { name: "Test Shop", origin: "https://shop.test", platform: "shopify", authorFromVendor: false };
const DOWN: Site = { name: "Down Shop", origin: "https://down.test", platform: "shopify", authorFromVendor: false };
const PAGE1 = "https://shop.test/products.json?limit=250&page=1";

function product(handle: string, isbn: string | null, tags: string[]) {
  return { title: handle, handle, vendor: "Test Shop", body_html: "", product_type: "Livro", tags, variants: [{ barcode: isbn ?? "", sku: "" }], images: [{ src: `https://shop.test/files/${handle}.jpg` }] };
}

function setup(feeds: Record<string, { status: number; text: string }>) {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  const repo = createSqliteBooksRepository(db);
  const deps = {
    repo,
    sleep: async () => {},
    fetchText: async (url: string) => feeds[url] ?? (url.endsWith("/robots.txt") ? { status: 404, text: "" } : { status: 200, text: JSON.stringify({ products: [] }) })
  };
  const book = (title: string, isbn: string, url: string | null) => {
    const row = repo.createBook({ title, author: "", isbn, createdBy: "publisher" }, [`isbn:${isbn}`], AT);
    if (url) repo.setPublisherUrl(row.id, url);
    return row.id;
  };
  const genres = (id: string) => (db.prepare("SELECT genres FROM books WHERE id = ?").get(id) as { genres: string }).genres;
  return { db, repo, deps, book, genres };
}

const page = (products: unknown[]) => ({ status: 200, text: JSON.stringify({ products }) });

test("age labels up to 12 and kids tags mean Children's; other numbers don't", () => {
  for (const label of ["+ 3 anos", "+3 anos", "3-5 anos", "10 - 12 anos", "tag_kids"]) assert.deepEqual(feedLabelGenres([label]), ["Children's"], label);
  for (const label of ["+ 13 anos", "100 anos", "Guerra dos 30 anos", "anos 80"]) assert.notDeepEqual(feedLabelGenres([label]), ["Children's"], label);
  assert.deepEqual(feedLabelGenres(["Policial", "Livro"]), ["Mystery"]);
  assert.deepEqual(feedLabelGenres(["Literatura Romântica e Erótica", "+ 6 anos"]), ["Romance", "Children's"]);
});

test("a product labels every book at its URL, else the book with its ISBN, only where genres are empty", () => {
  const h = setup({ [PAGE1]: page([product("hamlet", "9789896414672", ["Policial"]), product("orphan", "9789722031240", ["Poesia"]), product("kids", null, ["+ 3 anos"])]) });
  const first = h.book("Hamlet", "9789896414672", "https://shop.test/products/hamlet");
  const second = h.book("Hamlet 2", "9789896414689", "https://shop.test/products/hamlet");
  const byIsbn = h.book("Orphan", "9789722031240", null);
  const labelled = h.book("Kids", "9789722000000", "https://shop.test/products/kids");
  h.db.prepare("UPDATE books SET genres = ?, genres_source = 'manual' WHERE id = ?").run(JSON.stringify(["Fantasy"]), labelled);
  return fillFeedGenres(h.deps, [SHOP], { dryRun: false }).then((report) => {
    assert.deepEqual(report.sites["Test Shop"], { products: 3, matched: 3, labelled: 3, editions: 3 });
    assert.equal(h.genres(first), JSON.stringify(["Mystery"]));
    assert.equal(h.genres(second), JSON.stringify(["Mystery"]));
    assert.equal(h.genres(byIsbn), JSON.stringify(["Poetry"]));
    assert.equal(h.genres(labelled), JSON.stringify(["Fantasy"]));
  });
});

test("a dry run writes nothing, a repeat labels nothing, a down site is skipped, and unmatched labels are counted", async () => {
  const h = setup({ [PAGE1]: page([product("a", "9789896414672", ["Ensaio", "Policial"]), product("b", "9789896414689", ["Ensaio"])]), "https://down.test/products.json?limit=250&page=1": { status: 500, text: "" } });
  const a = h.book("A", "9789896414672", "https://shop.test/products/a");
  h.book("B", "9789896414689", "https://shop.test/products/b");
  const dry = await fillFeedGenres(h.deps, [SHOP, DOWN], { dryRun: true });
  assert.deepEqual(dry.sites["Test Shop"], { products: 2, matched: 2, labelled: 1, editions: 0 });
  assert.equal(dry.sites["Down Shop"]?.skipped, "feed answered HTTP 500");
  assert.deepEqual(dry.unmatchedLabels, [["Ensaio", 2], ["Livro", 2]]);
  assert.equal(h.genres(a), "[]");
  await fillFeedGenres(h.deps, [SHOP], { dryRun: false });
  assert.deepEqual((await fillFeedGenres(h.deps, [SHOP], { dryRun: false })).sites["Test Shop"], { products: 2, matched: 2, labelled: 0, editions: 0 });
});
```

Add the file to `backend/package.json` `"test"`.

- [ ] **Step 2: Run to verify they fail**

Run: `npm run typecheck --workspace backend`
Expected: FAIL. `PublisherBook.labels` and `./feedGenres.js` don't exist.

- [ ] **Step 3: Implement**

1. **Labels.** `publisherFeed.ts`:
   - Add `labels: string[];` to `PublisherBook`, after `details`.
   - Add the helper below near `items`:

```ts
function labelList(value: unknown): string[] {
  const raw = typeof value === "string" ? value.split(",") : items(value).map((entry) => (typeof entry === "string" ? entry : text(record(entry)?.name)));
  return raw.map((label) => decodeEntities(label).trim()).filter(Boolean);
}
```

   - In `parseShopifyProducts`, add `labels: [...labelList(product.tags), ...labelList(product.product_type)]` to the returned object.
   - In `parseWooProducts`, add `labels: [...labelList(product.categories), ...labelList(product.tags)]` to the returned object.

2. **Module.** `backend/src/modules/books/seed/feedGenres.ts`:

```ts
import { BOOK_GENRES, canonicalIsbn, normalizeBookGenres, type BookGenre } from "@scripta/shared";
import { SourceUnavailableError } from "../domain/errors.js";
import type { BooksRepository } from "../domain/ports.js";
import { createThrottle, readSiteFeed, SiteSkipped, type ImportDeps } from "./importPublisherCovers.js";
import type { PublisherSite } from "./publishers.js";

const CHUNK = 250;
const CENSUS_SIZE = 50;
const AGE = "(?:[1-9]|1[0-2])";
const FEED_LABEL_GENRES: Array<[BookGenre, RegExp]> = [
  ["Children's", new RegExp(`^\\+?\\s*${AGE}(?:\\s*-\\s*${AGE})?\\s*anos$`)],
  ["Children's", /^tag_kids$/]
];

export interface GenreFillSiteReport {
  products: number;
  matched: number;
  labelled: number;
  editions: number;
  skipped?: string;
}

export interface GenreFillReport {
  sites: Record<string, GenreFillSiteReport>;
  unmatchedLabels: Array<[string, number]>;
}

export function feedLabelGenres(labels: string[]): BookGenre[] {
  const found = new Set<BookGenre>();
  const rest: string[] = [];
  for (const label of labels) {
    const rule = FEED_LABEL_GENRES.find(([, pattern]) => pattern.test(label.trim().toLowerCase()));
    if (rule) found.add(rule[0]);
    else rest.push(label);
  }
  for (const genre of normalizeBookGenres(rest)) found.add(genre);
  return BOOK_GENRES.filter((genre) => found.has(genre));
}

export async function fillFeedGenres(
  deps: {
    fetchText: ImportDeps["fetchText"];
    sleep: (ms: number) => Promise<void>;
    repo: Pick<BooksRepository, "listPublisherUrls" | "findBooksByKeys" | "editionGenres" | "fillSourceGenres" | "transaction">;
  },
  sites: PublisherSite[],
  options: { dryRun: boolean }
): Promise<GenreFillReport> {
  const byUrl = new Map<string, Set<string>>();
  for (const row of deps.repo.listPublisherUrls()) {
    if (row.work_id) byUrl.set(row.publisher_url, (byUrl.get(row.publisher_url) ?? new Set()).add(row.work_id));
  }
  const unmatched = new Map<string, number>();
  const reports: Record<string, GenreFillSiteReport> = {};
  for (const site of sites) {
    const report: GenreFillSiteReport = { products: 0, matched: 0, labelled: 0, editions: 0 };
    reports[site.name] = report;
    try {
      const feed = await readSiteFeed(site, deps.fetchText, createThrottle(deps.sleep));
      report.products = feed.products;
      const isbnKey = (isbn: string) => `isbn:${canonicalIsbn(isbn)}`;
      const byIsbn = deps.repo.findBooksByKeys(feed.books.flatMap((book) => (book.isbn ? [isbnKey(book.isbn)] : [])));
      for (let start = 0; start < feed.books.length; start += CHUNK) {
        deps.repo.transaction(() => {
          for (const book of feed.books.slice(start, start + CHUNK)) {
            for (const label of book.labels) {
              if (feedLabelGenres([label]).length === 0) unmatched.set(label, (unmatched.get(label) ?? 0) + 1);
            }
            const byIsbnWork = book.isbn ? byIsbn.get(isbnKey(book.isbn))?.work_id : undefined;
            const workIds = byUrl.get(book.productUrl) ?? new Set(byIsbnWork ? [byIsbnWork] : []);
            if (workIds.size === 0) continue;
            report.matched += 1;
            const genres = feedLabelGenres(book.labels);
            if (genres.length === 0) continue;
            for (const workId of workIds) {
              if (options.dryRun) {
                if (deps.repo.editionGenres([workId]).length === 0) report.labelled += 1;
                continue;
              }
              const changed = deps.repo.fillSourceGenres(workId, genres);
              if (changed > 0) {
                report.labelled += 1;
                report.editions += changed;
              }
            }
          }
        });
      }
    } catch (error) {
      if (!(error instanceof SiteSkipped || error instanceof SourceUnavailableError)) throw error;
      report.skipped = error.message;
    }
  }
  const unmatchedLabels = [...unmatched].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, CENSUS_SIZE);
  return { sites: reports, unmatchedLabels };
}
```

3. **Script.** `backend/scripts/import-publisher-covers.mjs`:
   - Add `"fill-genres": { type: "boolean", default: false }` to the `parseArgs` options.
   - Add `const { fillFeedGenres } = await import("../dist/modules/books/seed/feedGenres.js");` beside the `fillBlankTitles` import.
   - After the `if (values["fill-titles"]) { … }` block, insert:

```js
} else if (values["fill-genres"]) {
  const report = await fillFeedGenres(
    { fetchText, sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)), repo: createSqliteBooksRepository(openBooksDb()) },
    sites,
    { dryRun: values["dry-run"] }
  );
  console.log(JSON.stringify(report, null, 2));
```

     The existing `} else {` that runs the cover import follows it.

4. **README.** Add step 2 to "Catalog genre backfill":

````markdown
2. Feed labels: re-reads the 15 publisher feeds (robots.txt respected, the importer's throttle) and stores each product's tags and categories as genres on the books at its URL, else its ISBN. The dry run's `unmatchedLabels` is the census: review it and add any real genre words to the Portuguese rules or `FEED_LABEL_GENRES` before the real run.

   ```bash
   npx -y @railway/cli@latest ssh --project 404b0e4a-701b-47ea-83fc-a82a80ae5094 --environment 39833834-0e18-4dde-a57f-3bf0bf0bab51 --service scripta -- sh -c 'cd /app/backend && node scripts/import-publisher-covers.mjs --fill-genres --dry-run'
   ```
````

- [ ] **Step 4: Run to verify they pass**

Run: `npm run build --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend`
Expected: PASS, including the existing `publisherFeed`, `importPublisherCovers` and `fillBlankTitles` tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/books/seed backend/scripts/import-publisher-covers.mjs backend/package.json backend/README.md && git commit -m "$(cat <<'EOF'
Fill publisher works' genres from their feed tags and categories

The 15 publisher feeds label their books (Policial, Poesia, Literatura
Romântica, + 3 anos…) and the importer dropped those labels. The feed
pass reads them, maps them through the genre rules plus a few feed-only
labels (age ranges up to 12, tag_kids), and labels every book at the
product's URL, else its ISBN, only where genres are empty. The dry run
prints a census of unmatched labels to grow the rules from.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

### Phase 1 wrap-up

- [ ] Run every verify command in Global Constraints. All must pass.
- [ ] Dispatch `branch-reviewer` with this plan and the spec.
- [ ] Ship Phase 1 with the `ship` skill: push, PR, `--auto`. After it deploys, the owner runs the seed and feed dry runs, then the real runs, from the README.

---

## Phase 2

Start a new branch from `main` once this plan's Phase 1 and the genre review plan have both merged.

### Task 5: The Jev backlog pass

**Files:**
- Modify: `backend/src/modules/books/typesafe.ts`. Add `runBudget`.
- Modify: `backend/src/modules/books/domain/ports.ts` and `adapters/sqlite/sqliteBooksRepository.ts`. Add `genreBacklogWorks`.
- Create: `backend/src/modules/books/genreBacklog.ts`
- Create: `backend/src/modules/books/genreBacklog.test.ts`. Add `src/modules/books/genreBacklog.test.ts` to `backend/package.json` `"test"`, after `src/modules/books/genreReview.test.ts`.
- Create: `backend/scripts/genre-backlog.mjs`
- Modify: `backend/README.md`. Add step 3 to "Catalog genre backfill".

**Interfaces:**
- Consumes, from the genre review plan:
  - `classifyWork(deps: GenreJudgmentDeps, workId): Promise<number | null>`
  - `GenreJudgmentDeps = { repo; classify; now; alert }`
  - `GENRE_REJECTION_LIMIT`
  - `failureKind`, `FailureKind`, `TypesafeBudgetSpentError`, `utcDay`, `Spend`
  - `spendTypesafe` and `typesafeUsage`
  - `genreJudgments` (with `model`) and `genreRejections`
- Produces:
  - `runBudget(repo, source: string, max: number, now: () => number): { spend: Spend; used: () => number }`
  - repo `genreBacklogWorks(limit: number, minSynopsis: number, rejectionLimit: number): string[]`
  - `GENRE_BACKLOG_SOURCE = "genres-backlog"` and `BACKLOG_MIN_SYNOPSIS = 40`
  - `backlogWorkIds(repo, heldWorkIds: string[], max: number): string[]`
  - `runGenreBacklog(deps: GenreJudgmentDeps, workIds: string[]): Promise<{ asked: string[]; stoppedBy: "done" | "budget" | "outage" | "key" }>`
  - `backlogReport(repo, selected: number, result, requests: number): BacklogReport`

- [ ] **Step 1: Write the failing tests**

`backend/src/modules/books/genreBacklog.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "books-genre-backlog-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("./adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("./adapters/sqlite/sqliteBooksRepository.js");
const { SourceUnavailableError } = await import("./domain/errors.js");
const { backlogReport, backlogWorkIds, GENRE_BACKLOG_SOURCE, runGenreBacklog } = await import("./genreBacklog.js");
const { runBudget } = await import("./typesafe.js");

const AT = "2026-10-15T00:00:00.000Z";
const NOW = () => Date.parse(AT);
const SYNOPSIS = "A long enough synopsis for Jev to read properly.";

function seeded(titles: string[], synopsis: string | null = SYNOPSIS) {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  const repo = createSqliteBooksRepository(db);
  const books = titles.map((title, index) => repo.createBook({ title, author: "A", isbn: null }, [`ta:${title.toLowerCase()}|a|`], `2026-10-0${index + 1}T00:00:00.000Z`));
  if (synopsis) db.prepare("UPDATE books SET summary = ?").run(synopsis);
  return { db, repo, work: (title: string) => books[titles.indexOf(title)]!.work_id! };
}

test("the backlog picks works with a synopsis, no genres, no judgment and under three strikes, held first then oldest", () => {
  const s = seeded(["Old", "Held", "Short", "Genred", "Judged", "Struck"]);
  s.db.prepare("UPDATE books SET summary = 'Too short.' WHERE work_id = ?").run(s.work("Short"));
  s.db.prepare("UPDATE books SET genres = ? WHERE work_id = ?").run(JSON.stringify(["Poetry"]), s.work("Genred"));
  s.repo.saveGenreJudgment({ workId: s.work("Judged"), model: "jev-1.13.0", genre: null, confidence: 0.9, askedAt: AT });
  for (let strike = 0; strike < 3; strike++) s.repo.recordGenreRejection({ workId: s.work("Struck"), status: 400, reason: "HTTP 400", at: AT });
  assert.deepEqual(backlogWorkIds(s.repo, [s.work("Held")], 10), [s.work("Held"), s.work("Old")]);
  assert.deepEqual(backlogWorkIds(s.repo, [], 1), [s.work("Old")]);
});

test("the run stops at exactly --max requests, retries included, and records them under its own source", async () => {
  const s = seeded(["W1", "W2", "W3", "W4", "W5", "W6"]);
  const budget = runBudget(s.repo, GENRE_BACKLOG_SOURCE, 5, NOW);
  let calls = 0;
  const classify = async () => {
    budget.spend();
    calls += 1;
    if (calls % 2 === 1) budget.spend();
    return { genre: "History" as const, confidence: 0.9, model: "jev-1.13.0" };
  };
  const result = await runGenreBacklog({ repo: s.repo, classify, now: NOW, alert: () => {} }, backlogWorkIds(s.repo, [], 10));
  assert.equal(budget.used(), 5);
  assert.equal(result.stoppedBy, "budget");
  assert.equal(s.repo.typesafeUsage("2026-10-15", GENRE_BACKLOG_SOURCE), 5);
  assert.equal(s.repo.typesafeUsage("2026-10-15", "genres"), 0);
});

test("an outage or a rejected key ends the run and stores nothing for the failed work", async () => {
  for (const [code, stop] of [[529, "outage"], [401, "key"]] as const) {
    const s = seeded(["Only"]);
    const alerts: string[] = [];
    const failing = async () => { throw new SourceUnavailableError("typesafe", `HTTP ${code}`, { status: code }); };
    const result = await runGenreBacklog({ repo: s.repo, classify: failing, now: NOW, alert: (subject) => { alerts.push(subject); } }, [s.work("Only")]);
    assert.equal(result.stoppedBy, stop);
    assert.deepEqual(result.asked, []);
    assert.equal(s.repo.genreJudgments([s.work("Only")]).size, 0);
    assert.equal(alerts.length, stop === "key" ? 1 : 0);
  }
});

test("the report bins the answers and counts strikes, requests and cost", async () => {
  const s = seeded(["Sure", "Maybe", "Unsure", "None", "Rejected"]);
  const answers: Record<string, { genre: "History" | null; confidence: number }> = { Sure: { genre: "History", confidence: 0.9 }, Maybe: { genre: "History", confidence: 0.6 }, Unsure: { genre: "History", confidence: 0.3 }, None: { genre: null, confidence: 0.95 } };
  const classify = async (book: { title: string }) => {
    if (book.title === "Rejected") throw new SourceUnavailableError("typesafe", "HTTP 400", { status: 400 });
    return { ...answers[book.title]!, model: "jev-1.13.0" };
  };
  const workIds = backlogWorkIds(s.repo, [], 10);
  const result = await runGenreBacklog({ repo: s.repo, classify, now: NOW, alert: () => {} }, workIds);
  assert.deepEqual(backlogReport(s.repo, workIds.length, result, 5), { selected: 5, asked: 5, confident: 1, possible: 1, unsure: 1, none: 1, strikes: 1, stoppedBy: "done", requests: 5, estimatedCostUsd: 0 });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run typecheck --workspace backend`
Expected: FAIL with "Cannot find module './genreBacklog.js'". `runBudget` and `genreBacklogWorks` don't exist.

- [ ] **Step 3: Implement**

1. **Budget.** `typesafe.ts`, append:

```ts
export function runBudget(repo: Pick<BooksRepository, "spendTypesafe">, source: string, max: number, now: () => number): { spend: Spend; used: () => number } {
  let used = 0;
  return {
    spend: () => {
      if (used >= max) throw new TypesafeBudgetSpentError(source);
      used += 1;
      repo.spendTypesafe(utcDay(now()), source, Number.MAX_SAFE_INTEGER);
    },
    used: () => used
  };
}
```

2. **Selection.**
   - `domain/ports.ts`: add `genreBacklogWorks(limit: number, minSynopsis: number, rejectionLimit: number): string[];` after `fillSourceGenres(...)`.
   - `sqliteBooksRepository.ts`, statement:

```ts
  const genreBacklogStmt = db.prepare(`
    SELECT w.id FROM works w
    WHERE w.merged_into IS NULL
      AND NOT EXISTS (SELECT 1 FROM books b WHERE b.work_id = w.id AND b.genres <> '[]')
      AND NOT EXISTS (SELECT 1 FROM genre_judgments j WHERE j.work_id = w.id)
      AND NOT EXISTS (SELECT 1 FROM genre_rejections r WHERE r.work_id = w.id AND r.attempts >= ?)
      AND (length(trim(coalesce(w.summary, ''))) >= ? OR EXISTS (SELECT 1 FROM books b WHERE b.work_id = w.id AND length(trim(coalesce(b.summary, ''))) >= ?))
    ORDER BY w.created_at, w.rowid
    LIMIT ?
  `);
```

   - Method:

```ts
    genreBacklogWorks(limit, minSynopsis, rejectionLimit) {
      return (genreBacklogStmt.all(rejectionLimit, minSynopsis, minSynopsis, limit) as Array<{ id: string }>).map((row) => row.id);
    },
```

3. **Module.** `backend/src/modules/books/genreBacklog.ts`:

```ts
import type { ClassifyGenre } from "./adapters/typesafe/jevGenres.js";
import type { BooksRepository } from "./domain/ports.js";
import { classifyWork, GENRE_REJECTION_LIMIT, type GenreJudgmentDeps } from "./genreJudgments.js";
import { failureKind, type FailureKind } from "./typesafe.js";

export const GENRE_BACKLOG_SOURCE = "genres-backlog";
export const BACKLOG_MIN_SYNOPSIS = 40;
const IN_FLIGHT = 4;
const CONFIDENT = 0.8;
const SAVE = 0.5;
const COST_PER_REQUEST_USD = 0.00012;

export type BacklogStop = "done" | "budget" | "outage" | "key";
export type BacklogResult = { asked: string[]; stoppedBy: BacklogStop };
export type BacklogReport = { selected: number; asked: number; confident: number; possible: number; unsure: number; none: number; strikes: number; stoppedBy: BacklogStop; requests: number; estimatedCostUsd: number };

export function backlogWorkIds(repo: Pick<BooksRepository, "canonicalWorkIds" | "genreBacklogWorks">, heldWorkIds: string[], max: number): string[] {
  const held = new Set(repo.canonicalWorkIds(heldWorkIds).values());
  const candidates = repo.genreBacklogWorks(Number.MAX_SAFE_INTEGER, BACKLOG_MIN_SYNOPSIS, GENRE_REJECTION_LIMIT);
  return [...candidates.filter((id) => held.has(id)), ...candidates.filter((id) => !held.has(id))].slice(0, max);
}

export async function runGenreBacklog(deps: GenreJudgmentDeps, workIds: string[]): Promise<BacklogResult> {
  let lastFailure: FailureKind | null = null;
  const classify: ClassifyGenre = async (book) => {
    try {
      return await deps.classify(book);
    } catch (error) {
      lastFailure = failureKind(error);
      throw error;
    }
  };
  const asked: string[] = [];
  let stoppedBy: BacklogStop = "done";
  let next = 0;
  const worker = async () => {
    while (stoppedBy === "done" && next < workIds.length) {
      const workId = workIds[next++]!;
      const pause = await classifyWork({ ...deps, classify }, workId);
      if (pause === null) asked.push(workId);
      else if (stoppedBy === "done") stoppedBy = lastFailure === "budget" || lastFailure === "key" ? lastFailure : "outage";
    }
  };
  await Promise.all(Array.from({ length: IN_FLIGHT }, worker));
  return { asked, stoppedBy };
}

export function backlogReport(repo: Pick<BooksRepository, "genreJudgments" | "genreRejections">, selected: number, result: BacklogResult, requests: number): BacklogReport {
  const report: BacklogReport = { selected, asked: result.asked.length, confident: 0, possible: 0, unsure: 0, none: 0, strikes: repo.genreRejections(result.asked).size, stoppedBy: result.stoppedBy, requests, estimatedCostUsd: Number((requests * COST_PER_REQUEST_USD).toFixed(2)) };
  for (const judgment of repo.genreJudgments(result.asked).values()) {
    if (judgment.genre === null) report.none += 1;
    else if (judgment.confidence >= CONFIDENT) report.confident += 1;
    else if (judgment.confidence >= SAVE) report.possible += 1;
    else report.unsure += 1;
  }
  return report;
}
```

4. **Script.** `backend/scripts/genre-backlog.mjs`:

```js
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { max: { type: "string" }, "dry-run": { type: "boolean", default: false } } });
const max = Number(values.max);
if (!Number.isInteger(max) || max <= 0) {
  console.error("Usage: node scripts/genre-backlog.mjs --max N [--dry-run]");
  process.exit(1);
}
for (const name of ["COVERS_DB_PATH", "LIBRARY_DB_PATH"]) {
  if (!process.env[name]) {
    console.error(`Missing environment variable: ${name}`);
    process.exit(1);
  }
}
if (!values["dry-run"] && !process.env.TYPESAFE_API_KEY) {
  console.error("TYPESAFE_API_KEY is not set.");
  process.exit(1);
}

const { openBooksDb } = await import("../dist/modules/books/adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("../dist/modules/books/adapters/sqlite/sqliteBooksRepository.js");
const { createWorkHolders } = await import("../dist/modules/library/workHolders.js");
const { backlogReport, backlogWorkIds, GENRE_BACKLOG_SOURCE, runGenreBacklog } = await import("../dist/modules/books/genreBacklog.js");

const repo = createSqliteBooksRepository(openBooksDb());
const held = createWorkHolders(new DatabaseSync(process.env.LIBRARY_DB_PATH, { readOnly: true })).heldWorks().map((work) => work.workId);

if (values["dry-run"]) {
  const qualifying = backlogWorkIds(repo, held, Number.MAX_SAFE_INTEGER).length;
  console.log(JSON.stringify({ qualifying, wouldAsk: Math.min(qualifying, max), max }, null, 2));
} else {
  const { createJevGenreClassifier } = await import("../dist/modules/books/adapters/typesafe/jevGenres.js");
  const { runBudget } = await import("../dist/modules/books/typesafe.js");
  const workIds = backlogWorkIds(repo, held, max);
  const budget = runBudget(repo, GENRE_BACKLOG_SOURCE, max, Date.now);
  const result = await runGenreBacklog(
    { repo, classify: createJevGenreClassifier(process.env.TYPESAFE_API_KEY, budget.spend), now: Date.now, alert: (subject, text) => console.error(`${subject}: ${text}`) },
    workIds
  );
  console.log(JSON.stringify(backlogReport(repo, workIds.length, result, budget.used()), null, 2));
}
```

5. **README.** Add step 3 to "Catalog genre backfill":

````markdown
3. Jev backlog (needs `TYPESAFE_API_KEY`): classifies catalog works with no genres and a synopsis of at least 40 characters, held works first. `--max` is a hard limit on TypeSafe requests, retries included, recorded under `genres-backlog` in `typesafe_usage` (the daily `genres` budget is untouched). An outage or a rejected key ends the run; re-running continues where it stopped. About 0.24 s per request at 4 in flight, about $0.00012 a request.

   ```bash
   npx -y @railway/cli@latest ssh --project 404b0e4a-701b-47ea-83fc-a82a80ae5094 --environment 39833834-0e18-4dde-a57f-3bf0bf0bab51 --service scripta -- sh -c 'cd /app/backend && node scripts/genre-backlog.mjs --max 12000 --dry-run'
   ```
````

- [ ] **Step 4: Run to verify they pass**

Run: `npm run build --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend`
Expected: PASS. Then dry-run the script against scratch databases. It calls no TypeSafe and needs no key:

```bash
npm run build --workspace backend && (cd backend && D=$(mktemp -d) && COVERS_DB_PATH=$D/covers.sqlite AUTH_DB_PATH=$D/auth.sqlite LIBRARY_DB_PATH=$D/library.sqlite GALLERY_DB_PATH=$D/gallery.sqlite JWT_ACCESS_SECRET=$(printf 'a%.0s' {1..64}) JWT_REFRESH_SECRET=$(printf 'b%.0s' {1..64}) node scripts/genre-backlog.mjs --max 10 --dry-run)
```

Expected: `{ "qualifying": 0, "wouldAsk": 0, "max": 10 }`. If the library database isn't created by opening it read-only, create it first with the library migrations the way `genre-pass-export.mjs`'s smoke run did, and report what you did.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/books backend/scripts/genre-backlog.mjs backend/package.json backend/README.md && git commit -m "$(cat <<'EOF'
Add the Jev backlog pass for catalog works with a synopsis

About 10k publisher works keep no genres after the free passes, nearly
all with a synopsis. genre-backlog.mjs classifies them through the same
classifyWork as the queue (answers stored and applied, strikes, no
overwrite), at 4 in flight, with --max as a hard request limit recorded
under its own budget source so the daily import budget is untouched. An
outage or a rejected key ends the run; the report bins the answers.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

### Task 6: The catalog-scope genre-pass export

**Files:**
- Modify: `backend/src/modules/books/domain/ports.ts` and `adapters/sqlite/sqliteBooksRepository.ts`. Add `jevJudgedWorkIds`.
- Modify: `backend/src/modules/books/genrePass.ts`. Add `catalogDoubtsWith`.
- Modify: `backend/src/modules/books/genrePass.test.ts`
- Modify: `backend/scripts/genre-pass-export.mjs`. Add `--scope held|catalog`.
- Modify: `backend/README.md`. Add step 4 to "Catalog genre backfill".

**Interfaces:**
- Produces:
  - repo `jevJudgedWorkIds(): string[]`, the works with a non-manual judgment;
  - `catalogDoubtsWith(books, held: HeldWork[]): GenrePassWork[]`: works Jev judged, held or not, whose genres are empty or only possible. Rows carry holders from `held` (0 when not held).

- [ ] **Step 1: Write the failing test**

Append to `genrePass.test.ts`, and add `catalogDoubtsWith` to the `./genrePass.js` import:

```ts
test("the catalog scope lists every work Jev doubted, held or not, and nothing Jev hasn't judged", () => {
  const { db, repo, blank, tagged, other } = seeded();
  const judge = (workId: string, genre: string | null, confidence: number) => {
    repo.saveGenreJudgment({ workId, model: "jev-1.13.0", genre, confidence, askedAt: "2026-10-15T00:00:00.000Z" });
    repo.applyGenreJudgments(0.5);
  };
  db.prepare("UPDATE books SET genres = '[]' WHERE work_id = ?").run(tagged);
  judge(blank, null, 0.9);
  judge(tagged, "History", 0.6);
  judge(other, "Poetry", 0.95);
  const rows = catalogDoubtsWith(repo, [{ workId: blank, holders: 2, finished: true }]);
  assert.deepEqual(rows.map((entry) => [entry.workId, entry.holders, entry.jev]), [
    [blank, 2, { genre: null, confidence: 0.9 }],
    [tagged, 0, { genre: "History", confidence: 0.6 }]
  ]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run typecheck --workspace backend`
Expected: FAIL. `catalogDoubtsWith` and `jevJudgedWorkIds` don't exist.

- [ ] **Step 3: Implement**

1. **Repo.**
   - Port: `jevJudgedWorkIds(): string[];`, after `genreBacklogWorks(...)`.
   - Statement: `const jevJudgedStmt = db.prepare(\`SELECT work_id FROM genre_judgments WHERE model <> 'manual'\`);`
   - Method:

```ts
    jevJudgedWorkIds() {
      return (jevJudgedStmt.all() as Array<{ work_id: string }>).map((row) => row.work_id);
    },
```

2. **Module.** `genrePass.ts`, after `genrePassWorksWith`:

```ts
export function catalogDoubtsWith(books: BooksRepository, held: HeldWork[]): GenrePassWork[] {
  const judged = new Set(books.jevJudgedWorkIds());
  const canonical = books.canonicalWorkIds(held.map((work) => work.workId));
  const heldJudged = held.filter((work) => judged.has(canonical.get(work.workId) ?? ""));
  const heldIds = new Set(heldJudged.map((work) => canonical.get(work.workId)));
  const others = [...judged].filter((workId) => !heldIds.has(workId)).map((workId) => ({ workId, holders: 0, finished: false }));
  return genrePassWorksWith(books, [...heldJudged, ...others]);
}
```

3. **Script.** `genre-pass-export.mjs`:
   - Add `import { parseArgs } from "node:util";` and `const { values } = parseArgs({ options: { scope: { type: "string", default: "held" } } });`.
   - Exit with an error unless `values.scope` is `held` or `catalog`.
   - Import `catalogDoubtsWith` alongside `genrePassWorksWith`.
   - The printed rows become `values.scope === "catalog" ? catalogDoubtsWith(books, held) : genrePassWorksWith(books, held)`.

4. **README.** Add step 4 to "Catalog genre backfill":

````markdown
4. Claude doubts pass: export Jev's doubts across the catalog, label them as in "Genre pass" (Sonnet subagents, at most 100 works each; Haiku subagents produced unusable labels on long batches), and import.

   ```bash
   npx -y @railway/cli@latest ssh --project 404b0e4a-701b-47ea-83fc-a82a80ae5094 --environment 39833834-0e18-4dde-a57f-3bf0bf0bab51 --service scripta -- sh -c 'cd /app/backend && node scripts/genre-pass-export.mjs --scope catalog' > genre-doubts.txt
   ```
````

- [ ] **Step 4: Run to verify they pass**

Run: `npm run build --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/books backend/scripts/genre-pass-export.mjs backend/README.md && git commit -m "$(cat <<'EOF'
Export Jev's doubts across the whole catalog for a Claude pass

The genre pass exported only works a library holds; after the backlog
pass most of Jev's "none", below-0.5 and possible-only answers are on
works nobody holds yet. --scope catalog lists every work Jev judged that
still has no confident genre, with holders where a library has it, so
Claude can label them in batches and the existing import writes them.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

### Phase 2 wrap-up

- [ ] Run every verify command in Global Constraints. All must pass.
- [ ] Dispatch `branch-reviewer` with this plan and the spec.
- [ ] Ship Phase 2 with the `ship` skill: push, PR, `--auto`. After it deploys and the owner sets `TYPESAFE_API_KEY`, the owner runs the backlog dry run, then the backlog, then the catalog-scope export for Claude.
