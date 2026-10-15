# Translation Grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Portuguese edition that sits in a work of its own joins its original's work, so the edition strip, readers and genres join up. For example, *Passeio ao Farol* joins *To the Lighthouse*. Code decides first and Jev decides the rest. Doubts go to an admin review page, and every merge this feature makes can be undone.

**Architecture:**
- **Original titles:** `books.original_title` comes from the publisher feed's "Título original", or from the stored summary text.
- **Candidates (code):** works with an edition whose title equals the original title, and works by the same first author that have a non-Portuguese edition.
- **The code match:** one title candidate whose author's surname the Portuguese work names.
- **Jev:** one multiple-choice question over up to 40 candidates plus "none". Confidence 0.9 or more merges, and 0.5 up to 0.9 goes to review.
- **Merging safely:**
  - Keyed works may merge through `mergeTranslation`.
  - Lookups by Open Library key follow `merged_into`.
  - A translation merge doesn't carry the summary.
  - An arena holding both works blocks the merge.
  - Every merge is recorded in `work_merges`.
  - Genre rows follow the merge.
  - Undo reverses a translation merge.
- **Triggers:** a queue fed by `onDetailsChecked` for held Portuguese books, a daily sweep, and an owner-run backlog script.

**Tech Stack:** TypeScript, `node:sqlite`, Fastify + zod, React + TanStack Query, `node:test` through tsx.

**Spec:** `docs/superpowers/specs/2026-10-15-synopsis-quality-and-translations-design.md`: part B, plus the translation halves of C and D.
- This plan builds on the synopsis plan (`2026-10-15-synopsis-quality.md`) and reuses:
  - `jev_rejections`, `JEV_REJECTION_LIMIT` and `askJev`;
  - the work page's own-edition-first order;
  - the calibration scripts;
  - `AdminLinks`' list of links.
- Both genre plans must be merged before it.

## Before you start

1. **The synopsis plan, and therefore both genre plans, must be merged to `main`.** From the repo root of a fresh worktree off `origin/main`, run:

   ```bash
   rg -n "export async function askJev|export const JEV_REJECTION_LIMIT|recordJevRejection|export function strikeReason|export const TASKS|const LINKS|onDetailsChecked: \(book\)" backend/src frontend/src
   ```

   - Expected: a hit for each.
   - If any is missing, stop.
   - If a name exists with another signature, use the real one and say so in that task's commit message.
2. **The backfill plan's Phase 1 edits `seed/publisherFeed.ts`.** Read the current `parseShopifyProducts`, `wooDetails` and `withPageText` before Task 1, and keep its changes.
3. **Install dependencies:** `npm install`, then `npm run build --workspace @scripta/shared`.

## Global Constraints

- **Code style:**
  - No comments in code (root `AGENTS.md`). The why goes in the commit message.
  - Minimum code that works. Reuse the title helpers in `@scripta/shared` (`normalizeTitle`, `titleNumbers`, `firstAuthor`, `normalizeWords`) and the synopsis plan's Jev pieces.
- **Running and adding tests:**
  - Run `npm run build --workspace @scripta/shared` before any backend or frontend typecheck or test.
  - A new backend `*.test.ts` file goes into the explicit list in `backend/package.json` `"test"`. Frontend `scripts/test-*.mts` and shared `src/**/*.test.ts` files are globbed.
  - Backend tests that reach `connection.js` or `config/env` set the env preamble before `await import(...)`.
- **TypeSafe and privacy:**
  - TypeSafe is never called without `TYPESAFE_API_KEY`. Tests stub `fetch` or the classifier.
  - The repo is public. No real reader names or library details.
- **Constants, verbatim from the spec:**
  - `MATCH_MERGE_AT = 0.9`, `MATCH_REVIEW_AT = 0.5`, at most 40 candidates (`MAX_CANDIDATES`).
  - A work is Portuguese when all its editions have `language` `pt`, `pt-PT` or `pt-BR`. A NULL language is not Portuguese.
  - The main title is the text before the first `" — "`, `" – "`, `" - "` or `". "`. Titles are compared with `normalizeTitle` plus `titleNumbers`.
  - The surname is the last word of three or more letters in a first author, accents removed, matched as a whole word.
  - The description sent to Jev is cut to 500 characters.
  - Budget sources: `works` at 1,000 a day (`WORK_MATCH_DAILY_BUDGET`), and `works-backlog` limited by the run's `--max`.
  - Strikes: task `works`, `JEV_REJECTION_LIMIT = 3`.
  - Requests: 4 in flight.
  - Pauses: next UTC midnight, 10 minutes, or 24 hours, as in the synopsis plan.
  - `--recheck-none` re-asks non-manual "none" answers older than 30 days.
  - The review list holds at most 200 items.
  - The question wording is the spec's Appendix A ("Matching, choice"), verbatim.
- **Commits:** messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage and commit in one command.
- **Verify commands:**
  - shared: `npm test --workspace @scripta/shared`
  - backend: `npm run typecheck --workspace backend && npm test --workspace backend`
  - frontend: `npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend`

## Review Focus

1. **A wrong merge can be fully undone.** That includes editions that arrived after the merge carrying the merged work's Open Library key. Pinned in Task 3.
2. **A Portuguese original is never merged.** A work whose original title equals its own title is recorded as an original and left alone. Pinned in Task 5.
3. **A merge never turns an arena duel into a book against itself.** An arena holding both works blocks the merge, whether it comes from the code step, Jev or the review page. Pinned in Tasks 4, 6 and 9.
4. **Two books with the same original title by different authors never merge on the title alone.** The code step also needs the surname, and anything else goes to Jev. Pinned in Task 5.
5. **After a merge, the work keeps one genre state and the original keeps its own summary.** Genre judgments move or drop. A Portuguese summary is not copied into the original. Pinned in Task 2.

---

### Task 1: Original titles

**Files:**
- Create: `backend/src/modules/books/domain/translation.ts`
- Create: `backend/src/modules/books/domain/translation.test.ts`. Add `src/modules/books/domain/translation.test.ts` to `backend/package.json` `"test"`, after `src/modules/books/domain/synopsis.test.ts`.
- Modify: `backend/src/modules/books/adapters/sqlite/books.sql`
- Modify: `backend/src/modules/books/adapters/sqlite/connection.ts`
- Modify: `backend/src/modules/books/domain/types.ts`
- Modify: `backend/src/modules/books/domain/ports.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Modify: `backend/src/modules/books/seed/publisherFeed.ts`
- Modify: `backend/src/modules/books/seed/importPublisherCovers.ts`
- Test: `backend/src/modules/books/seed/publisherFeed.test.ts`, `backend/src/modules/books/seed/importPublisherCovers.test.ts`, `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`

**Interfaces:**
- Produces, `domain/translation.ts`:
  - `originalTitleIn(text: string | null): string | null`: the value after `T[íi]tulo original`, with an optional `:`, `-`, `–` or `—`, to the end of the line. Trailing `.`, `;` or `,` is trimmed. It returns null when empty or over 200 characters.
  - `mainTitle(title: string): string`
  - `sameMainTitle(a: string, b: string): boolean`
- Produces, data:
  - column `books.original_title`, and `BookRow.original_title: string | null`;
  - `ProductDetails.originalTitle: string | null`.
- Produces, repo:
  - `fillOriginalTitle(bookId: string, title: string): void`. It writes only when the column is empty.
  - `fillOriginalTitlesFromSummaries(workId?: string): number`. It parses stored summaries into empty `original_title` columns, all of them or one work's, and returns how many it filled.

- [ ] **Step 1: Write the failing tests**

`backend/src/modules/books/domain/translation.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { mainTitle, originalTitleIn, sameMainTitle } from "./translation.js";

test("originalTitleIn reads the labelled value to the end of its line", () => {
  assert.equal(originalTitleIn("Uma sinopse.\n\nTítulo original: Les Misérables"), "Les Misérables");
  assert.equal(originalTitleIn("Titulo original - The Pure."), "The Pure");
  assert.equal(originalTitleIn("Tradução de Ana Lima. Título original Der Spaziergang\nOutra linha"), "Der Spaziergang");
  assert.equal(originalTitleIn("TÍTULO ORIGINAL — Ökendykarna;"), "Ökendykarna");
  assert.equal(originalTitleIn("Título original:   "), null);
  assert.equal(originalTitleIn(`Título original: ${"x".repeat(201)}`), null);
  assert.equal(originalTitleIn("Uma sinopse sem rótulo."), null);
  assert.equal(originalTitleIn(null), null);
});

test("the main title stops at the first dash or full-stop separator", () => {
  assert.equal(mainTitle("Lipstick Traces — A Secret History of the Twentieth Century"), "Lipstick Traces");
  assert.equal(mainTitle("Autobiographie d'un poulpe - et autres récits"), "Autobiographie d'un poulpe");
  assert.equal(mainTitle("Brave New World"), "Brave New World");
});

test("sameMainTitle compares main titles the catalog's way, numbers included", () => {
  assert.equal(sameMainTitle("To the Lighthouse — A Novel", "To the Lighthouse: A Novel"), true);
  assert.equal(sameMainTitle("Memorial do Convento", "Memorial do convento"), true);
  assert.equal(sameMainTitle("1984", "1985"), false);
  assert.equal(sameMainTitle("", ""), false);
});
```

In `publisherFeed.test.ts`:
- Add `originalTitle: null` to every literal `ProductDetails` the existing tests compare with. That includes the `empty` object in the product-page test, and the "a product with nothing to extract has all-null details" expectation.
- Then append:

```ts
test("the original title is captured while its line stays out of the synopsis", () => {
  const shopify = shopifyDetails(`<p>${SYNOPSIS}</p><p>Título original: Les Misérables</p>`);
  assert.equal(shopify.summary, SYNOPSIS);
  assert.equal(shopify.originalTitle, "Les Misérables");
  assert.equal(wooDetails({ description: `<p>${SYNOPSIS}</p>`, attributes: [attribute("Título original", "The Pure")] }).originalTitle, "The Pure");
  assert.equal(wooDetails({ description: `<p>${SYNOPSIS}</p><p>Titulo original: Der Spaziergang</p>` }).originalTitle, "Der Spaziergang");
  assert.equal(wooDetails({ description: `<p>${SYNOPSIS}</p>` }).originalTitle, null);
  assert.equal(withPageText({ summary: null, pages: null, year: null, translator: null, originalTitle: null }, "<p>Título original: Solaris</p>").originalTitle, "Solaris");
  assert.equal(withPageText({ summary: null, pages: null, year: null, translator: null, originalTitle: "Kept" }, "<p>Título original: Solaris</p>").originalTitle, "Kept");
});
```

In `importPublisherCovers.test.ts`, add `{ name: "Título original", terms: [{ name: "Pure" }] }` to the `attributes` of the `richFeed` product. Then append:

```ts
test("a created book keeps the publisher's original title", async () => {
  const h = await harness({ lookup: async () => ({ title: "Puro", author: "Jim Crace" }), feeds: { [WOO_FEED]: { text: richFeed } } });
  await importPublisherCovers(h.deps, [relogio], { dryRun: false });
  assert.equal(h.repo.findBookByKey(`isbn:${MUSEU}`)!.original_title, "Pure");
});
```

In `sqliteBooksRepository.test.ts`, append:

```ts
test("original titles fill only empty columns, from the feed or from stored summaries", () => {
  const { repo } = freshRepo();
  const a = repo.createBook({ title: "Passeio ao Farol", author: "Virginia Woolf", isbn: "9789720000111" }, ["isbn:9789720000111"], NOW);
  repo.fillOriginalTitle(a.id, "To the Lighthouse");
  repo.fillOriginalTitle(a.id, "Something else");
  assert.equal(repo.getBook(a.id)!.original_title, "To the Lighthouse");
  const b = repo.createBook({ title: "O Passeio", author: "Robert Walser", isbn: "9789720000112" }, ["isbn:9789720000112"], NOW);
  repo.mergeDetails(b.id, { summary: "Um passeio por uma cidade suíça, narrado por um escritor.\n\nTítulo original: Der Spaziergang", pages: null, year: null, publisher: null, translator: null }, "publisher");
  const c = repo.createBook({ title: "Sem rótulo", author: "X", isbn: "9789720000113" }, ["isbn:9789720000113"], NOW);
  repo.mergeDetails(c.id, { summary: "Uma sinopse sem rótulo de origem em parte alguma do texto.", pages: null, year: null, publisher: null, translator: null }, "publisher");
  assert.equal(repo.fillOriginalTitlesFromSummaries(c.work_id!), 0);
  assert.equal(repo.fillOriginalTitlesFromSummaries(), 1);
  assert.equal(repo.getBook(b.id)!.original_title, "Der Spaziergang");
  assert.equal(repo.fillOriginalTitlesFromSummaries(), 0);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run build --workspace @scripta/shared && npm run typecheck --workspace backend`
Expected: FAIL. `./translation.js` doesn't exist, `originalTitle` isn't on `ProductDetails`, and `fillOriginalTitle` isn't on the repository.

- [ ] **Step 3: Implement**

Create `backend/src/modules/books/domain/translation.ts`:

```ts
import { normalizeTitle, titleNumbers } from "@scripta/shared";

const ORIGINAL_TITLE = /T[íi]tulo original\s*[:\-–—]?\s*([^\n]+)/i;
const MAX_ORIGINAL_TITLE = 200;

export function originalTitleIn(text: string | null): string | null {
  const value = (ORIGINAL_TITLE.exec(text ?? "")?.[1] ?? "").trim().replace(/[.;,\s]+$/, "");
  return value !== "" && value.length <= MAX_ORIGINAL_TITLE ? value : null;
}

export function mainTitle(title: string): string {
  return title.split(/ — | – | - |\. /)[0]!.trim();
}

export function sameMainTitle(a: string, b: string): boolean {
  const left = normalizeTitle(mainTitle(a));
  return left !== "" && left === normalizeTitle(mainTitle(b)) && titleNumbers(mainTitle(a)) === titleNumbers(mainTitle(b));
}
```

In `books.sql`, add `original_title      TEXT,` to `books`, right before `created_at`.

In `connection.ts`, add this to the `books` column checks, beside the other `ALTER TABLE books ADD COLUMN` lines:

```ts
  if (!columns.some((column) => column.name === "original_title")) db.exec("ALTER TABLE books ADD COLUMN original_title TEXT");
```

In `domain/types.ts`, add `original_title: string | null;` to `BookRow`, after `summary_hash`.

In `domain/ports.ts`, add these after `synopsisTexts()`:

```ts
  fillOriginalTitle(bookId: string, title: string): void;
  fillOriginalTitlesFromSummaries(workId?: string): number;
```

In `sqliteBooksRepository.ts`:
- Add `import { originalTitleIn } from "../../domain/translation.js";`.
- Add these statements:

```ts
  const fillOriginalTitleStmt = db.prepare(`UPDATE books SET original_title = ? WHERE id = ? AND original_title IS NULL`);
  const labelledSummariesStmt = db.prepare(`SELECT id, summary FROM books WHERE original_title IS NULL AND summary LIKE '%tulo original%'`);
  const labelledWorkSummariesStmt = db.prepare(`SELECT id, summary FROM books WHERE work_id = ? AND original_title IS NULL AND summary LIKE '%tulo original%'`);
```

- Add these methods:

```ts
    fillOriginalTitle(bookId, title) {
      fillOriginalTitleStmt.run(title, bookId);
    },
    fillOriginalTitlesFromSummaries(workId) {
      return inTransaction(() => {
        const rows = (workId === undefined ? labelledSummariesStmt.all() : labelledWorkSummariesStmt.all(workId)) as Array<{ id: string; summary: string }>;
        let filled = 0;
        for (const row of rows) {
          const title = originalTitleIn(row.summary);
          if (title && fillOriginalTitleStmt.run(title, row.id).changes > 0) filled += 1;
        }
        return filled;
      });
    },
```

In `seed/publisherFeed.ts`:
- Add `import { originalTitleIn } from "../domain/translation.js";`.
- Add `originalTitle: string | null;` to `ProductDetails`.
- Add `const ORIGINAL_TITLE_ATTRIBUTE = /^t[íi]tulo original/i;` beside the other attribute patterns.
- In `parseShopifyProducts`, the details line becomes:

```ts
    const details = { summary: synopsis(lines), year: null, originalTitle: originalTitleIn(lines.join("\n")), ...feedTextDetails(lines) };
```

- In `wooDetails`, add this field to the returned object:

```ts
    originalTitle: wooAttribute(product, ORIGINAL_TITLE_ATTRIBUTE) ?? originalTitleIn([...description, ...shortDescription].join("\n"))
```

- `withPageText` becomes:

```ts
export function withPageText(details: ProductDetails, html: string): ProductDetails {
  const lines = textLines(html);
  return { ...details, pages: details.pages ?? labelledPages(lines), translator: details.translator ?? labelledTranslator(lines), originalTitle: details.originalTitle ?? originalTitleIn(lines.join("\n")) };
}
```

In `seed/importPublisherCovers.ts`:
- Add `"fillOriginalTitle"` to the `repo: Pick<BooksRepository, …>` list in `ImportDeps`.
- Right after the `deps.repo.mergeDetails(row.id, { ...book.details, publisher: site.name }, "publisher");` line, add:

```ts
      if (book.details.originalTitle) deps.repo.fillOriginalTitle(row.id, book.details.originalTitle);
```

- If a test builds a fake `ImportDeps["repo"]`, add `fillOriginalTitle: () => {}` to it.

- [ ] **Step 4: Run to verify they pass**

Run: `npm run build --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/books/domain/translation.ts backend/src/modules/books/domain/translation.test.ts backend/src/modules/books/adapters/sqlite/books.sql backend/src/modules/books/adapters/sqlite/connection.ts backend/src/modules/books/domain/types.ts backend/src/modules/books/domain/ports.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts backend/src/modules/books/seed/publisherFeed.ts backend/src/modules/books/seed/publisherFeed.test.ts backend/src/modules/books/seed/importPublisherCovers.ts backend/src/modules/books/seed/importPublisherCovers.test.ts backend/package.json && git commit -m "$(cat <<'EOF'
Keep the original title publishers print, and read it from stored summaries

The feed parser dropped the "Título original" line from the synopsis and
threw the value away; it now keeps the value in books.original_title,
from the line, a WooCommerce attribute or the product page. 4,578
production summaries still carry the line, so the repository can parse
them into empty columns too. The original title is what lets code find
a translation's original work without guessing.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Merging safely

**Files:**
- Modify: `backend/src/modules/books/adapters/sqlite/books.sql`
- Modify: `backend/src/modules/books/adapters/sqlite/connection.ts`
- Modify: `backend/src/modules/books/domain/types.ts`
- Modify: `backend/src/modules/books/domain/ports.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Test: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`

**Interfaces:**
- Consumes: the genre plans' `genre_judgments` and `genre_rejections` and their repository methods (`saveGenreJudgment`, `genreJudgments`, `recordGenreRejection`, `genreRejections`).
- Produces, `domain/types.ts`: `type MergeSource = "title-key" | "admin" | "code" | "jev" | "manual"`.
- Produces, data: the table `work_merges(id, from_work, into_work, source, confidence, moved_book_ids, repointed_work_ids, merged_at, undone_at)`, indexed on `from_work`.
- Produces, repo:
  - **`mergeTranslation(fromId: string, intoId: string, source: "code" | "jev" | "manual", confidence: number | null, at: string): string`.** It is the keyed-merge option the spec describes:
    - It accepts a source work with an Open Library key.
    - It never copies the source's summary.
    - It returns the target.
    - It throws `WorkMergeError` when the source is missing or already merged, or when the target is missing or is the source.
  - **`mergeWorks(fromId: string, intoId: string, at?: string): string`:** unchanged behaviour, and still refuses keyed works.
  - **`groupKeylessWorks(limit: number, at?: string): number`:** unchanged behaviour.
- Behaviour:
  - Every lookup by Open Library key resolves `COALESCE(merged_into, id)`.
  - Every `mergeInto` writes a `work_merges` row, moves or drops genre rows, and carries the summary only for title-key and admin merges.
  - `setWorkKey`'s emptied-work merge also moves or drops genre rows.

- [ ] **Step 1: Write the failing tests**

Append to `sqliteBooksRepository.test.ts`:

```ts
const AT = "2026-10-15T12:00:00.000Z";
const mergeRows = (db: DatabaseSync) => (db.prepare("SELECT from_work, into_work, source, confidence, moved_book_ids, repointed_work_ids, merged_at, undone_at FROM work_merges ORDER BY id").all() as Array<Record<string, unknown>>).map((row) => ({ ...row }));

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

test("every merge is recorded with the editions it moved and the works it repointed", () => {
  const { db, repo } = freshRepo();
  const alias = repo.createBook({ title: "Alias", author: "X", isbn: "9789720000207" }, ["isbn:9789720000207"], NOW);
  const pt = repo.createBook({ title: "Passeio", author: "X", isbn: "9789720000208" }, ["isbn:9789720000208"], NOW);
  const en = repo.createBook({ title: "Walk", author: "X", isbn: "9789720000209", workKey: "OL904W" }, ["isbn:9789720000209"], NOW);
  repo.mergeWorks(alias.work_id!, pt.work_id!, AT);
  repo.mergeTranslation(pt.work_id!, en.work_id!, "jev", 0.93, AT);
  const twin1 = repo.createBook({ title: "Twin", author: "Y", isbn: "9789720000219" }, ["isbn:9789720000219"], NOW);
  const twin2 = repo.createBook({ title: "Twin", author: "Y", isbn: "9789720000210" }, ["isbn:9789720000210"], NOW);
  assert.equal(repo.groupKeylessWorks(10, AT), 1);
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

test("setWorkKey's emptied work hands its genre state to the work it joined", () => {
  const { repo } = freshRepo();
  const keyed = repo.createBook({ title: "Kept", author: "X", isbn: "9789720000215", workKey: "OL909W" }, ["isbn:9789720000215"], NOW);
  const loose = repo.createBook({ title: "Kept", author: "X", isbn: "9789720000216" }, ["isbn:9789720000216"], NOW);
  repo.saveGenreJudgment({ workId: loose.work_id!, model: "jev-1.13.0", genre: "History", confidence: 0.7, askedAt: AT });
  repo.setWorkKey(loose.id, "OL909W");
  assert.equal(repo.genreJudgments([keyed.work_id!]).get(keyed.work_id!)?.genre, "History");
  assert.equal(repo.genreJudgments([loose.work_id!]).size, 0);
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run typecheck --workspace backend`
Expected: FAIL. `mergeTranslation` doesn't exist, and `mergeWorks` and `groupKeylessWorks` take no `at`.

- [ ] **Step 3: Implement**

Append to `books.sql`:

```sql
CREATE TABLE IF NOT EXISTS work_merges (
  id                 INTEGER PRIMARY KEY,
  from_work          TEXT NOT NULL,
  into_work          TEXT NOT NULL,
  source             TEXT NOT NULL,
  confidence         REAL,
  moved_book_ids     TEXT NOT NULL,
  repointed_work_ids TEXT NOT NULL,
  merged_at          TEXT NOT NULL,
  undone_at          TEXT
);
```

In `connection.ts`, after the other `CREATE INDEX` lines, add:

```ts
  db.exec("CREATE INDEX IF NOT EXISTS idx_work_merges_from ON work_merges(from_work)");
```

In `domain/types.ts`, add `export type MergeSource = "title-key" | "admin" | "code" | "jev" | "manual";`.

In `domain/ports.ts`:
- `mergeWorks(fromId: string, intoId: string): string;` becomes `mergeWorks(fromId: string, intoId: string, at?: string): string;`.
- `groupKeylessWorks(limit: number): number;` becomes `groupKeylessWorks(limit: number, at?: string): number;`.
- Add after `fillOriginalTitlesFromSummaries(...)`:

```ts
  mergeTranslation(fromId: string, intoId: string, source: "code" | "jev" | "manual", confidence: number | null, at: string): string;
```

In `sqliteBooksRepository.ts`:
- Add `MergeSource` to the `domain/types.js` import.
- `workByKeyStmt` becomes:

```ts
  const workByKeyStmt = db.prepare(`SELECT COALESCE(merged_into, id) AS id FROM works WHERE ol_work_key = ?`);
```

- Add these statements after `repointMergedStmt`:

```ts
  const workEditionIdsStmt = db.prepare(`SELECT id FROM books WHERE work_id = ? ORDER BY created_at, rowid`);
  const recordMergeStmt = db.prepare(`INSERT INTO work_merges (from_work, into_work, source, confidence, moved_book_ids, repointed_work_ids, merged_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const genreJudgmentOwnedStmt = db.prepare(`SELECT 1 AS owned FROM genre_judgments WHERE work_id = ?`);
  const moveGenreJudgmentStmt = db.prepare(`UPDATE genre_judgments SET work_id = ? WHERE work_id = ?`);
  const dropGenreJudgmentStmt = db.prepare(`DELETE FROM genre_judgments WHERE work_id = ?`);
  const genreRejectionOwnedStmt = db.prepare(`SELECT 1 AS owned FROM genre_rejections WHERE work_id = ?`);
  const moveGenreRejectionStmt = db.prepare(`UPDATE genre_rejections SET work_id = ? WHERE work_id = ?`);
  const dropGenreRejectionStmt = db.prepare(`DELETE FROM genre_rejections WHERE work_id = ?`);
```

- Replace `mergeInto` with this, plus a helper. `aliasStmt` is the existing `SELECT id FROM works WHERE merged_into = ?` statement that `workPageRows` uses:

```ts
  type MergeRecord = { source: MergeSource; confidence: number | null; at: string; carrySummary: boolean };

  function carryGenreState(from: string, into: string) {
    if (genreJudgmentOwnedStmt.get(into)) dropGenreJudgmentStmt.run(from);
    else moveGenreJudgmentStmt.run(into, from);
    if (genreRejectionOwnedStmt.get(into)) dropGenreRejectionStmt.run(from);
    else moveGenreRejectionStmt.run(into, from);
  }

  function mergeInto(from: string, into: string, record: MergeRecord) {
    const moved = (workEditionIdsStmt.all(from) as Array<{ id: string }>).map((row) => row.id);
    const repointed = (aliasStmt.all(from) as Array<{ id: string }>).map((row) => row.id);
    moveWorkEditionsStmt.run(into, from);
    if (record.carrySummary) carryWorkSummaryStmt.run(from, into);
    fillWorkFromEditionsStmt.run(into);
    markMergedStmt.run(into, from);
    repointMergedStmt.run(into, from);
    carryGenreState(from, into);
    recordMergeStmt.run(from, into, record.source, record.confidence, JSON.stringify(moved), JSON.stringify(repointed), record.at);
  }
```

- In `setWorkKey`, the emptied-work line becomes:

```ts
        if (book.work_id && mergeEmptyWorkStmt.run(target, book.work_id).changes === 1) {
          repointMergedStmt.run(target, book.work_id);
          carryGenreState(book.work_id, target);
        }
```

- `mergeWorks` becomes `mergeWorks(fromId, intoId, at = new Date().toISOString()) {`. Its `mergeInto(from.id, into);` becomes `mergeInto(from.id, into, { source: "admin", confidence: null, at, carrySummary: true });`. Nothing else changes.
- `groupKeylessWorks` becomes `groupKeylessWorks(limit, at = new Date().toISOString()) {`. Its loop becomes `for (const pair of pairs) mergeInto(pair.source, pair.target, { source: "title-key", confidence: null, at, carrySummary: true });`.
- Add this method after `mergeWorks`:

```ts
    mergeTranslation(fromId, intoId, source, confidence, at) {
      return inTransaction(() => {
        const from = workLinkStmt.get(fromId) as WorkLink | undefined;
        if (!from || from.merged_into) throw new WorkMergeError("That work is gone or was already merged.");
        const into = liveWorkId(intoId);
        if (!into || into === from.id) throw new WorkMergeError("That work can't be merged there.");
        mergeInto(from.id, into, { source, confidence, at, carrySummary: false });
        return into;
      });
    },
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm run typecheck --workspace backend && npm test --workspace backend`
Expected: PASS. The existing merge, grouping and `setWorkKey` tests are unchanged and still green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/books/adapters/sqlite/books.sql backend/src/modules/books/adapters/sqlite/connection.ts backend/src/modules/books/domain/types.ts backend/src/modules/books/domain/ports.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts && git commit -m "$(cat <<'EOF'
Let translations merge keyed works safely, and record every merge

The keyless-works design said keyed works never merge, because the key
lookup ignored merged_into: a merged-away work would keep absorbing new
editions that never showed on the strip. Every key lookup now follows
the merge, so mergeTranslation can move a Portuguese work with its own
Open Library key into its original. A translation merge doesn't copy
the Portuguese summary into the original. Each merge, title-key and
admin ones included, writes a work_merges row with what it moved, which
undo needs, and the merged-away work's genre judgment and strikes move
to the target or drop when it has its own, here and in setWorkKey's
emptied-work merge.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Undo

**Files:**
- Modify: `backend/src/modules/books/domain/ports.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Test: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`

**Interfaces:**
- Consumes: `work_merges` and `mergeTranslation` (Task 2).
- Produces, repo: `undoMerge(fromId: string, at: string): { into: string; editions: number }`. It reverses the work's latest merge that hasn't been undone, in one transaction:
  - clears `merged_into`;
  - moves back the recorded editions still on the target, and any edition on the target that carries the source's Open Library key;
  - points the recorded works back;
  - sets `undone_at`.

  It throws `WorkMergeError` when no such merge exists, or when the source is no longer merged into that target.

- [ ] **Step 1: Write the failing tests**

Append to `sqliteBooksRepository.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run typecheck --workspace backend`
Expected: FAIL. `undoMerge` doesn't exist.

- [ ] **Step 3: Implement**

In `domain/ports.ts`, add after `mergeTranslation(...)`:

```ts
  undoMerge(fromId: string, at: string): { into: string; editions: number };
```

In `sqliteBooksRepository.ts`, add these statements after `recordMergeStmt`:

```ts
  const latestMergeStmt = db.prepare(`SELECT id, into_work, moved_book_ids, repointed_work_ids FROM work_merges WHERE from_work = ? AND undone_at IS NULL ORDER BY id DESC LIMIT 1`);
  const moveBackStmt = db.prepare(`UPDATE books SET work_id = ? WHERE work_id = ? AND (id IN (SELECT value FROM json_each(?)) OR (? IS NOT NULL AND ol_work_key = ?))`);
  const unmergeStmt = db.prepare(`UPDATE works SET merged_into = NULL WHERE id = ?`);
  const repointBackStmt = db.prepare(`UPDATE works SET merged_into = ? WHERE merged_into = ? AND id IN (SELECT value FROM json_each(?))`);
  const markUndoneStmt = db.prepare(`UPDATE work_merges SET undone_at = ? WHERE id = ?`);
```

And this method after `mergeTranslation`:

```ts
    undoMerge(fromId, at) {
      return inTransaction(() => {
        const merge = latestMergeStmt.get(fromId) as { id: number; into_work: string; moved_book_ids: string; repointed_work_ids: string } | undefined;
        const from = workLinkStmt.get(fromId) as WorkLink | undefined;
        if (!merge || !from || from.merged_into !== merge.into_work) throw new WorkMergeError("That merge can no longer be undone.");
        const editions = Number(moveBackStmt.run(from.id, merge.into_work, merge.moved_book_ids, from.ol_work_key, from.ol_work_key).changes);
        unmergeStmt.run(from.id);
        repointBackStmt.run(from.id, merge.into_work, merge.repointed_work_ids);
        markUndoneStmt.run(at, merge.id);
        return { into: merge.into_work, editions };
      });
    },
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm run typecheck --workspace backend && npm test --workspace backend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/books/domain/ports.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts && git commit -m "$(cat <<'EOF'
Undo a work merge from its record

Automatic merges at Jev's 0.9 are about 99% right on the samples, so
some will be wrong. Undo restores the merged work, moves back the
editions the merge moved plus any that arrived later carrying the
merged work's own key, and points its old aliases back at it. It
refuses once the target has itself merged elsewhere, since the record
no longer describes the data.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: The arena check

**Files:**
- Modify: `backend/src/modules/arena/domain/ports.ts`
- Modify: `backend/src/modules/arena/adapters/sqlite/sqliteArenaRepository.ts`
- Modify: `backend/src/modules/arena/service.ts`
- Test: `backend/src/modules/arena/adapters/sqlite/sqliteArenaRepository.test.ts`
- Modify: `backend/src/modules/books/plugin.ts`
- Modify: `backend/src/app.ts`

**Interfaces:**
- Produces, arena:
  - repo `worksShareATournament(aIds: string[], bIds: string[]): boolean`: true when one tournament has a slot from each list, in any status.
  - `ArenaService.worksShareATournament` and `ArenaPublicApi.worksShareATournament`, same signature.
- Produces, books: `BooksPluginOptions.worksShareAnArena?: (aIds: string[], bIds: string[]) => boolean`. `app.ts` wires it to the arena public API.

- [ ] **Step 1: Write the failing test**

Append to `sqliteArenaRepository.test.ts`:

```ts
test("worksShareATournament finds two works in one tournament, through any of their ids", async () => {
  const { createSqliteArenaRepository } = await import("./sqliteArenaRepository.js");
  const db = freshDb();
  db.exec(`INSERT INTO tournaments (id, owner_user_id, name, bracket_size, round_duration_minutes) VALUES ('t1', 'u', 'One', 4, 60), ('t2', 'u', 'Two', 4, 60)`);
  db.exec(`INSERT INTO tournament_slots (tournament_id, slot_index, work_id, title, author) VALUES ('t1', 0, 'w-pt', 'Passeio', 'X'), ('t1', 1, 'w-en', 'Walk', 'X'), ('t2', 0, 'w-other', 'Other', 'Y')`);
  const repo = createSqliteArenaRepository(db);
  assert.equal(repo.worksShareATournament(["w-pt"], ["w-en"]), true);
  assert.equal(repo.worksShareATournament(["w-pt-alias", "w-pt"], ["w-en"]), true);
  assert.equal(repo.worksShareATournament(["w-pt"], ["w-other"]), false);
  assert.equal(repo.worksShareATournament([], ["w-en"]), false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run typecheck --workspace backend`
Expected: FAIL. `worksShareATournament` doesn't exist.

- [ ] **Step 3: Implement**

In `arena/domain/ports.ts`, add to `ArenaRepository`, after `tournamentRecord(...)`:

```ts
  worksShareATournament(aIds: string[], bIds: string[]): boolean;
```

In `sqliteArenaRepository.ts`, add this statement beside `enteredByWorksStmt`:

```ts
  const shareTournamentStmt = db.prepare(`
    SELECT 1 AS shared FROM tournament_slots a JOIN tournament_slots b ON b.tournament_id = a.tournament_id
    WHERE a.work_id IN (SELECT value FROM json_each(?)) AND b.work_id IN (SELECT value FROM json_each(?))
    LIMIT 1
  `);
```

And this method beside `listPublishedByWorks`:

```ts
    worksShareATournament(aIds, bIds) {
      return shareTournamentStmt.get(JSON.stringify(aIds), JSON.stringify(bIds)) !== undefined;
    },
```

In `arena/service.ts`:
- Add `worksShareATournament(aIds: string[], bIds: string[]): boolean;` to `ArenaService` and to `ArenaPublicApi`.
- `createArenaService` returns `worksShareATournament: (aIds, bIds) => repo.worksShareATournament(aIds, bIds),`.
- `createArenaPublicApi` returns `worksShareATournament: (aIds, bIds) => service.worksShareATournament(aIds, bIds),`.
- If `service.test.ts` builds a fake `ArenaRepository`, add `worksShareATournament: () => false` to it.

In `books/plugin.ts`, add `worksShareAnArena?: (aIds: string[], bIds: string[]) => boolean;` to `BooksPluginOptions`.

In `app.ts`, add this to the `registerBooksModule` options:

```ts
    worksShareAnArena: (aIds: string[], bIds: string[]) => getArenaPublicApi().worksShareATournament(aIds, bIds),
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run typecheck --workspace backend && npm test --workspace backend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/arena/domain/ports.ts backend/src/modules/arena/adapters/sqlite/sqliteArenaRepository.ts backend/src/modules/arena/adapters/sqlite/sqliteArenaRepository.test.ts backend/src/modules/arena/service.ts backend/src/modules/books/plugin.ts backend/src/app.ts && git commit -m "$(cat <<'EOF'
Let the books module ask whether two works share a tournament

Arena reads canonicalise work ids, so merging two works that one
tournament holds turns that duel into a book against itself. The
translation merge asks first, through the arena's public API, and sends
such a pair to review instead. Seeding tournaments count too.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Match storage, candidates and the code match

**Files:**
- Modify: `backend/src/modules/books/domain/translation.ts`
- Modify: `backend/src/modules/books/domain/translation.test.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/books.sql`
- Modify: `backend/src/modules/books/domain/types.ts`
- Modify: `backend/src/modules/books/domain/ports.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Create: `backend/src/modules/books/translationJudgments.ts`
- Create: `backend/src/modules/books/translationJudgments.test.ts`. Add `src/modules/books/translationJudgments.test.ts` to `backend/package.json` `"test"`, after `src/modules/books/synopsisBacklog.test.ts`.

**Interfaces:**
- Consumes: `originalTitleIn`, `mainTitle` and `sameMainTitle` (Task 1); `jev_rejections` (synopsis plan).
- Produces, `domain/translation.ts`:
  - `MATCH_MERGE_AT = 0.9`, `MATCH_REVIEW_AT = 0.5`, `MAX_CANDIDATES = 40`
  - `isPortuguese(language: string | null): boolean`
  - `titlePattern(title: string): string | null`, a GLOB over `books.title_key`
  - `authorPattern(author: string): string | null`
  - `surnameOf(author: string): string | null`
  - `mentionsSurname(texts: Array<string | null>, surname: string): boolean`
  - `type TranslationEvidence = { workId: string; title: string; author: string; workAuthor: string; publisher: string | null; summary: string | null; originalTitle: string | null; summaries: string[] }`
  - `evidenceOf(rows: { workId: string; workAuthor: string; editions: Array<{ title: string; author: string; publisher: string | null; summary: string | null; originalTitle: string | null }> }): TranslationEvidence`
- Produces, `domain/types.ts`: `type WorkMatchJudgment = { model: string; intoWorkId: string | null; confidence: number | null; askedAt: string }`.
- Produces, repo:
  - `workMatchJudgments(workIds: string[]): Map<string, WorkMatchJudgment>`
  - `saveWorkMatchJudgment(workId: string, judgment: WorkMatchJudgment): void`, which replaces any earlier judgment
  - `portugueseWorksNeedingMatch(workIds: string[] | null, limit: number, rejectionLimit: number, recheckBefore: string | null): string[]`: live, all-Portuguese works with no judgment (or, with `recheckBefore`, a non-manual "none" judgment older than it) and fewer than `rejectionLimit` strikes, oldest first. A null `workIds` means every work.
  - `translationEvidence(workId: string): { workId: string; workAuthor: string; editions: Array<{ title: string; author: string; publisher: string | null; summary: string | null; originalTitle: string | null }> } | undefined`, editions oldest first
  - `titleCandidates(pattern: string): string[]`, canonical work ids
  - `authorCandidates(pattern: string): string[]`, canonical work ids that have a non-Portuguese edition by that author, most editions first
  - `matchCandidates(workIds: string[]): Array<{ id: string; title: string; author: string; year: number | null; editions: number; languages: string[] }>`
- Produces, `translationJudgments.ts`:
  - `type MatchCandidate = { id: string; title: string; author: string; year: number | null }`
  - `type MatchPlan = { kind: "original" } | { kind: "none" } | { kind: "code"; intoWorkId: string } | { kind: "ask"; evidence: TranslationEvidence; candidates: MatchCandidate[] }`
  - `planMatch(repo, workId: string): MatchPlan | null`

- [ ] **Step 1: Write the failing tests**

Append to `domain/translation.test.ts`. Extend the import to `import { authorPattern, evidenceOf, isPortuguese, mainTitle, mentionsSurname, originalTitleIn, sameMainTitle, surnameOf, titlePattern } from "./translation.js";`:

```ts
test("Portuguese means a pt language tag", () => {
  assert.deepEqual(["pt", "pt-PT", "pt-BR", "en", null, "ptx"].map(isPortuguese), [true, true, true, false, false, false]);
});

test("title and author patterns match the catalog's title keys", () => {
  assert.equal(titlePattern("To the Lighthouse — A Novel"), "ta:to the lighthouse|*|");
  assert.equal(titlePattern("1984"), "ta:1984|*|1984");
  assert.equal(titlePattern("   "), null);
  assert.equal(authorPattern("Virginia Woolf, Ana Lima"), "ta:*|virginia woolf|*");
  assert.equal(authorPattern(""), null);
});

test("the surname is the last word of three or more letters, matched whole", () => {
  assert.equal(surnameOf("Fiódor Dostoiévski"), "dostoievski");
  assert.equal(surnameOf("José Saramago, Ana Lima"), "saramago");
  assert.equal(surnameOf("Li Bo"), null);
  assert.equal(mentionsSurname(["Um romance de Virginia Woolf."], "woolf"), true);
  assert.equal(mentionsSurname(["Woolfgang"], "woolf"), false);
  assert.equal(mentionsSurname([null, "Sem autor."], "woolf"), false);
});

test("evidence takes each field from the oldest edition that has it, and reads original titles from summaries", () => {
  const evidence = evidenceOf({
    workId: "w",
    workAuthor: "Robert Walser",
    editions: [
      { title: "O Passeio", author: "", publisher: null, summary: "Um passeio.\n\nTítulo original: Der Spaziergang", originalTitle: null },
      { title: "O Passeio (2.ª ed.)", author: "Robert Walser", publisher: "Relógio d'Água", summary: "Outra sinopse.", originalTitle: null }
    ]
  });
  assert.deepEqual(evidence, { workId: "w", title: "O Passeio", author: "Robert Walser", workAuthor: "Robert Walser", publisher: "Relógio d'Água", summary: "Um passeio.\n\nTítulo original: Der Spaziergang", originalTitle: "Der Spaziergang", summaries: ["Um passeio.\n\nTítulo original: Der Spaziergang", "Outra sinopse."] });
});
```

Create `backend/src/modules/books/translationJudgments.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run typecheck --workspace backend`
Expected: FAIL. `./translationJudgments.js`, `saveWorkMatchJudgment` and the new domain functions don't exist.

- [ ] **Step 3: Implement**

Add to `domain/translation.ts`. Extend its shared import to `import { firstAuthor, normalizeTitle, normalizeWords, titleNumbers } from "@scripta/shared";`:

```ts
export const MATCH_MERGE_AT = 0.9;
export const MATCH_REVIEW_AT = 0.5;
export const MAX_CANDIDATES = 40;

export type TranslationEvidence = { workId: string; title: string; author: string; workAuthor: string; publisher: string | null; summary: string | null; originalTitle: string | null; summaries: string[] };

const globLiteral = (value: string) => value.replace(/[*?[]/g, "[$&]");

export function isPortuguese(language: string | null): boolean {
  return language === "pt" || (language?.startsWith("pt-") ?? false);
}

export function titlePattern(title: string): string | null {
  const main = mainTitle(title);
  const normalized = normalizeTitle(main);
  return normalized ? `ta:${globLiteral(normalized)}|*|${globLiteral(titleNumbers(main))}` : null;
}

export function authorPattern(author: string): string | null {
  const first = firstAuthor(author);
  return first ? `ta:*|${globLiteral(first)}|*` : null;
}

export function surnameOf(author: string): string | null {
  return firstAuthor(author).split(" ").filter((word) => word.length >= 3).at(-1) ?? null;
}

export function mentionsSurname(texts: Array<string | null>, surname: string): boolean {
  return texts.some((text) => text !== null && ` ${normalizeWords(text)} `.includes(` ${surname} `));
}

export function evidenceOf(rows: { workId: string; workAuthor: string; editions: Array<{ title: string; author: string; publisher: string | null; summary: string | null; originalTitle: string | null }> }): TranslationEvidence {
  const first = (values: Array<string | null>) => values.find((value): value is string => Boolean(value?.trim())) ?? null;
  const editions = rows.editions;
  return {
    workId: rows.workId,
    title: first(editions.map((edition) => edition.title)) ?? "",
    author: first(editions.map((edition) => edition.author)) ?? rows.workAuthor,
    workAuthor: rows.workAuthor,
    publisher: first(editions.map((edition) => edition.publisher)),
    summary: first(editions.map((edition) => edition.summary)),
    originalTitle: first(editions.map((edition) => edition.originalTitle ?? originalTitleIn(edition.summary))),
    summaries: editions.flatMap((edition) => (edition.summary?.trim() ? [edition.summary] : []))
  };
}
```

Append to `books.sql`:

```sql
CREATE TABLE IF NOT EXISTS work_match_judgments (
  work_id      TEXT PRIMARY KEY,
  model        TEXT NOT NULL,
  into_work_id TEXT,
  confidence   REAL,
  asked_at     TEXT NOT NULL
);
```

In `domain/types.ts`, add `export type WorkMatchJudgment = { model: string; intoWorkId: string | null; confidence: number | null; askedAt: string };`.

In `domain/ports.ts`:
- Add `WorkMatchJudgment` to the `./types.js` import.
- Add these after `undoMerge(...)`:

```ts
  workMatchJudgments(workIds: string[]): Map<string, WorkMatchJudgment>;
  saveWorkMatchJudgment(workId: string, judgment: WorkMatchJudgment): void;
  portugueseWorksNeedingMatch(workIds: string[] | null, limit: number, rejectionLimit: number, recheckBefore: string | null): string[];
  translationEvidence(workId: string): { workId: string; workAuthor: string; editions: Array<{ title: string; author: string; publisher: string | null; summary: string | null; originalTitle: string | null }> } | undefined;
  titleCandidates(pattern: string): string[];
  authorCandidates(pattern: string): string[];
  matchCandidates(workIds: string[]): Array<{ id: string; title: string; author: string; year: number | null; editions: number; languages: string[] }>;
```

In `sqliteBooksRepository.ts`, add these statements:

```ts
  const workMatchJudgmentsStmt = db.prepare(`SELECT work_id, model, into_work_id, confidence, asked_at FROM work_match_judgments WHERE work_id IN (SELECT value FROM json_each(?))`);
  const saveWorkMatchJudgmentStmt = db.prepare(`INSERT OR REPLACE INTO work_match_judgments (work_id, model, into_work_id, confidence, asked_at) VALUES (?, ?, ?, ?, ?)`);
  const portugueseWorkFilter = `
    w.merged_into IS NULL
    AND EXISTS (SELECT 1 FROM books b WHERE b.work_id = w.id)
    AND NOT EXISTS (SELECT 1 FROM books b WHERE b.work_id = w.id AND (b.language IS NULL OR (b.language <> 'pt' AND b.language NOT LIKE 'pt-%')))
    AND NOT EXISTS (SELECT 1 FROM work_match_judgments j WHERE j.work_id = w.id AND NOT ($recheck IS NOT NULL AND j.into_work_id IS NULL AND j.model <> 'manual' AND j.asked_at < $recheck))
    AND NOT EXISTS (SELECT 1 FROM jev_rejections r WHERE r.task = 'works' AND r.subject = w.id AND r.attempts >= $rejections)
  `;
  const allPortugueseNeedingMatchStmt = db.prepare(`SELECT w.id FROM works w WHERE ${portugueseWorkFilter} ORDER BY w.created_at, w.rowid LIMIT $limit`);
  const somePortugueseNeedingMatchStmt = db.prepare(`SELECT w.id FROM works w WHERE w.id IN (SELECT value FROM json_each($ids)) AND ${portugueseWorkFilter} ORDER BY w.created_at, w.rowid LIMIT $limit`);
  const translationEditionsStmt = db.prepare(`SELECT title, author, publisher, summary, original_title FROM books WHERE work_id = ? ORDER BY created_at, rowid`);
  const titleCandidatesStmt = db.prepare(`SELECT DISTINCT COALESCE(w.merged_into, w.id) AS id FROM books b JOIN works w ON w.id = b.work_id WHERE b.title_key GLOB ?`);
  const authorCandidatesStmt = db.prepare(`
    SELECT COALESCE(w.merged_into, w.id) AS id, COUNT(*) AS editions
    FROM books b JOIN works w ON w.id = b.work_id
    WHERE b.title_key GLOB ?
    GROUP BY COALESCE(w.merged_into, w.id)
    HAVING SUM(CASE WHEN b.language IS NULL OR (b.language <> 'pt' AND b.language NOT LIKE 'pt-%') THEN 1 ELSE 0 END) > 0
    ORDER BY editions DESC, id
  `);
  const matchCandidatesStmt = db.prepare(`
    SELECT w.id, w.title, w.author, MIN(b.year) AS year, COUNT(b.id) AS editions, json_group_array(DISTINCT COALESCE(b.language, '')) AS languages
    FROM works w JOIN books b ON b.work_id = w.id
    WHERE w.id IN (SELECT value FROM json_each(?))
    GROUP BY w.id
  `);
```

And these methods:

```ts
    workMatchJudgments(workIds) {
      const rows = workMatchJudgmentsStmt.all(JSON.stringify(workIds)) as Array<{ work_id: string; model: string; into_work_id: string | null; confidence: number | null; asked_at: string }>;
      return new Map(rows.map((row) => [row.work_id, { model: row.model, intoWorkId: row.into_work_id, confidence: row.confidence, askedAt: row.asked_at }]));
    },
    saveWorkMatchJudgment(workId, judgment) {
      saveWorkMatchJudgmentStmt.run(workId, judgment.model, judgment.intoWorkId, judgment.confidence, judgment.askedAt);
    },
    portugueseWorksNeedingMatch(workIds, limit, rejectionLimit, recheckBefore) {
      const params = { $recheck: recheckBefore, $rejections: rejectionLimit, $limit: limit };
      const rows = workIds === null ? allPortugueseNeedingMatchStmt.all(params) : somePortugueseNeedingMatchStmt.all({ ...params, $ids: JSON.stringify(workIds) });
      return (rows as Array<{ id: string }>).map((row) => row.id);
    },
    translationEvidence(workId) {
      const work = workLinkStmt.get(workId) as WorkLink | undefined;
      if (!work) return undefined;
      const author = (workStmt.get(workId) as { author: string } | undefined)?.author ?? "";
      const editions = (translationEditionsStmt.all(workId) as Array<{ title: string; author: string; publisher: string | null; summary: string | null; original_title: string | null }>).map((row) => ({ title: row.title, author: row.author, publisher: row.publisher, summary: row.summary, originalTitle: row.original_title }));
      return { workId, workAuthor: author, editions };
    },
    titleCandidates(pattern) {
      return (titleCandidatesStmt.all(pattern) as Array<{ id: string }>).map((row) => row.id);
    },
    authorCandidates(pattern) {
      return (authorCandidatesStmt.all(pattern) as Array<{ id: string }>).map((row) => row.id);
    },
    matchCandidates(workIds) {
      return (matchCandidatesStmt.all(JSON.stringify(workIds)) as Array<{ id: string; title: string; author: string; year: number | null; editions: number; languages: string }>).map((row) => ({ id: row.id, title: row.title, author: row.author, year: row.year, editions: row.editions, languages: (JSON.parse(row.languages) as string[]).filter(Boolean) }));
    },
```

Create `backend/src/modules/books/translationJudgments.ts`:

```ts
import type { BooksRepository } from "./domain/ports.js";
import { authorPattern, evidenceOf, MAX_CANDIDATES, mentionsSurname, sameMainTitle, surnameOf, titlePattern, type TranslationEvidence } from "./domain/translation.js";

export type MatchCandidate = { id: string; title: string; author: string; year: number | null };
export type MatchPlan = { kind: "original" } | { kind: "none" } | { kind: "code"; intoWorkId: string } | { kind: "ask"; evidence: TranslationEvidence; candidates: MatchCandidate[] };

type PlanRepo = Pick<BooksRepository, "translationEvidence" | "titleCandidates" | "authorCandidates" | "matchCandidates">;

export function planMatch(repo: PlanRepo, workId: string): MatchPlan | null {
  const rows = repo.translationEvidence(workId);
  if (!rows || rows.editions.length === 0) return null;
  const evidence = evidenceOf(rows);
  if (evidence.originalTitle && sameMainTitle(evidence.originalTitle, evidence.title)) return { kind: "original" };
  const byTitlePattern = evidence.originalTitle ? titlePattern(evidence.originalTitle) : null;
  const byTitle = byTitlePattern ? repo.titleCandidates(byTitlePattern).filter((id) => id !== workId) : [];
  const byAuthorPattern = authorPattern(evidence.workAuthor || evidence.author);
  const byAuthor = byAuthorPattern ? repo.authorCandidates(byAuthorPattern).filter((id) => id !== workId && !byTitle.includes(id)) : [];
  if (byTitle.length === 0 && byAuthor.length === 0) return { kind: "none" };
  if (byTitle.length === 1) {
    const [only] = repo.matchCandidates(byTitle);
    const surname = only ? surnameOf(only.author) : null;
    if (only && surname && mentionsSurname([evidence.workAuthor, evidence.author, ...evidence.summaries], surname)) return { kind: "code", intoWorkId: only.id };
  }
  const ids = [...byTitle, ...byAuthor].slice(0, MAX_CANDIDATES);
  const details = new Map(repo.matchCandidates(ids).map((candidate) => [candidate.id, candidate]));
  const candidates = ids.flatMap((id) => {
    const candidate = details.get(id);
    return candidate ? [{ id, title: candidate.title, author: candidate.author, year: candidate.year }] : [];
  });
  return { kind: "ask", evidence, candidates };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm run build --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/books/domain/translation.ts backend/src/modules/books/domain/translation.test.ts backend/src/modules/books/adapters/sqlite/books.sql backend/src/modules/books/domain/types.ts backend/src/modules/books/domain/ports.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts backend/src/modules/books/translationJudgments.ts backend/src/modules/books/translationJudgments.test.ts backend/package.json && git commit -m "$(cat <<'EOF'
Find a Portuguese work's candidate originals, and settle the clear ones in code

Candidates are works with an edition whose title equals the original
title (matched through the catalog's title keys) and works by the same
first author with an edition that isn't Portuguese. A work whose
original title is its own title is a Portuguese original and is left
alone. Code settles a match only when exactly one work has the original
title and the Portuguese work names that author's surname; everything
else is a question for Jev. Each decision is stored in
work_match_judgments so a work is asked about once.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: The Jev decision and the merge it leads to

**Files:**
- Create: `backend/src/modules/books/adapters/typesafe/jevWorkMatch.ts`
- Create: `backend/src/modules/books/adapters/typesafe/jevWorkMatch.test.ts`. Add `src/modules/books/adapters/typesafe/jevWorkMatch.test.ts` to `backend/package.json` `"test"`, after `src/modules/books/adapters/typesafe/jevSynopsis.test.ts`.
- Modify: `backend/src/modules/books/translationJudgments.ts`
- Test: `backend/src/modules/books/translationJudgments.test.ts`

**Interfaces:**
- Consumes:
  - `askJev`, `realSleep` and `Sleep` (synopsis plan);
  - `failureKind`, `nextUtcMidnight`, `strikeReason`;
  - `planMatch` (Task 5), `mergeTranslation` (Task 2);
  - `JEV_REJECTION_LIMIT` from `synopsisJudgments.ts`.
- Produces, `jevWorkMatch.ts`:
  - `MATCH_DESCRIPTION_LIMIT = 500`
  - `type MatchInput = { edition: { title: string; author: string; originalTitle: string | null; publisher: string | null; description: string | null }; candidates: Array<{ title: string; author: string; year: number | null }> }`
  - `type MatchAnswer = { choice: number | null; confidence: number; model: string }`. The choice is an index into `candidates`, or null for "none".
  - `type ClassifyMatch = (input: MatchInput) => Promise<MatchAnswer>`
  - `candidateLabel(candidate: { title: string; author: string; year: number | null }): string`
  - `createJevMatchClassifier(apiKey: string, spend: Spend, sleep?: Sleep): ClassifyMatch`
- Produces, `translationJudgments.ts`:
  - `type TranslationDeps = { repo: BooksRepository; classify: ClassifyMatch; sharesArena: (fromWorkId: string, intoWorkId: string) => boolean; now: () => number; alert: (subject: string, text: string) => void }`
  - `matchWork(deps: TranslationDeps, workId: string): Promise<number | null>`. It plans the match. For an original, "none" or a code match, it stores the judgment and merges as source `code` unless an arena blocks it. Otherwise it asks Jev and stores the answer, merging at 0.9 or more unless an arena blocks it.
    - Book failures are strikes under task `works`.
    - It returns a pause for budget, outage or key failures, like `classifyText`.
    - A `WorkMergeError` rolls back the judgment, so the next sweep tries again.

- [ ] **Step 1: Write the failing tests**

`backend/src/modules/books/adapters/typesafe/jevWorkMatch.test.ts`:

```ts
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { UnusableAnswerError } from "../../domain/errors.js";
import { candidateLabel, createJevMatchClassifier } from "./jevWorkMatch.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function stub(body: unknown): Array<RequestInit | undefined> {
  const seen: Array<RequestInit | undefined> = [];
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    seen.push(init);
    return Response.json(body);
  }) as typeof fetch;
  return seen;
}

const input = {
  edition: { title: "Passeio ao Farol", author: "Virginia Woolf", originalTitle: "To the Lighthouse", publisher: "Relógio d'Água", description: "x".repeat(600) },
  candidates: [{ title: "Orlando", author: "Virginia Woolf", year: 1928 }, { title: "To the Lighthouse", author: "Virginia Woolf", year: null }]
};

test("asks one choice over the candidates plus none, with the spec's wording", async () => {
  const seen = stub({ model: "jev-1.13.0", answers: { work: { choice: "w2", confidence: 0.97 } } });
  assert.deepEqual(await createJevMatchClassifier("key", () => {}, async () => {})(input), { choice: 1, confidence: 0.97, model: "jev-1.13.0" });
  const body = JSON.parse(String(seen[0]?.body));
  assert.deepEqual(body.state.edition, { title: "Passeio ao Farol", author: "Virginia Woolf", original_title: "To the Lighthouse", publisher: "Relógio d'Água", description: "x".repeat(500) });
  assert.equal(body.questions.work.type, "choice");
  assert.ok(body.questions.work.instructions.startsWith("`edition` is a Portuguese-language edition of a book, possibly a translation."));
  assert.deepEqual(body.questions.work.criteria, {
    w1: "Orlando — Virginia Woolf (earliest edition 1928)",
    w2: "To the Lighthouse — Virginia Woolf",
    none: "None of the listed works: the edition is a different book from all of them"
  });
});

test("none is no choice, and an unknown option is unusable", async () => {
  stub({ model: "jev-1.13.0", answers: { work: { choice: "none", confidence: 0.81 } } });
  assert.deepEqual(await createJevMatchClassifier("key", () => {}, async () => {})(input), { choice: null, confidence: 0.81, model: "jev-1.13.0" });
  stub({ model: "jev-1.13.0", answers: { work: { choice: "w9", confidence: 0.5 } } });
  await assert.rejects(createJevMatchClassifier("key", () => {}, async () => {})(input), UnusableAnswerError);
});

test("a candidate label leaves out an unknown year", () => {
  assert.equal(candidateLabel({ title: "Solaris", author: "Stanisław Lem", year: null }), "Solaris — Stanisław Lem");
});
```

Append to `translationJudgments.test.ts`:
- Add `const { matchWork } = await import("./translationJudgments.js");` and `const { SourceUnavailableError, UnusableAnswerError } = await import("./domain/errors.js");` to the imports. The `edition` helper and `freshRepo` are already in the file.
- Then append:

```ts
const NOW = Date.parse(AT);
function matching(repo: Repo, answer: () => Promise<{ choice: number | null; confidence: number; model: string }>, blocked = false) {
  const asked: Array<{ candidates: Array<{ title: string }> }> = [];
  const alerts: string[] = [];
  const deps = {
    repo,
    classify: async (input: { candidates: Array<{ title: string; author: string; year: number | null }> }) => {
      asked.push(input);
      return answer();
    },
    sharesArena: () => blocked,
    now: () => NOW,
    alert: (subject: string) => { alerts.push(subject); }
  };
  return { deps, asked, alerts };
}

function lighthouse(repo: Repo, ptAuthor: string) {
  const en = edition(repo, "9780156907450", { title: "To the Lighthouse", author: "Virginia Woolf", workKey: "OL950W" });
  const orlando = edition(repo, "9780156907451", { title: "Orlando", author: "Virginia Woolf", workKey: "OL951W" });
  const pt = edition(repo, "9789720000450", { title: "Passeio ao Farol", author: ptAuthor, language: "pt-PT", originalTitle: "To the Lighthouse", workKey: "OL952W" });
  return { en, orlando, pt };
}

test("a code match merges without asking Jev, and is recorded as code", async () => {
  const repo = freshRepo();
  const { en, pt } = lighthouse(repo, "Virginia Woolf");
  const { deps, asked } = matching(repo, async () => ({ choice: 0, confidence: 1, model: "jev-1.13.0" }));
  assert.equal(await matchWork(deps, pt.work_id!), null);
  assert.equal(asked.length, 0);
  assert.equal(repo.getBook(pt.id)!.work_id, en.work_id);
  assert.deepEqual(repo.workMatchJudgments([pt.work_id!]).get(pt.work_id!), { model: "code", intoWorkId: en.work_id, confidence: null, askedAt: AT });
});

test("an arena holding both works blocks the merge but keeps the decision", async () => {
  const repo = freshRepo();
  const { en, pt } = lighthouse(repo, "Virginia Woolf");
  const { deps } = matching(repo, async () => ({ choice: 0, confidence: 1, model: "jev-1.13.0" }), true);
  await matchWork(deps, pt.work_id!);
  assert.equal(repo.getBook(pt.id)!.work_id, pt.work_id);
  assert.equal(repo.workMatchJudgments([pt.work_id!]).get(pt.work_id!)?.intoWorkId, en.work_id);
});

test("Jev merges at 0.9, stores a doubt below it, and stores none as no work", async () => {
  const high = freshRepo();
  const sure = lighthouse(high, "");
  const { deps, asked } = matching(high, async () => ({ choice: asked[0]!.candidates.findIndex((candidate) => candidate.title === "To the Lighthouse"), confidence: 0.93, model: "jev-1.13.0" }));
  await matchWork(deps, sure.pt.work_id!);
  assert.equal(high.getBook(sure.pt.id)!.work_id, sure.en.work_id);

  const mid = freshRepo();
  const doubt = lighthouse(mid, "");
  await matchWork(matching(mid, async () => ({ choice: 0, confidence: 0.74, model: "jev-1.13.0" })).deps, doubt.pt.work_id!);
  assert.equal(mid.getBook(doubt.pt.id)!.work_id, doubt.pt.work_id);
  assert.equal(mid.workMatchJudgments([doubt.pt.work_id!]).get(doubt.pt.work_id!)?.confidence, 0.74);

  const none = freshRepo();
  const nothing = lighthouse(none, "");
  await matchWork(matching(none, async () => ({ choice: null, confidence: 0.88, model: "jev-1.13.0" })).deps, nothing.pt.work_id!);
  assert.deepEqual(none.workMatchJudgments([nothing.pt.work_id!]).get(nothing.pt.work_id!), { model: "jev-1.13.0", intoWorkId: null, confidence: 0.88, askedAt: AT });
});

test("an unusable answer is a strike under works; a 401 pauses and alerts; nothing is stored", async () => {
  const repo = freshRepo();
  const { pt } = lighthouse(repo, "");
  assert.equal(await matchWork(matching(repo, async () => { throw new UnusableAnswerError("typesafe", "unexpected answer"); }).deps, pt.work_id!), null);
  assert.equal(repo.jevRejections("works", [pt.work_id!]).get(pt.work_id!)?.attempts, 1);
  const key = matching(repo, async () => { throw new SourceUnavailableError("typesafe", "HTTP 401", { status: 401 }); });
  assert.equal(await matchWork(key.deps, pt.work_id!), NOW + 24 * 60 * 60 * 1000);
  assert.deepEqual(key.alerts, ["TypeSafe rejected the translation requests"]);
  assert.equal(repo.workMatchJudgments([pt.work_id!]).size, 0);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run typecheck --workspace backend`
Expected: FAIL. `./jevWorkMatch.js` and `matchWork` don't exist.

- [ ] **Step 3: Implement**

Create `jevWorkMatch.ts`:

```ts
import { UnusableAnswerError } from "../../domain/errors.js";
import type { Spend } from "../../typesafe.js";
import { askJev, realSleep, type Sleep } from "./jevRequest.js";

export const MATCH_DESCRIPTION_LIMIT = 500;

export type MatchInput = {
  edition: { title: string; author: string; originalTitle: string | null; publisher: string | null; description: string | null };
  candidates: Array<{ title: string; author: string; year: number | null }>;
};
export type MatchAnswer = { choice: number | null; confidence: number; model: string };
export type ClassifyMatch = (input: MatchInput) => Promise<MatchAnswer>;

const INSTRUCTIONS = "`edition` is a Portuguese-language edition of a book, possibly a translation. Which of the listed works is the work this edition is an edition of? Titles of the works may be in the original language. Pick none when no listed work is the same book.";
const NONE = "None of the listed works: the edition is a different book from all of them";

export function candidateLabel(candidate: { title: string; author: string; year: number | null }): string {
  return `${candidate.title} — ${candidate.author}${candidate.year !== null ? ` (earliest edition ${candidate.year})` : ""}`;
}

function answerOf(body: unknown, count: number): MatchAnswer {
  const answer = (body as { answers?: { work?: { choice?: unknown; confidence?: unknown } } } | null)?.answers?.work;
  const model = (body as { model?: unknown } | null)?.model;
  const index = typeof answer?.choice === "string" && /^w\d+$/.test(answer.choice) ? Number(answer.choice.slice(1)) - 1 : null;
  const known = answer?.choice === "none" || (index !== null && index >= 0 && index < count);
  if (!known || typeof answer?.confidence !== "number" || typeof model !== "string") throw new UnusableAnswerError("typesafe", "unexpected answer");
  return { choice: answer.choice === "none" ? null : index, confidence: answer.confidence, model };
}

export function createJevMatchClassifier(apiKey: string, spend: Spend, sleep: Sleep = realSleep): ClassifyMatch {
  return async (input) => {
    const criteria = Object.fromEntries([...input.candidates.map((candidate, index) => [`w${index + 1}`, candidateLabel(candidate)]), ["none", NONE]]);
    const edition = {
      title: input.edition.title,
      author: input.edition.author,
      ...(input.edition.originalTitle ? { original_title: input.edition.originalTitle } : {}),
      publisher: input.edition.publisher,
      description: input.edition.description?.slice(0, MATCH_DESCRIPTION_LIMIT) ?? null
    };
    return answerOf(await askJev(apiKey, spend, sleep, { edition }, { work: { type: "choice", instructions: INSTRUCTIONS, criteria } }), input.candidates.length);
  };
}
```

Add to `translationJudgments.ts`:
- Extend its imports:

```ts
import type { ClassifyMatch } from "./adapters/typesafe/jevWorkMatch.js";
import { WorkMergeError } from "./domain/errors.js";
import { MATCH_MERGE_AT } from "./domain/translation.js";
import { failureKind, nextUtcMidnight, strikeReason } from "./typesafe.js";
```

- Then append:

```ts
const OUTAGE_PAUSE_MS = 10 * 60 * 1000;
const KEY_PAUSE_MS = 24 * 60 * 60 * 1000;

export type TranslationDeps = {
  repo: BooksRepository;
  classify: ClassifyMatch;
  sharesArena: (fromWorkId: string, intoWorkId: string) => boolean;
  now: () => number;
  alert: (subject: string, text: string) => void;
};

function decide(deps: TranslationDeps, workId: string, model: string, intoWorkId: string | null, confidence: number | null, merge: boolean, at: string) {
  try {
    deps.repo.transaction(() => {
      deps.repo.saveWorkMatchJudgment(workId, { model, intoWorkId, confidence, askedAt: at });
      deps.repo.clearJevRejection("works", workId);
      if (merge && intoWorkId && !deps.sharesArena(workId, intoWorkId)) deps.repo.mergeTranslation(workId, intoWorkId, model === "code" ? "code" : "jev", confidence, at);
    });
  } catch (error) {
    if (!(error instanceof WorkMergeError)) throw error;
  }
}

export async function matchWork(deps: TranslationDeps, workId: string): Promise<number | null> {
  const at = () => new Date(deps.now()).toISOString();
  const plan = planMatch(deps.repo, workId);
  if (!plan) return null;
  if (plan.kind === "original" || plan.kind === "none") {
    decide(deps, workId, "code", null, null, false, at());
    return null;
  }
  if (plan.kind === "code") {
    decide(deps, workId, "code", plan.intoWorkId, null, true, at());
    return null;
  }
  try {
    const { evidence, candidates } = plan;
    const answer = await deps.classify({ edition: { title: evidence.title, author: evidence.author, originalTitle: evidence.originalTitle, publisher: evidence.publisher, description: evidence.summary }, candidates });
    const into = answer.choice === null ? null : candidates[answer.choice]!.id;
    decide(deps, workId, answer.model, into, answer.confidence, answer.confidence >= MATCH_MERGE_AT, at());
    return null;
  } catch (error) {
    const kind = failureKind(error);
    if (kind === "book") {
      deps.repo.recordJevRejection({ task: "works", subject: workId, ...strikeReason(error), at: at() });
      return null;
    }
    if (kind === "budget") return nextUtcMidnight(deps.now());
    if (kind === "outage") return deps.now() + OUTAGE_PAUSE_MS;
    if (kind === "key") {
      deps.alert("TypeSafe rejected the translation requests", "TypeSafe answered 401, so translation matching is paused for a day. Check TYPESAFE_API_KEY.");
      return deps.now() + KEY_PAUSE_MS;
    }
    throw error;
  }
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm run typecheck --workspace backend && npm test --workspace backend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/books/adapters/typesafe/jevWorkMatch.ts backend/src/modules/books/adapters/typesafe/jevWorkMatch.test.ts backend/src/modules/books/translationJudgments.ts backend/src/modules/books/translationJudgments.test.ts backend/package.json && git commit -m "$(cat <<'EOF'
Ask Jev which work a Portuguese edition belongs to, and merge the sure ones

Jev gets the edition's title, author, original title, publisher and the
first 500 characters of its synopsis, and picks one of up to 40
candidates or none. At 0.9 or more the work merges into its original;
that line was about 99% right on the 2026-10-14/15 samples once Open
Library's duplicate works were set aside. From 0.5 it waits for
review. An arena holding both works keeps the decision but blocks the
merge. A merge that no longer applies rolls the decision back so the
next sweep looks again.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: The queue, the sweep and the details hook

**Files:**
- Modify: `backend/src/modules/books/translationJudgments.ts`
- Test: `backend/src/modules/books/translationJudgments.test.ts`
- Modify: `backend/src/modules/books/plugin.ts`

**Interfaces:**
- Consumes:
  - `matchWork` (Task 6);
  - `createWorkQueue`, `startDetailsBackfill`, `dailySpend`;
  - `JEV_REJECTION_LIMIT` (synopsis plan), `isPortuguese` (Task 5);
  - `createJevMatchClassifier` (Task 6);
  - `options.worksShareAnArena` (Task 4).
- Produces:
  - `WORK_MATCH_SOURCE = "works"`, `WORK_MATCH_DAILY_BUDGET = 1000`
  - `judgeWorkMatch(deps: TranslationDeps & { heldWorkIds: () => string[] }, workId: string): Promise<number | null>`: canonical, held, Portuguese and still needing a match, then `matchWork`.
  - `startTranslationJobs(deps: TranslationDeps & { heldWorkIds: () => string[]; onError: (error: unknown, workId?: string) => void }): TranslationJobs`, where `TranslationJobs = { add(workId: string): void; stop(): void }`.
  - `startTranslationJobsIfConfigured(apiKey: string, deps: Omit<Parameters<typeof startTranslationJobs>[0], "classify">): TranslationJobs | null`
  - `onDetailsChecked` adds the work of a book with a Portuguese language.

- [ ] **Step 1: Write the failing tests**

Append to `translationJudgments.test.ts`:
- Add `const { judgeWorkMatch, startTranslationJobs } = await import("./translationJudgments.js");`.
- Then append:

```ts
test("only a held, Portuguese work that still needs a match is judged, through its canonical id", async () => {
  const repo = freshRepo();
  const { en, pt } = lighthouse(repo, "Virginia Woolf");
  const { deps } = matching(repo, async () => ({ choice: 0, confidence: 1, model: "jev-1.13.0" }));
  assert.equal(await judgeWorkMatch({ ...deps, heldWorkIds: () => [] }, pt.work_id!), null);
  assert.equal(repo.workMatchJudgments([pt.work_id!]).size, 0);
  assert.equal(await judgeWorkMatch({ ...deps, heldWorkIds: () => [en.work_id!] }, en.work_id!), null);
  assert.equal(repo.workMatchJudgments([en.work_id!]).size, 0);
  await judgeWorkMatch({ ...deps, heldWorkIds: () => [pt.work_id!] }, pt.work_id!);
  assert.equal(repo.getBook(pt.id)!.work_id, en.work_id);
});

test("adding a work only queues it; matching happens after the caller returns", async () => {
  const repo = freshRepo();
  const { pt } = lighthouse(repo, "");
  const { deps, asked } = matching(repo, async () => ({ choice: null, confidence: 0.9, model: "jev-1.13.0" }));
  const jobs = startTranslationJobs({ ...deps, heldWorkIds: () => [pt.work_id!], onError: (error) => { throw error; } });
  jobs.add(pt.work_id!);
  assert.equal(asked.length, 0);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(asked.length, 1);
  jobs.stop();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run typecheck --workspace backend`
Expected: FAIL. `judgeWorkMatch` and `startTranslationJobs` don't exist.

- [ ] **Step 3: Implement**

Add to `translationJudgments.ts`:
- Extend the imports:

```ts
import { createJevMatchClassifier } from "./adapters/typesafe/jevWorkMatch.js";
import { startDetailsBackfill } from "./backfill.js";
import { JEV_REJECTION_LIMIT } from "./synopsisJudgments.js";
import { dailySpend } from "./typesafe.js";
import { createWorkQueue } from "./workQueue.js";
```

  Merge `dailySpend` into the existing `./typesafe.js` import instead of adding a second line.
- Then append:

```ts
export const WORK_MATCH_SOURCE = "works";
export const WORK_MATCH_DAILY_BUDGET = 1000;
const IN_FLIGHT = 4;
const SWEEP_LIMIT = 1000;
const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

type HeldDeps = TranslationDeps & { heldWorkIds: () => string[] };
export type TranslationJobs = { add(workId: string): void; stop(): void };

function heldCanonical(deps: HeldDeps): Set<string> {
  return new Set(deps.repo.canonicalWorkIds(deps.heldWorkIds()).values());
}

export async function judgeWorkMatch(deps: HeldDeps, workId: string): Promise<number | null> {
  const canonical = deps.repo.canonicalWorkIds([workId]).get(workId);
  if (!canonical || !heldCanonical(deps).has(canonical)) return null;
  if (deps.repo.portugueseWorksNeedingMatch([canonical], 1, JEV_REJECTION_LIMIT, null).length === 0) return null;
  return matchWork(deps, canonical);
}

export function startTranslationJobs(deps: HeldDeps & { onError: (error: unknown, workId?: string) => void }): TranslationJobs {
  let quietUntil = 0;
  const alert = (subject: string, text: string) => {
    if (deps.now() < quietUntil) return;
    quietUntil = deps.now() + KEY_PAUSE_MS;
    deps.alert(subject, text);
  };
  const judged = { ...deps, alert };
  const queue = createWorkQueue({ concurrency: IN_FLIGHT, now: deps.now, run: (workId) => judgeWorkMatch(judged, workId), onError: deps.onError });
  const stopSweep = startDetailsBackfill(
    async () => {
      for (const workId of deps.repo.portugueseWorksNeedingMatch([...heldCanonical(deps)], SWEEP_LIMIT, JEV_REJECTION_LIMIT, null)) queue.add(workId);
      return null;
    },
    (error) => deps.onError(error),
    SWEEP_INTERVAL_MS
  );
  return {
    add: (workId) => queue.add(workId),
    stop: () => {
      stopSweep();
      queue.stop();
    }
  };
}

export function startTranslationJobsIfConfigured(apiKey: string, deps: Omit<Parameters<typeof startTranslationJobs>[0], "classify">): TranslationJobs | null {
  if (apiKey === "") return null;
  return startTranslationJobs({ ...deps, classify: createJevMatchClassifier(apiKey, dailySpend(deps.repo, WORK_MATCH_SOURCE, WORK_MATCH_DAILY_BUDGET, deps.now)) });
}
```

In `plugin.ts`:
- Add `import { startTranslationJobsIfConfigured } from "./translationJudgments.js";` and `import { isPortuguese } from "./domain/translation.js";`.
- After `synopsisJobs`, add:

```ts
  const sharesArena = (a: string, b: string) => options.worksShareAnArena?.([a, ...repo.aliasesOf([a])], [b, ...repo.aliasesOf([b])]) ?? false;
  const translationJobs = heldWorks
    ? startTranslationJobsIfConfigured(env.TYPESAFE_API_KEY, {
        repo,
        sharesArena,
        heldWorkIds: () => heldWorks().map((work) => work.workId),
        now: Date.now,
        alert: alertTypesafe,
        onError: (error, workId) => app.log.error({ err: error, workId }, "translation matching failed")
      })
    : null;
```

- In the `onDetailsChecked` listener, add `if (isPortuguese(book.language)) translationJobs?.add(book.work_id);` after `synopsisJobs?.add(book.work_id);`.
- In `onClose`, add `translationJobs?.stop();`.

- [ ] **Step 4: Run to verify they pass**

Run: `npm run typecheck --workspace backend && npm test --workspace backend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/books/translationJudgments.ts backend/src/modules/books/translationJudgments.test.ts backend/src/modules/books/plugin.ts && git commit -m "$(cat <<'EOF'
Match newly checked Portuguese books to their originals in the background

A finished details lookup for a book in Portuguese adds its work to a
translation queue, beside the genre and synopsis queues, and a daily
sweep catches what the queue missed. Jev spends from its own works
budget, 1,000 a day, and only after code has tried. The request that
triggered the lookup never waits.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: The translation backlog script

**Files:**
- Create: `backend/src/modules/books/translationBacklog.ts`
- Create: `backend/src/modules/books/translationBacklog.test.ts`. Add `src/modules/books/translationBacklog.test.ts` to `backend/package.json` `"test"`, after `src/modules/books/translationJudgments.test.ts`.
- Create: `backend/scripts/translation-backlog.mjs`
- Modify: `backend/README.md`

**Interfaces:**
- Consumes:
  - `planMatch`, `matchWork` and `TranslationDeps` (Tasks 5 and 6);
  - `fillOriginalTitlesFromSummaries` (Task 1), `portugueseWorksNeedingMatch` (Task 5);
  - `JEV_REJECTION_LIMIT`, `runBudget`, `failureKind`;
  - the arena repository's `worksShareATournament` (Task 4).
- Produces:
  - `TRANSLATION_BACKLOG_SOURCE = "works-backlog"`
  - `RECHECK_AFTER_MS = 30 * 24 * 60 * 60 * 1000`
  - `translationBacklogWorks(repo, heldWorkIds: string[], recheckBefore: string | null): string[]`: held works first, then oldest.
  - `translationDryRun(repo, workIds: string[], max: number)`
  - `runCodeSteps(deps: TranslationDeps, workIds: string[]): { originals: number; noCandidates: number; codeMerges: number; codeBlocked: number; ask: string[] }`
  - `runTranslationBacklog(deps: TranslationDeps, workIds: string[]): Promise<{ asked: string[]; stoppedBy: "done" | "budget" | "outage" | "key" }>`
  - `translationBacklogReport(repo, input)`

- [ ] **Step 1: Write the failing tests**

`backend/src/modules/books/translationBacklog.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "translation-backlog-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("./adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("./adapters/sqlite/sqliteBooksRepository.js");
const { runBudget } = await import("./typesafe.js");
const { runCodeSteps, runTranslationBacklog, translationBacklogReport, translationBacklogWorks, translationDryRun, TRANSLATION_BACKLOG_SOURCE } = await import("./translationBacklog.js");

type Repo = ReturnType<typeof createSqliteBooksRepository>;
const AT = "2026-10-15T12:00:00.000Z";
const NOW = Date.parse(AT);

function freshRepo(): Repo {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  return createSqliteBooksRepository(db);
}

function book(repo: Repo, isbn: string, title: string, author: string, extra: { workKey?: string; language?: string; summary?: string } = {}) {
  const row = repo.createBook({ title, author, isbn, workKey: extra.workKey }, [`isbn:${isbn}`], AT);
  if (extra.language) repo.setLanguage(row.id, extra.language);
  if (extra.summary) repo.mergeDetails(row.id, { summary: extra.summary, pages: null, year: null, publisher: null, translator: null }, "publisher");
  return repo.getBook(row.id)!;
}

function seedCatalog(repo: Repo) {
  const en = book(repo, "9780156907501", "To the Lighthouse", "Virginia Woolf", { workKey: "OL960W" });
  const codePt = book(repo, "9789720000501", "Passeio ao Farol", "Virginia Woolf", { language: "pt-PT", summary: "Uma família na Escócia.\n\nTítulo original: To the Lighthouse" });
  const original = book(repo, "9789720000502", "Memorial do Convento", "José Saramago", { language: "pt-PT", summary: "Um convento e uma passarola.\n\nTítulo original: Memorial do Convento" });
  const lonely = book(repo, "9789720000503", "Sem Autor", "", { language: "pt-PT" });
  const idiotEn = book(repo, "9780000000504", "The Idiot", "Fyodor Dostoevsky", { workKey: "OL961W" });
  const ask = book(repo, "9789720000505", "O Idiota", "Fyodor Dostoevsky", { language: "pt-PT" });
  return { en, codePt, original, lonely, idiotEn, ask };
}

const deps = (repo: Repo, classify: () => Promise<{ choice: number | null; confidence: number; model: string }>) => ({ repo, classify, sharesArena: () => false, now: () => NOW, alert: () => {} });

test("the dry run counts every step and writes nothing", () => {
  const repo = freshRepo();
  const c = seedCatalog(repo);
  const works = translationBacklogWorks(repo, [c.ask.work_id!], null);
  assert.equal(works[0], c.ask.work_id);
  assert.deepEqual(translationDryRun(repo, works, 10), { selected: 4, originalTitles: 2, originals: 1, noCandidates: 1, codeMerges: 1, wouldAsk: 1, max: 10 });
  assert.equal(repo.getBook(c.codePt.id)!.original_title, null);
  assert.equal(repo.workMatchJudgments(works).size, 0);
});

test("the code steps fill original titles, record originals, merge clear matches and leave the rest for Jev", () => {
  const repo = freshRepo();
  const c = seedCatalog(repo);
  const works = translationBacklogWorks(repo, [], null);
  const steps = runCodeSteps(deps(repo, async () => ({ choice: null, confidence: 0, model: "x" })), works);
  assert.deepEqual({ ...steps, ask: steps.ask }, { originals: 1, noCandidates: 1, codeMerges: 1, codeBlocked: 0, ask: [c.ask.work_id] });
  assert.equal(repo.getBook(c.codePt.id)!.original_title, "To the Lighthouse");
  assert.equal(repo.getBook(c.codePt.id)!.work_id, c.en.work_id);
});

test("the Jev step stops at --max under its own source, and the report counts outcomes", async () => {
  const repo = freshRepo();
  const c = seedCatalog(repo);
  const second = book(repo, "9789720000506", "Crime e Castigo", "Fyodor Dostoevsky", { language: "pt-PT" });
  const steps = runCodeSteps(deps(repo, async () => ({ choice: null, confidence: 0, model: "x" })), translationBacklogWorks(repo, [], null));
  const budget = runBudget(repo, TRANSLATION_BACKLOG_SOURCE, 1, () => NOW);
  const result = await runTranslationBacklog(deps(repo, async () => {
    budget.spend();
    return { choice: 0, confidence: 0.95, model: "jev-1.13.0" };
  }), steps.ask);
  assert.equal(result.stoppedBy, "budget");
  assert.equal(result.asked.length, 1);
  assert.equal(repo.typesafeUsage("2026-10-15", TRANSLATION_BACKLOG_SOURCE), 1);
  const report = translationBacklogReport(repo, { steps, asked: result.asked, stoppedBy: result.stoppedBy, requests: budget.used(), originalTitles: 2 });
  assert.equal(report.jevMerges, 1);
  assert.equal(report.requests, 1);
  assert.ok([c.ask.work_id, second.work_id].includes(result.asked[0]!));
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run typecheck --workspace backend`
Expected: FAIL. `./translationBacklog.js` doesn't exist.

- [ ] **Step 3: Implement**

Create `backend/src/modules/books/translationBacklog.ts`:

```ts
import type { BooksRepository } from "./domain/ports.js";
import { MATCH_MERGE_AT, MATCH_REVIEW_AT } from "./domain/translation.js";
import { JEV_REJECTION_LIMIT } from "./synopsisJudgments.js";
import { matchWork, planMatch, type TranslationDeps } from "./translationJudgments.js";
import { failureKind, type FailureKind } from "./typesafe.js";
import type { ClassifyMatch } from "./adapters/typesafe/jevWorkMatch.js";

export const TRANSLATION_BACKLOG_SOURCE = "works-backlog";
export const RECHECK_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
const IN_FLIGHT = 4;
const COST_PER_REQUEST_USD = 0.00012;

export type TranslationBacklogStop = "done" | "budget" | "outage" | "key";
export type CodeSteps = { originals: number; noCandidates: number; codeMerges: number; codeBlocked: number; ask: string[] };

export function translationBacklogWorks(repo: Pick<BooksRepository, "canonicalWorkIds" | "portugueseWorksNeedingMatch">, heldWorkIds: string[], recheckBefore: string | null): string[] {
  const held = new Set(repo.canonicalWorkIds(heldWorkIds).values());
  const works = repo.portugueseWorksNeedingMatch(null, Number.MAX_SAFE_INTEGER, JEV_REJECTION_LIMIT, recheckBefore);
  return [...works.filter((id) => held.has(id)), ...works.filter((id) => !held.has(id))];
}

export function translationDryRun(repo: Pick<BooksRepository, "translationEvidence" | "titleCandidates" | "authorCandidates" | "matchCandidates">, workIds: string[], max: number) {
  const counts = { selected: workIds.length, originalTitles: 0, originals: 0, noCandidates: 0, codeMerges: 0, wouldAsk: 0, max };
  for (const workId of workIds) {
    const rows = repo.translationEvidence(workId);
    if (rows?.editions.some((edition) => !edition.originalTitle && /t[íi]tulo original/i.test(edition.summary ?? ""))) counts.originalTitles += 1;
    const plan = planMatch(repo, workId);
    if (plan?.kind === "original") counts.originals += 1;
    else if (plan?.kind === "none") counts.noCandidates += 1;
    else if (plan?.kind === "code") counts.codeMerges += 1;
    else if (plan?.kind === "ask") counts.wouldAsk += 1;
  }
  counts.wouldAsk = Math.min(counts.wouldAsk, max);
  return counts;
}

export function runCodeSteps(deps: TranslationDeps, workIds: string[]): CodeSteps {
  const steps: CodeSteps = { originals: 0, noCandidates: 0, codeMerges: 0, codeBlocked: 0, ask: [] };
  const at = new Date(deps.now()).toISOString();
  deps.repo.fillOriginalTitlesFromSummaries();
  for (const workId of workIds) {
    const plan = planMatch(deps.repo, workId);
    if (!plan) continue;
    if (plan.kind === "ask") {
      steps.ask.push(workId);
      continue;
    }
    if (plan.kind === "code") {
      const blocked = deps.sharesArena(workId, plan.intoWorkId);
      deps.repo.transaction(() => {
        deps.repo.saveWorkMatchJudgment(workId, { model: "code", intoWorkId: plan.intoWorkId, confidence: null, askedAt: at });
        if (!blocked) deps.repo.mergeTranslation(workId, plan.intoWorkId, "code", null, at);
      });
      if (blocked) steps.codeBlocked += 1;
      else steps.codeMerges += 1;
      continue;
    }
    deps.repo.saveWorkMatchJudgment(workId, { model: "code", intoWorkId: null, confidence: null, askedAt: at });
    if (plan.kind === "original") steps.originals += 1;
    else steps.noCandidates += 1;
  }
  return steps;
}

export async function runTranslationBacklog(deps: TranslationDeps, workIds: string[]): Promise<{ asked: string[]; stoppedBy: TranslationBacklogStop }> {
  let lastFailure: FailureKind | null = null;
  const classify: ClassifyMatch = async (input) => {
    try {
      return await deps.classify(input);
    } catch (error) {
      lastFailure = failureKind(error);
      throw error;
    }
  };
  const asked: string[] = [];
  let stoppedBy: TranslationBacklogStop = "done";
  let next = 0;
  const worker = async () => {
    while (stoppedBy === "done" && next < workIds.length) {
      const workId = workIds[next++]!;
      const pause = await matchWork({ ...deps, classify }, workId);
      if (pause === null) asked.push(workId);
      else if (stoppedBy === "done") stoppedBy = lastFailure === "budget" || lastFailure === "key" ? lastFailure : "outage";
    }
  };
  await Promise.all(Array.from({ length: IN_FLIGHT }, worker));
  return { asked, stoppedBy };
}

export function translationBacklogReport(
  repo: Pick<BooksRepository, "workMatchJudgments" | "jevRejections" | "canonicalWorkIds">,
  input: { steps: CodeSteps; asked: string[]; stoppedBy: TranslationBacklogStop | "no-key"; requests: number; originalTitles: number }
) {
  const judgments = repo.workMatchJudgments(input.asked);
  const merged = repo.canonicalWorkIds(input.asked);
  const counts = { jevMerges: 0, jevBlocked: 0, possible: 0, none: 0 };
  for (const workId of input.asked) {
    const judgment = judgments.get(workId);
    if (!judgment) continue;
    if (judgment.intoWorkId === null || (judgment.confidence ?? 0) < MATCH_REVIEW_AT) counts.none += 1;
    else if ((judgment.confidence ?? 0) < MATCH_MERGE_AT) counts.possible += 1;
    else if (merged.get(workId) !== workId) counts.jevMerges += 1;
    else counts.jevBlocked += 1;
  }
  return {
    originalTitles: input.originalTitles,
    originals: input.steps.originals,
    noCandidates: input.steps.noCandidates,
    codeMerges: input.steps.codeMerges,
    codeBlocked: input.steps.codeBlocked,
    ...counts,
    strikes: repo.jevRejections("works", input.asked).size,
    stoppedBy: input.stoppedBy,
    requests: input.requests,
    estimatedCostUsd: Number((input.requests * COST_PER_REQUEST_USD).toFixed(2))
  };
}
```

Create `backend/scripts/translation-backlog.mjs`:

```js
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { max: { type: "string" }, "dry-run": { type: "boolean", default: false }, "recheck-none": { type: "boolean", default: false } } });
const max = Number(values.max);
if (!Number.isInteger(max) || max <= 0) {
  console.error("Usage: node scripts/translation-backlog.mjs --max N [--dry-run] [--recheck-none]");
  process.exit(1);
}
for (const name of ["COVERS_DB_PATH", "LIBRARY_DB_PATH", "ARENA_DB_PATH"]) {
  if (!process.env[name]) {
    console.error(`Missing environment variable: ${name}`);
    process.exit(1);
  }
}

const { openBooksDb } = await import("../dist/modules/books/adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("../dist/modules/books/adapters/sqlite/sqliteBooksRepository.js");
const { createSqliteArenaRepository } = await import("../dist/modules/arena/adapters/sqlite/sqliteArenaRepository.js");
const { createWorkHolders } = await import("../dist/modules/library/workHolders.js");
const { RECHECK_AFTER_MS, runCodeSteps, runTranslationBacklog, translationBacklogReport, translationBacklogWorks, translationDryRun, TRANSLATION_BACKLOG_SOURCE } = await import("../dist/modules/books/translationBacklog.js");

const repo = createSqliteBooksRepository(openBooksDb());
const arena = createSqliteArenaRepository(new DatabaseSync(process.env.ARENA_DB_PATH, { readOnly: true }));
const held = createWorkHolders(new DatabaseSync(process.env.LIBRARY_DB_PATH, { readOnly: true })).heldWorks().map((work) => work.workId);
const recheckBefore = values["recheck-none"] ? new Date(Date.now() - RECHECK_AFTER_MS).toISOString() : null;
const works = translationBacklogWorks(repo, held, recheckBefore);
const sharesArena = (a, b) => arena.worksShareATournament([a, ...repo.aliasesOf([a])], [b, ...repo.aliasesOf([b])]);

if (values["dry-run"]) {
  console.log(JSON.stringify(translationDryRun(repo, works, max), null, 2));
} else {
  const alert = (subject, text) => console.error(`${subject}: ${text}`);
  const originalTitles = translationDryRun(repo, works, max).originalTitles;
  const steps = runCodeSteps({ repo, classify: async () => { throw new Error("no Jev in the code steps"); }, sharesArena, now: Date.now, alert }, works);
  if (!process.env.TYPESAFE_API_KEY) {
    console.log(JSON.stringify(translationBacklogReport(repo, { steps, asked: [], stoppedBy: "no-key", requests: 0, originalTitles }), null, 2));
    console.error("TYPESAFE_API_KEY is not set: the code steps ran and the Jev step was skipped.");
  } else {
    const { createJevMatchClassifier } = await import("../dist/modules/books/adapters/typesafe/jevWorkMatch.js");
    const { runBudget } = await import("../dist/modules/books/typesafe.js");
    const budget = runBudget(repo, TRANSLATION_BACKLOG_SOURCE, max, Date.now);
    const result = await runTranslationBacklog({ repo, classify: createJevMatchClassifier(process.env.TYPESAFE_API_KEY, budget.spend), sharesArena, now: Date.now, alert }, steps.ask);
    console.log(JSON.stringify(translationBacklogReport(repo, { steps, asked: result.asked, stoppedBy: result.stoppedBy, requests: budget.used(), originalTitles }), null, 2));
  }
}
```

In `backend/README.md`, add a "Translation backlog" section after the synopsis backlog section. It gives:
- the command, run over `railway ssh` in `/app/backend`: dry run first, then without `--dry-run`, with `--max` at the dry run's `wouldAsk`;
- what `--recheck-none` does;
- the env it needs (`COVERS_DB_PATH`, `LIBRARY_DB_PATH`, `ARENA_DB_PATH`);
- the volume check before running, and holding merges to main during the run, as for the other backlogs;
- the report's fields.

- [ ] **Step 4: Run to verify they pass, then smoke-test the script**

Run: `npm run typecheck --workspace backend && npm test --workspace backend`
Expected: PASS.

Run this smoke test:

```bash
npm run build --workspace backend && (cd backend && D=$(mktemp -d) && COVERS_DB_PATH=$D/covers.sqlite AUTH_DB_PATH=$D/auth.sqlite LIBRARY_DB_PATH=$D/library.sqlite GALLERY_DB_PATH=$D/gallery.sqlite ARENA_DB_PATH=$D/arena.sqlite JWT_ACCESS_SECRET=$(printf 'a%.0s' {1..64}) JWT_REFRESH_SECRET=$(printf 'b%.0s' {1..64}) node scripts/translation-backlog.mjs --max 10 --dry-run)
```

- Expected: the dry-run JSON with every count 0 and `"max": 10`.
- If a database opened read-only doesn't exist yet, create it first with its module's migrations, as the earlier smoke runs did, and report what you did.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/books/translationBacklog.ts backend/src/modules/books/translationBacklog.test.ts backend/scripts/translation-backlog.mjs backend/README.md backend/package.json && git commit -m "$(cat <<'EOF'
Add the owner-run translation backlog script

The catalog's Portuguese works are matched once, held ones first: code
fills original titles from stored summaries, records Portuguese
originals and works with no candidates, and merges the clear matches,
all without TypeSafe. Jev then decides the rest, 4 in flight, until
--max requests under works-backlog. --recheck-none asks again about
non-manual "none" answers older than 30 days, since their original may
have arrived. The arena database is opened read-only for the merge
check.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: The review list and its endpoints

**Files:**
- Create: `packages/shared/src/works/translationReview.ts`
- Create: `packages/shared/src/works/translationReview.test.ts`
- Modify: `packages/shared/src/works/index.ts`
- Modify: `backend/src/modules/books/domain/ports.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Create: `backend/src/modules/books/translationReview.ts`
- Create: `backend/src/modules/books/translationReview.test.ts`. Add `src/modules/books/translationReview.test.ts` to `backend/package.json` `"test"`, after `src/modules/books/synopsisReview.test.ts`.
- Modify: `backend/src/modules/books/routes.ts`
- Test: `backend/src/modules/books/routes.test.ts`
- Modify: `backend/src/modules/books/plugin.ts`

**Interfaces:**
- Consumes:
  - `workMatchJudgments`, `saveWorkMatchJudgment` and `matchCandidates` (Task 5);
  - `mergeTranslation` (Task 2), `undoMerge` (Task 3);
  - `MATCH_MERGE_AT`, `MATCH_REVIEW_AT`;
  - `HeldWork`, `BookNotFoundError`, `WorkMergeError`, `coverUrlFor`.
- Produces, shared:
  - `type TranslationReviewGroup = "possible" | "blocked" | "merged"`
  - `TRANSLATION_REVIEW_GROUPS`, `TRANSLATION_REVIEW_HEADINGS`
  - `type TranslationReviewItem`, `type TranslationReview = { items: TranslationReviewItem[]; total: number }`
  - `type TranslationReviewAction = { merge: string } | { reject: true } | { undo: true }`
  - `translationEvidenceLabel(item): string`
  - `withoutTranslation(review, workId): TranslationReview`
- Produces, repo:
  - `translationReviewRows(mergeAt: number, reviewAt: number): Array<{ workId: string; intoWorkId: string; model: string; confidence: number | null; mergedAt: string | null; group: "possible" | "blocked" | "merged" }>`
  - `translationReviewWorks(workIds: string[]): Map<string, { title: string; author: string; coverImageId: string | null; originalTitle: string | null; synopsis: string | null }>`
- Produces, backend:
  - `TRANSLATION_REVIEW_LIMIT = 200`
  - `translationReviewWith(books, held: HeldWork[], coverUrl): TranslationReview`
  - `reviewTranslationWith(deps: { repo: BooksRepository; sharesArena: (from: string, into: string) => boolean; now: () => number }, workId: string, action: TranslationReviewAction): { workId: string }`
  - `buildTranslationReviewRoutes(deps: { isAdmin; review: () => TranslationReview; decide: (workId: string, action: TranslationReviewAction) => { workId: string } })`
- Routes:
  - `GET /books/translation-review`
  - `POST /books/translation-review/:workId`. It answers 200, 400, 403, 404, or 409 (`WorkMergeError`).

- [ ] **Step 1: Write the failing tests**

`packages/shared/src/works/translationReview.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { translationEvidenceLabel, withoutTranslation, type TranslationReview } from "./translationReview.js";

test("the evidence names code, Jev's confidence, or the arena", () => {
  assert.equal(translationEvidenceLabel({ group: "merged", evidence: { model: "code", confidence: null } }), "Code: original title + author surname");
  assert.equal(translationEvidenceLabel({ group: "possible", evidence: { model: "jev-1.13.0", confidence: 0.741 } }), "Jev 0.74");
  assert.equal(translationEvidenceLabel({ group: "blocked", evidence: { model: "jev-1.13.0", confidence: 0.95 } }), "Both in an arena · Jev 0.95");
});

test("withoutTranslation drops one item and the total", () => {
  const item = (workId: string) => ({ workId, title: "T", author: "A", originalTitle: null, coverUrl: null, synopsis: null, holders: 0, finished: false, proposed: { workId: "o", title: "O", author: "A", year: null, editions: 1, languages: [] }, group: "possible" as const, evidence: { model: "jev-1.13.0", confidence: 0.6 }, mergedAt: null });
  const review: TranslationReview = { items: [item("a"), item("b")], total: 2 };
  assert.deepEqual(withoutTranslation(review, "a"), { items: [item("b")], total: 1 });
  assert.equal(withoutTranslation(review, "z"), review);
});
```

`backend/src/modules/books/translationReview.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "translation-review-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("./adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("./adapters/sqlite/sqliteBooksRepository.js");
const { BookNotFoundError, WorkMergeError } = await import("./domain/errors.js");
const { reviewTranslationWith, translationReviewWith } = await import("./translationReview.js");

type Repo = ReturnType<typeof createSqliteBooksRepository>;
const AT = "2026-10-15T12:00:00.000Z";
const now = () => Date.parse(AT);

function freshRepo(): Repo {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  return createSqliteBooksRepository(db);
}

function pair(repo: Repo, n: number) {
  const pt = repo.createBook({ title: `Livro ${n}`, author: "Autor", isbn: `978972000060${n}`, workKey: `OL97${n}0W` }, [`isbn:978972000060${n}`], AT);
  const en = repo.createBook({ title: `Book ${n}`, author: "Author", isbn: `978000000060${n}`, workKey: `OL97${n}1W` }, [`isbn:978000000060${n}`], AT);
  repo.setLanguage(pt.id, "pt-PT");
  return { pt: repo.getBook(pt.id)!, en: repo.getBook(en.id)! };
}

test("possible, blocked and merged pairs are listed with both sides; manual and undone ones are not", () => {
  const repo = freshRepo();
  const possible = pair(repo, 1);
  const blocked = pair(repo, 2);
  const merged = pair(repo, 3);
  const rejected = pair(repo, 4);
  repo.saveWorkMatchJudgment(possible.pt.work_id!, { model: "jev-1.13.0", intoWorkId: possible.en.work_id, confidence: 0.74, askedAt: AT });
  repo.saveWorkMatchJudgment(blocked.pt.work_id!, { model: "code", intoWorkId: blocked.en.work_id, confidence: null, askedAt: AT });
  repo.saveWorkMatchJudgment(merged.pt.work_id!, { model: "jev-1.13.0", intoWorkId: merged.en.work_id, confidence: 0.95, askedAt: AT });
  repo.mergeTranslation(merged.pt.work_id!, merged.en.work_id!, "jev", 0.95, AT);
  repo.saveWorkMatchJudgment(rejected.pt.work_id!, { model: "manual", intoWorkId: null, confidence: null, askedAt: AT });
  const review = translationReviewWith(repo, [{ workId: blocked.pt.work_id!, holders: 2, finished: true }], (id) => `thumb:${id}`);
  assert.equal(review.total, 3);
  assert.deepEqual(review.items.map((item) => [item.title, item.group, item.proposed.title]), [["Livro 2", "blocked", "Book 2"], ["Livro 1", "possible", "Book 1"], ["Livro 3", "merged", "Book 3"]]);
  assert.equal(review.items[0]!.holders, 2);
  assert.equal(review.items[2]!.mergedAt, AT);
});

test("merge, reject and undo store the owner's call; an arena or a stale undo is a merge error", () => {
  const repo = freshRepo();
  const a = pair(repo, 5);
  const deps = { repo, sharesArena: () => false, now };
  assert.deepEqual(reviewTranslationWith(deps, a.pt.work_id!, { merge: a.en.work_id! }), { workId: a.pt.work_id });
  assert.equal(repo.getBook(a.pt.id)!.work_id, a.en.work_id);
  assert.equal(repo.workMatchJudgments([a.pt.work_id!]).get(a.pt.work_id!)?.model, "manual");
  reviewTranslationWith(deps, a.pt.work_id!, { undo: true });
  assert.equal(repo.getBook(a.pt.id)!.work_id, a.pt.work_id);
  assert.deepEqual(repo.workMatchJudgments([a.pt.work_id!]).get(a.pt.work_id!), { model: "manual", intoWorkId: null, confidence: null, askedAt: AT });
  assert.throws(() => reviewTranslationWith(deps, a.pt.work_id!, { undo: true }), WorkMergeError);

  const b = pair(repo, 6);
  assert.throws(() => reviewTranslationWith({ ...deps, sharesArena: () => true }, b.pt.work_id!, { merge: b.en.work_id! }), WorkMergeError);
  assert.equal(repo.getBook(b.pt.id)!.work_id, b.pt.work_id);
  reviewTranslationWith(deps, b.pt.work_id!, { reject: true });
  assert.equal(repo.workMatchJudgments([b.pt.work_id!]).get(b.pt.work_id!)?.intoWorkId, null);
  assert.throws(() => reviewTranslationWith(deps, "missing", { reject: true }), BookNotFoundError);
});
```

In `routes.test.ts`, add `buildTranslationReviewRoutes` to the `./routes.js` import and `WorkMergeError` to the errors import, and append:

```ts
async function callTranslationReview(options: InjectOptions, signedInAs?: string, decide: (workId: string) => { workId: string } = (workId) => ({ workId })) {
  const app = Fastify();
  app.decorate("authenticateAccessToken", (token: string) => (token === signedInAs ? { id: token, email: `${token}@example.test`, username: token, avatarId: null } : null));
  await app.register(buildTranslationReviewRoutes({ isAdmin: (userId) => userId === "admin", review: () => ({ items: [], total: 0 }), decide }));
  const res = await app.inject(signedInAs ? { ...options, headers: { ...options.headers, authorization: `Bearer ${signedInAs}` } } : options);
  await app.close();
  return res;
}

test("the translation review is the admin's only, and maps validation, not found and stale merges", async () => {
  assert.equal((await callTranslationReview({ method: "GET", url: "/books/translation-review" })).statusCode, 401);
  assert.equal((await callTranslationReview({ method: "GET", url: "/books/translation-review" }, "reader")).statusCode, 403);
  assert.equal((await callTranslationReview({ method: "GET", url: "/books/translation-review" }, "admin")).statusCode, 200);
  for (const payload of [{}, { merge: "" }, { reject: false }, { undo: true, reject: true }, { merge: "w", extra: 1 }]) {
    assert.equal((await callTranslationReview({ method: "POST", url: "/books/translation-review/w1", payload }, "admin")).statusCode, 400, JSON.stringify(payload));
  }
  assert.equal((await callTranslationReview({ method: "POST", url: "/books/translation-review/w1", payload: { reject: true } }, "reader")).statusCode, 403);
  assert.equal((await callTranslationReview({ method: "POST", url: "/books/translation-review/w1", payload: { undo: true } }, "admin")).statusCode, 200);
  assert.equal((await callTranslationReview({ method: "POST", url: "/books/translation-review/w1", payload: { reject: true } }, "admin", () => { throw new BookNotFoundError(); })).statusCode, 404);
  assert.equal((await callTranslationReview({ method: "POST", url: "/books/translation-review/w1", payload: { merge: "w2" } }, "admin", () => { throw new WorkMergeError("Both works are in an arena."); })).statusCode, 409);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test --workspace @scripta/shared && npm run typecheck --workspace backend`
Expected: FAIL. `./translationReview.js` doesn't exist, in shared or in backend.

- [ ] **Step 3: Implement**

Create `packages/shared/src/works/translationReview.ts`:

```ts
export type TranslationReviewGroup = "possible" | "blocked" | "merged";

export const TRANSLATION_REVIEW_GROUPS: TranslationReviewGroup[] = ["possible", "blocked", "merged"];

export const TRANSLATION_REVIEW_HEADINGS: Record<TranslationReviewGroup, string> = {
  possible: "Possible translations",
  blocked: "Blocked by an arena",
  merged: "Merged automatically"
};

export type TranslationReviewItem = {
  workId: string;
  title: string;
  author: string;
  originalTitle: string | null;
  coverUrl: string | null;
  synopsis: string | null;
  holders: number;
  finished: boolean;
  proposed: { workId: string; title: string; author: string; year: number | null; editions: number; languages: string[] };
  group: TranslationReviewGroup;
  evidence: { model: string; confidence: number | null };
  mergedAt: string | null;
};

export type TranslationReview = { items: TranslationReviewItem[]; total: number };

export type TranslationReviewAction = { merge: string } | { reject: true } | { undo: true };

export function translationEvidenceLabel(item: Pick<TranslationReviewItem, "group" | "evidence">): string {
  const decision = item.evidence.model === "code" || item.evidence.model === "manual" ? (item.evidence.model === "code" ? "Code: original title + author surname" : "Merged by hand") : `Jev ${(item.evidence.confidence ?? 0).toFixed(2)}`;
  return item.group === "blocked" ? `Both in an arena · ${decision}` : decision;
}

export function withoutTranslation(review: TranslationReview, workId: string): TranslationReview {
  const items = review.items.filter((item) => item.workId !== workId);
  return items.length === review.items.length ? review : { items, total: review.total - 1 };
}
```

In `packages/shared/src/works/index.ts`, add `export * from "./translationReview.js";`.

In `domain/ports.ts`, add after `matchCandidates(...)`:

```ts
  translationReviewRows(mergeAt: number, reviewAt: number): Array<{ workId: string; intoWorkId: string; model: string; confidence: number | null; mergedAt: string | null; group: "possible" | "blocked" | "merged" }>;
  translationReviewWorks(workIds: string[]): Map<string, { title: string; author: string; coverImageId: string | null; originalTitle: string | null; synopsis: string | null }>;
```

In `sqliteBooksRepository.ts`, add these statements:

```ts
  const translationReviewRowsStmt = db.prepare(`
    SELECT j.work_id AS work_id, j.into_work_id AS into_id, j.model AS model, j.confidence AS confidence, NULL AS merged_at,
      CASE WHEN j.model = 'code' OR j.confidence >= $merge THEN 'blocked' ELSE 'possible' END AS grp
    FROM work_match_judgments j JOIN works w ON w.id = j.work_id
    WHERE w.merged_into IS NULL AND j.into_work_id IS NOT NULL AND j.model <> 'manual' AND (j.model = 'code' OR j.confidence >= $review)
    UNION ALL
    SELECT m.from_work, m.into_work, m.source, m.confidence, m.merged_at, 'merged'
    FROM work_merges m JOIN works w ON w.id = m.from_work
    WHERE m.source IN ('code', 'jev', 'manual') AND m.undone_at IS NULL AND w.merged_into = m.into_work
  `);
  const translationReviewWorksStmt = db.prepare(`
    SELECT w.id, w.title, w.author,
      (SELECT b.cover_image_id FROM books b WHERE b.work_id = w.id AND b.cover_image_id IS NOT NULL ORDER BY b.created_at, b.rowid LIMIT 1) AS cover_image_id,
      (SELECT b.original_title FROM books b WHERE b.work_id = w.id AND b.original_title IS NOT NULL ORDER BY b.created_at, b.rowid LIMIT 1) AS original_title,
      (SELECT b.summary FROM books b WHERE b.work_id = w.id AND trim(coalesce(b.summary, '')) <> '' ORDER BY b.created_at, b.rowid LIMIT 1) AS summary
    FROM works w WHERE w.id IN (SELECT value FROM json_each(?))
  `);
```

And these methods:

```ts
    translationReviewRows(mergeAt, reviewAt) {
      return (translationReviewRowsStmt.all({ $merge: mergeAt, $review: reviewAt }) as Array<{ work_id: string; into_id: string; model: string; confidence: number | null; merged_at: string | null; grp: "possible" | "blocked" | "merged" }>).map((row) => ({ workId: row.work_id, intoWorkId: row.into_id, model: row.model, confidence: row.confidence, mergedAt: row.merged_at, group: row.grp }));
    },
    translationReviewWorks(workIds) {
      const rows = translationReviewWorksStmt.all(JSON.stringify(workIds)) as Array<{ id: string; title: string; author: string; cover_image_id: string | null; original_title: string | null; summary: string | null }>;
      return new Map(rows.map((row) => [row.id, { title: row.title, author: row.author, coverImageId: row.cover_image_id, originalTitle: row.original_title, synopsis: row.summary }]));
    },
```

Create `backend/src/modules/books/translationReview.ts`:

```ts
import type { TranslationReview, TranslationReviewAction, TranslationReviewItem } from "@scripta/shared";
import { BookNotFoundError, WorkMergeError } from "./domain/errors.js";
import type { BooksRepository } from "./domain/ports.js";
import { MATCH_MERGE_AT, MATCH_REVIEW_AT } from "./domain/translation.js";
import type { HeldWork } from "./genrePass.js";

export const TRANSLATION_REVIEW_LIMIT = 200;
const EXCERPT_LIMIT = 300;
const GROUP_ORDER = { possible: 0, blocked: 1, merged: 2 } as const;

export function translationReviewWith(books: BooksRepository, held: HeldWork[], coverUrl: (imageId: string) => string): TranslationReview {
  const rows = books.translationReviewRows(MATCH_MERGE_AT, MATCH_REVIEW_AT);
  const works = books.translationReviewWorks([...new Set(rows.flatMap((row) => [row.workId, row.intoWorkId]))]);
  const originals = new Map(books.matchCandidates([...new Set(rows.map((row) => row.intoWorkId))]).map((candidate) => [candidate.id, candidate]));
  const canonical = books.canonicalWorkIds(held.map((work) => work.workId));
  const holding = new Map<string, { holders: number; finished: boolean }>();
  for (const work of held) {
    const id = canonical.get(work.workId) ?? work.workId;
    const seen = holding.get(id);
    holding.set(id, { holders: (seen?.holders ?? 0) + work.holders, finished: (seen?.finished ?? false) || work.finished });
  }
  const listed = rows.flatMap((row): TranslationReviewItem[] => {
    const own = works.get(row.workId);
    const target = originals.get(row.intoWorkId);
    if (!own || !target) return [];
    const holder = holding.get(row.group === "merged" ? row.intoWorkId : row.workId);
    return [{
      workId: row.workId,
      title: own.title,
      author: own.author,
      originalTitle: own.originalTitle,
      coverUrl: own.coverImageId ? coverUrl(own.coverImageId) : null,
      synopsis: own.synopsis?.slice(0, EXCERPT_LIMIT) ?? null,
      holders: holder?.holders ?? 0,
      finished: holder?.finished ?? false,
      proposed: { workId: target.id, title: target.title, author: target.author, year: target.year, editions: target.editions, languages: target.languages },
      group: row.group,
      evidence: { model: row.model, confidence: row.confidence },
      mergedAt: row.mergedAt
    }];
  });
  listed.sort((a, b) => Number(b.finished) - Number(a.finished) || b.holders - a.holders || GROUP_ORDER[a.group] - GROUP_ORDER[b.group] || a.title.localeCompare(b.title));
  return { items: listed.slice(0, TRANSLATION_REVIEW_LIMIT), total: listed.length };
}

export function reviewTranslationWith(deps: { repo: BooksRepository; sharesArena: (from: string, into: string) => boolean; now: () => number }, workId: string, action: TranslationReviewAction): { workId: string } {
  if (!deps.repo.translationEvidence(workId)) throw new BookNotFoundError();
  const at = new Date(deps.now()).toISOString();
  const none = { model: "manual", intoWorkId: null, confidence: null, askedAt: at };
  if ("merge" in action) {
    if (deps.sharesArena(workId, action.merge)) throw new WorkMergeError("Both works are in an arena.");
    deps.repo.transaction(() => {
      deps.repo.saveWorkMatchJudgment(workId, { model: "manual", intoWorkId: action.merge, confidence: null, askedAt: at });
      deps.repo.mergeTranslation(workId, action.merge, "manual", null, at);
    });
    return { workId };
  }
  if ("undo" in action) {
    deps.repo.transaction(() => {
      deps.repo.undoMerge(workId, at);
      deps.repo.saveWorkMatchJudgment(workId, none);
    });
    return { workId };
  }
  deps.repo.saveWorkMatchJudgment(workId, none);
  return { workId };
}
```

In `routes.ts`:
- Add `TranslationReview` and `TranslationReviewAction` to the `@scripta/shared` type import.
- Add these after the synopsis schemas:

```ts
const TRANSLATIONS_FORBIDDEN = { error: "Only the admin can review translations." };
const translationParamsSchema = z.object({ workId: z.string().min(1).max(64) });
const translationActionSchema = z.union([
  z.object({ merge: z.string().min(1).max(64) }).strict(),
  z.object({ reject: z.literal(true) }).strict(),
  z.object({ undo: z.literal(true) }).strict()
]);
```

- Add this after `buildSynopsisReviewRoutes`:

```ts
export function buildTranslationReviewRoutes(deps: {
  isAdmin: (userId: string) => boolean;
  review: () => TranslationReview;
  decide: (workId: string, action: TranslationReviewAction) => { workId: string };
}) {
  return async function translationReviewRoutes(app: FastifyInstance) {
    app.get("/books/translation-review", { preHandler: authGuard }, async (request, reply) => {
      if (!deps.isAdmin(request.user.id)) return reply.code(403).send(TRANSLATIONS_FORBIDDEN);
      return reply.send(deps.review());
    });

    app.post("/books/translation-review/:workId", { preHandler: authGuard }, async (request, reply) => {
      if (!deps.isAdmin(request.user.id)) return reply.code(403).send(TRANSLATIONS_FORBIDDEN);
      const params = translationParamsSchema.safeParse(request.params);
      const body = translationActionSchema.safeParse(request.body);
      if (!params.success || !body.success) return reply.code(400).send({ error: "Send { merge: workId }, { reject: true } or { undo: true }." });
      try {
        return reply.send(deps.decide(params.data.workId, body.data));
      } catch (error) {
        if (error instanceof BookNotFoundError) return reply.code(404).send({ error: "No such work." });
        if (error instanceof WorkMergeError) return reply.code(409).send({ error: error.message });
        throw error;
      }
    });
  };
}
```

In `plugin.ts`:
- Add `buildTranslationReviewRoutes` to the `./routes.js` import.
- Add `import { reviewTranslationWith, translationReviewWith } from "./translationReview.js";`.
- Inside the `if (heldWorks)` scoped block, after the synopsis routes, add:

```ts
      await scoped.register(buildTranslationReviewRoutes({
        isAdmin: (userId) => service.isAdmin(userId),
        review: () => translationReviewWith(repo, heldWorks(), (imageId) => coverUrlFor(imageId, "thumb")),
        decide: (workId, action) => reviewTranslationWith({ repo, sharesArena, now: Date.now }, workId, action)
      }));
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm run build --workspace @scripta/shared && npm test --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/works/translationReview.ts packages/shared/src/works/translationReview.test.ts packages/shared/src/works/index.ts backend/src/modules/books/domain/ports.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts backend/src/modules/books/translationReview.ts backend/src/modules/books/translationReview.test.ts backend/src/modules/books/routes.ts backend/src/modules/books/routes.test.ts backend/src/modules/books/plugin.ts backend/package.json && git commit -m "$(cat <<'EOF'
List possible, blocked and automatic translation merges for the admin

GET /books/translation-review shows each Portuguese work beside its
proposed original: Jev's 0.5-0.9 doubts to merge or reject, pairs an
arena blocked, and the automatic merges, newest included, so a wrong
one can be undone. POST merges (through the same arena check),
rejects, or undoes, and each call stores the owner's decision as a
manual judgment that nothing later overrides. Admin-only, in the
review routes' rate-limit scope.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: The admin page

**Files:**
- Modify: `frontend/src/api/books.ts`
- Create: `frontend/src/components/TranslationReviewList.tsx`
- Create: `frontend/src/pages/AdminTranslationsPage.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/AdminLinks.tsx`
- Create: `frontend/scripts/test-admin-translations.mts`

**Interfaces:**
- Consumes: the shared translation review types and helpers (Task 9); `fetchIsAdmin`; `NotFoundPage`; `AdminLinks`' `LINKS` (synopsis plan).
- Produces:
  - `fetchTranslationReview(): Promise<TranslationReview>`
  - `reviewTranslation(workId: string, action: TranslationReviewAction): Promise<{ workId: string }>`
  - `<TranslationReviewList review onDecide />`
  - `AdminLinks` gains "Translation review".

- [ ] **Step 1: Write the failing test**

`frontend/scripts/test-admin-translations.mts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { TranslationReview } from "@scripta/shared";
import { AdminLinks } from "../src/components/AdminLinks";
import { TranslationReviewList } from "../src/components/TranslationReviewList";

const item = (workId: string, group: "possible" | "blocked" | "merged", model: string, confidence: number | null) => ({
  workId, title: `Livro ${workId}`, author: "Autor", originalTitle: "Book", coverUrl: null, synopsis: "Uma sinopse.", holders: 1, finished: false,
  proposed: { workId: `o-${workId}`, title: `Book ${workId}`, author: "Author", year: 1927, editions: 3, languages: ["en"] },
  group, evidence: { model, confidence }, mergedAt: group === "merged" ? "2026-10-15T12:00:00.000Z" : null
});
const review: TranslationReview = { items: [item("p", "possible", "jev-1.13.0", 0.74), item("b", "blocked", "code", null), item("m", "merged", "jev-1.13.0", 0.95)], total: 3 };
const render = () => renderToString(createElement(TranslationReviewList, { review, onDecide: async () => {} }));

test("each group shows both sides and its evidence", () => {
  const html = render();
  for (const text of ["Possible translations (1)", "Blocked by an arena (1)", "Merged automatically (1)", "Livro p", "Book p", "Jev 0.74", "Both in an arena · Code: original title + author surname", "Jev 0.95", "1927", "3 editions"]) {
    assert.ok(html.includes(text), text);
  }
});

test("possible rows offer Merge and Not a translation, blocked rows only the second, merged rows Undo", () => {
  const html = render();
  assert.equal(html.split(">Merge<").length - 1, 1);
  assert.equal(html.split(">Not a translation<").length - 1, 2);
  assert.equal(html.split(">Undo<").length - 1, 1);
});

test("the admin sees the translation review link", () => {
  assert.ok(renderToString(createElement(MemoryRouter, null, createElement(AdminLinks, { isAdmin: true }))).includes('href="/admin/translations"'));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build --workspace @scripta/shared && npm test --workspace frontend`
Expected: FAIL. `TranslationReviewList` doesn't exist.

- [ ] **Step 3: Implement**

In `frontend/src/api/books.ts`, add `TranslationReview` and `TranslationReviewAction` to the shared type import, and append:

```ts
export async function fetchTranslationReview(): Promise<TranslationReview> {
  return (await apiFetch("/books/translation-review")) as TranslationReview;
}

export async function reviewTranslation(workId: string, action: TranslationReviewAction): Promise<{ workId: string }> {
  return (await apiFetch(`/books/translation-review/${encodeURIComponent(workId)}`, { method: "POST", body: JSON.stringify(action) })) as { workId: string };
}
```

Create `frontend/src/components/TranslationReviewList.tsx`:

```tsx
import { useState } from "react";
import { TRANSLATION_REVIEW_GROUPS, TRANSLATION_REVIEW_HEADINGS, translationEvidenceLabel, type TranslationReview, type TranslationReviewAction, type TranslationReviewItem } from "@scripta/shared";

function TranslationReviewRow({ item, onDecide }: { item: TranslationReviewItem; onDecide: (workId: string, action: TranslationReviewAction) => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const decide = (action: TranslationReviewAction) => {
    setBusy(true);
    setError(null);
    onDecide(item.workId, action).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "That didn't save.");
      setBusy(false);
    });
  };
  const original = item.proposed;
  return (
    <li className="flex gap-3 border-b border-(--color-border) py-4">
      {item.coverUrl ? <img src={item.coverUrl} alt="" className="h-24 w-16 shrink-0 rounded object-cover" /> : <div className="h-24 w-16 shrink-0 rounded bg-(--color-surface-hover)" />}
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{item.title}</p>
        <p className="text-sm text-(--color-text-dim)">{`${item.author}${item.originalTitle ? ` · original title: ${item.originalTitle}` : ""}`}</p>
        <p className="mt-1 text-sm">{`→ ${original.title} · ${original.author}${original.year !== null ? ` · ${original.year}` : ""} · ${original.editions} ${original.editions === 1 ? "edition" : "editions"}${original.languages.length > 0 ? ` (${original.languages.join(", ")})` : ""}`}</p>
        <p className="mt-1 text-xs text-(--color-text-dim)">{`${translationEvidenceLabel(item)} · ${item.holders} ${item.holders === 1 ? "library" : "libraries"}${item.finished ? " · finished" : ""}`}</p>
        {item.synopsis ? <p className="mt-1 line-clamp-3 text-sm">{item.synopsis}</p> : null}
        <div className="mt-2 flex flex-wrap gap-2">
          {item.group === "possible" ? (
            <button type="button" disabled={busy} onClick={() => decide({ merge: original.workId })} className="rounded-lg bg-(--color-accent) px-3 py-1.5 text-sm font-semibold text-(--color-on-accent) disabled:opacity-50">
              Merge
            </button>
          ) : null}
          {item.group === "merged" ? (
            <button type="button" disabled={busy} onClick={() => decide({ undo: true })} className="rounded-lg border border-(--color-border) px-3 py-1.5 text-sm">
              Undo
            </button>
          ) : (
            <button type="button" disabled={busy} onClick={() => decide({ reject: true })} className="rounded-lg border border-(--color-border) px-3 py-1.5 text-sm">
              Not a translation
            </button>
          )}
        </div>
        {error ? <p role="alert" className="mt-1 text-sm text-(--color-danger)">{error}</p> : null}
      </div>
    </li>
  );
}

export function TranslationReviewList({ review, onDecide }: { review: TranslationReview; onDecide: (workId: string, action: TranslationReviewAction) => Promise<void> }) {
  return (
    <div>
      <p className="text-sm text-(--color-text-dim)">{`${review.total} to review${review.total > review.items.length ? `, showing ${review.items.length}` : ""}`}</p>
      {TRANSLATION_REVIEW_GROUPS.map((group) => {
        const items = review.items.filter((item) => item.group === group);
        if (items.length === 0) return null;
        return (
          <section key={group} className="mt-6">
            <h2 className="text-lg font-bold">{`${TRANSLATION_REVIEW_HEADINGS[group]} (${items.length})`}</h2>
            <ul>
              {items.map((item) => (
                <TranslationReviewRow key={item.workId} item={item} onDecide={onDecide} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
```

Create `frontend/src/pages/AdminTranslationsPage.tsx`:

```tsx
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { withoutTranslation, type TranslationReview, type TranslationReviewAction } from "@scripta/shared";
import { fetchIsAdmin, fetchTranslationReview, reviewTranslation } from "../api/books";
import { TranslationReviewList } from "../components/TranslationReviewList";
import { NotFoundPage } from "./NotFoundPage";

export function AdminTranslationsPage() {
  const client = useQueryClient();
  const { data: isAdmin, isPending } = useQuery({ queryKey: ["books-admin"], queryFn: fetchIsAdmin, staleTime: Infinity });
  const review = useQuery({ queryKey: ["translation-review"], queryFn: fetchTranslationReview, enabled: isAdmin === true });
  if (isPending) return null;
  if (!isAdmin) return <NotFoundPage />;
  const decide = async (workId: string, action: TranslationReviewAction) => {
    await reviewTranslation(workId, action);
    client.setQueryData<TranslationReview>(["translation-review"], (current) => (current ? withoutTranslation(current, workId) : current));
  };
  return (
    <div className="mx-auto max-w-3xl px-5 py-6">
      <h1 className="text-xl font-bold">Translation review</h1>
      {review.data ? <TranslationReviewList review={review.data} onDecide={decide} /> : review.isError ? <p role="alert" className="mt-4 text-sm text-(--color-danger)">The review list didn't load.</p> : null}
    </div>
  );
}
```

In `frontend/src/App.tsx`, add `import { AdminTranslationsPage } from "./pages/AdminTranslationsPage";` and `<Route path="/admin/translations" element={<AdminTranslationsPage />} />` after the `/admin/synopses` route.

In `frontend/src/components/AdminLinks.tsx`, add `{ to: "/admin/translations", label: "Translation review" }` as the last entry of `LINKS`.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run build --workspace @scripta/shared && npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/books.ts frontend/src/components/TranslationReviewList.tsx frontend/src/pages/AdminTranslationsPage.tsx frontend/src/App.tsx frontend/src/components/AdminLinks.tsx frontend/scripts/test-admin-translations.mts && git commit -m "$(cat <<'EOF'
Add the translation review page at /admin/translations

Each row puts the Portuguese work beside its proposed original, with
the original's year, editions and languages, the evidence and who
holds it. Possible pairs can be merged or rejected, blocked ones
rejected, and automatic merges undone.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Calibrating the translation thresholds

**Files:**
- Modify: `backend/src/modules/books/domain/ports.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Modify: `backend/src/modules/books/calibration.ts`
- Modify: `backend/src/modules/books/calibration.test.ts`
- Modify: `backend/scripts/jev-calibration-export.mjs`
- Modify: `backend/scripts/jev-calibration-score.mjs`
- Modify: `backend/README.md`

**Interfaces:**
- Consumes: `planMatch` (Task 5), `createJevMatchClassifier` (Task 6), `MATCH_MERGE_AT`, `MATCH_REVIEW_AT`.
- Produces, repo: `portugueseWorksWithEvidence(): string[]`, the unjudged live all-Portuguese works with an original title, a summary carrying the label, or an author.
- Produces, `calibration.ts`:
  - `TASKS = ["synopses", "translations"] as const`
  - `type TranslationSampleItem = { workId: string; stratum: "code" | "ask"; edition: { title: string; author: string; originalTitle: string | null; publisher: string | null; description: string | null }; candidates: Array<{ id: string; title: string; author: string; year: number | null }>; codePick: string | null }`
  - `type TranslationLabel = { workId: string; match: string | null }`
  - `type TranslationAnswerRow = { workId: string; pick: string | null; confidence: number }`
  - `translationSample(repo, n: number, random?: () => number): TranslationSampleItem[]`: up to `ceil(n/2)` code matches and up to `n - ceil(n/2)` Jev questions, from a shuffled pool. It stops once both are full and writes nothing.
  - `scoreTranslations(sample, labels, answers): Array<{ decision: string; items: number; correct: number }>`. Its rows are `code`, `jev 0.9 and above`, `jev 0.5 to 0.9` and `jev below 0.5`.

- [ ] **Step 1: Write the failing test**

Append to `calibration.test.ts`. Extend the import to `const { scoreSynopses, scoreTranslations, synopsisSample, translationSample } = await import("./calibration.js");`:

```ts
test("the translation sample mixes code matches and Jev questions, each with its candidates", () => {
  const repo = freshRepo();
  const add = (isbn: string, title: string, author: string, extra: { workKey?: string; language?: string; originalTitle?: string } = {}) => {
    const row = repo.createBook({ title, author, isbn, workKey: extra.workKey }, [`isbn:${isbn}`], "2026-10-01T00:00:00.000Z");
    if (extra.language) repo.setLanguage(row.id, extra.language);
    if (extra.originalTitle) repo.fillOriginalTitle(row.id, extra.originalTitle);
    return repo.getBook(row.id)!;
  };
  const en = add("9780156907601", "To the Lighthouse", "Virginia Woolf", { workKey: "OL980W" });
  add("9780000000602", "The Idiot", "Fyodor Dostoevsky", { workKey: "OL981W" });
  const code = add("9789720000601", "Passeio ao Farol", "Virginia Woolf", { language: "pt-PT", originalTitle: "To the Lighthouse" });
  add("9789720000602", "O Idiota", "Fyodor Dostoevsky", { language: "pt-PT" });
  add("9789720000603", "Sem Autor", "", { language: "pt-PT" });
  const sample = translationSample(repo, 4, () => 0.5);
  assert.deepEqual(sample.map((item) => item.stratum).sort(), ["ask", "code"]);
  assert.equal(sample.find((item) => item.stratum === "code")?.codePick, en.work_id);
  assert.equal(sample.find((item) => item.stratum === "code")?.workId, code.work_id);
  assert.equal(sample.find((item) => item.stratum === "ask")?.candidates[0]?.title, "The Idiot");
  assert.equal(repo.workMatchJudgments(sample.map((item) => item.workId)).size, 0);
});

test("the translation score counts right picks per decision band", () => {
  const item = (workId: string, stratum: "code" | "ask", codePick: string | null) => ({ workId, stratum, edition: { title: "T", author: "A", originalTitle: null, publisher: null, description: null }, candidates: [{ id: "x", title: "X", author: "A", year: null }], codePick });
  const sample = [item("c", "code", "x"), item("h", "ask", null), item("m", "ask", null), item("l", "ask", null)];
  const labels = [{ workId: "c", match: "x" }, { workId: "h", match: "x" }, { workId: "m", match: null }, { workId: "l", match: null }];
  const answers = [{ workId: "h", pick: "x", confidence: 0.95 }, { workId: "m", pick: "x", confidence: 0.7 }, { workId: "l", pick: null, confidence: 0.3 }];
  assert.deepEqual(scoreTranslations(sample, labels, answers), [
    { decision: "code", items: 1, correct: 1 },
    { decision: "jev 0.9 and above", items: 1, correct: 1 },
    { decision: "jev 0.5 to 0.9", items: 1, correct: 0 },
    { decision: "jev below 0.5", items: 1, correct: 1 }
  ]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run typecheck --workspace backend`
Expected: FAIL. `translationSample` and `scoreTranslations` don't exist.

- [ ] **Step 3: Implement**

In `domain/ports.ts`, add after `translationReviewWorks(...)`:

```ts
  portugueseWorksWithEvidence(): string[];
```

In `sqliteBooksRepository.ts`, add this statement. It reuses `portugueseWorkFilter` from Task 5:

```ts
  const portugueseWithEvidenceStmt = db.prepare(`
    SELECT w.id FROM works w
    WHERE ${portugueseWorkFilter}
      AND (w.author <> '' OR EXISTS (SELECT 1 FROM books b WHERE b.work_id = w.id AND (b.original_title IS NOT NULL OR b.author <> '' OR b.summary LIKE '%tulo original%')))
    ORDER BY w.created_at, w.rowid
  `);
```

And this method:

```ts
    portugueseWorksWithEvidence() {
      return (portugueseWithEvidenceStmt.all({ $recheck: null, $rejections: Number.MAX_SAFE_INTEGER }) as Array<{ id: string }>).map((row) => row.id);
    },
```

In `calibration.ts`:
- Change `TASKS` to `export const TASKS = ["synopses", "translations"] as const;`.
- Add `import { MATCH_MERGE_AT, MATCH_REVIEW_AT } from "./domain/translation.js";` and `import { planMatch } from "./translationJudgments.js";`.
- Append:

```ts
export type TranslationSampleItem = {
  workId: string;
  stratum: "code" | "ask";
  edition: { title: string; author: string; originalTitle: string | null; publisher: string | null; description: string | null };
  candidates: Array<{ id: string; title: string; author: string; year: number | null }>;
  codePick: string | null;
};
export type TranslationLabel = { workId: string; match: string | null };
export type TranslationAnswerRow = { workId: string; pick: string | null; confidence: number };

type SampleRepo = Pick<BooksRepository, "portugueseWorksWithEvidence" | "translationEvidence" | "titleCandidates" | "authorCandidates" | "matchCandidates">;

export function translationSample(repo: SampleRepo, n: number, random: () => number = Math.random): TranslationSampleItem[] {
  const codeCap = Math.ceil(n / 2);
  const askCap = n - codeCap;
  const picked: TranslationSampleItem[] = [];
  let code = 0;
  let ask = 0;
  for (const workId of shuffled(repo.portugueseWorksWithEvidence(), random)) {
    if (code >= codeCap && ask >= askCap) break;
    const plan = planMatch(repo, workId);
    const rows = repo.translationEvidence(workId);
    if (!plan || !rows || (plan.kind !== "code" && plan.kind !== "ask")) continue;
    if (plan.kind === "code" ? code >= codeCap : ask >= askCap) continue;
    const first = rows.editions[0]!;
    const candidates = plan.kind === "ask" ? plan.candidates : repo.matchCandidates([plan.intoWorkId]).map(({ id, title, author, year }) => ({ id, title, author, year }));
    picked.push({
      workId,
      stratum: plan.kind,
      edition: plan.kind === "ask"
        ? { title: plan.evidence.title, author: plan.evidence.author, originalTitle: plan.evidence.originalTitle, publisher: plan.evidence.publisher, description: plan.evidence.summary }
        : { title: first.title, author: first.author, originalTitle: first.originalTitle, publisher: first.publisher, description: first.summary },
      candidates,
      codePick: plan.kind === "code" ? plan.intoWorkId : null
    });
    if (plan.kind === "code") code += 1;
    else ask += 1;
  }
  return picked;
}

export function scoreTranslations(sample: TranslationSampleItem[], labels: TranslationLabel[], answers: TranslationAnswerRow[]): Array<{ decision: string; items: number; correct: number }> {
  const label = new Map(labels.map((entry) => [entry.workId, entry.match]));
  const answer = new Map(answers.map((entry) => [entry.workId, entry]));
  const labelled = sample.filter((item) => label.has(item.workId));
  const asked = labelled.filter((item) => item.stratum === "ask" && answer.has(item.workId));
  const row = (decision: string, items: TranslationSampleItem[], pick: (item: TranslationSampleItem) => string | null) => ({ decision, items: items.length, correct: items.filter((item) => pick(item) === label.get(item.workId)).length });
  const jevPick = (item: TranslationSampleItem) => answer.get(item.workId)!.pick;
  const confidence = (item: TranslationSampleItem) => answer.get(item.workId)!.confidence;
  return [
    row("code", labelled.filter((item) => item.stratum === "code"), (item) => item.codePick),
    row(`jev ${MATCH_MERGE_AT} and above`, asked.filter((item) => confidence(item) >= MATCH_MERGE_AT), jevPick),
    row(`jev ${MATCH_REVIEW_AT} to ${MATCH_MERGE_AT}`, asked.filter((item) => confidence(item) >= MATCH_REVIEW_AT && confidence(item) < MATCH_MERGE_AT), jevPick),
    row(`jev below ${MATCH_REVIEW_AT}`, asked.filter((item) => confidence(item) < MATCH_REVIEW_AT), jevPick)
  ];
}
```

In `jev-calibration-export.mjs`, replace the line that prints the sample with:

```js
const { translationSample } = await import("../dist/modules/books/calibration.js");
console.log(JSON.stringify(values.task === "translations" ? translationSample(books, n) : synopsisSample(books, n)));
```

In `jev-calibration-score.mjs`, branch on the task:
- For `translations`, import `createJevMatchClassifier` from `../dist/modules/books/adapters/typesafe/jevWorkMatch.js` and `scoreTranslations` from `../dist/modules/books/calibration.js`.
- Ask the classifier, 4 in flight, for every `ask` item: `classify({ edition: item.edition, candidates: item.candidates })`, then map the answer to `{ workId, pick: answer.choice === null ? null : item.candidates[answer.choice].id, confidence: answer.confidence }`.
- Print `scoreTranslations(sample, labels, answers)`.
- The synopsis branch stays as it is.

In `backend/README.md`, extend "Calibrating Jev" with the translations task:
- **Export:** `--task translations`.
- **Labels:** `[{ "workId": "…", "match": "<candidate id>" | null }]`. The labeller picks which listed candidate is the same work as the Portuguese edition, or none.
- **The bar:** automatic merging needs at least 98% right once Open Library duplicate works are set aside. A labeller who sees a pick that is the same book under a duplicate Open Library work notes it, and that item counts as right.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run typecheck --workspace backend && npm test --workspace backend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/books/domain/ports.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts backend/src/modules/books/calibration.ts backend/src/modules/books/calibration.test.ts backend/scripts/jev-calibration-export.mjs backend/scripts/jev-calibration-score.mjs backend/README.md && git commit -m "$(cat <<'EOF'
Calibrate translation matching on a labelled production sample

The export draws Portuguese works whose match code would settle and
works Jev would be asked about, each with the candidates it would see.
Claude labels which candidate is the same work, if any; the score
counts right picks for the code step and each Jev band. Keyless
Portuguese editions have no Open Library answer, so this is the only
check on them before the backlog merges anything.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Wrap-up

- [ ] Run every verify command in Global Constraints. All must pass.
- [ ] Web pass on the dev fixture:
  - sign in as the admin;
  - open `/admin/translations`: it loads, empty or with fixture items;
  - the footer shows all three review links;
  - a non-admin gets the not-found page;
  - take a screenshot.
- [ ] Dispatch `branch-reviewer` with this plan and the spec.
- [ ] This branch adds admin-only routes and changes who can merge works ("who can see what"). Run the `security-review` skill before merge.
- [ ] Ship with the `ship` skill: push, PR, `--auto`.
- [ ] Rollout is the owner's call:
  1. deploy;
  2. calibrate translations on production (Task 11);
  3. run the backlog's dry run, then the backlog;
  4. work through `/admin/translations`, and check its `merged` group.
