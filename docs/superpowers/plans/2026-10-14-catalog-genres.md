# Catalog Genres Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every library's books get genres, including Portuguese and obscure ones. They come from the catalog on each load, from Jev automatically, and from a manual Claude pass.

**Architecture:** The catalog (`books` in `covers.sqlite`) stays the only source of genres.
- **Re-check on load:** every library response carries each book's catalog genres. The app-wide enrichment hook copies them into books that have none, or that got theirs from the catalog, and saves once.
- **Jev job (Phase 2):** a books-module background job asks Jev for held works that still have no genres. It stores every answer as a judgment and applies those at or above 0.5. Answers below 0.8 show as "Possibly …".

**Tech Stack:** TypeScript, `node:sqlite`, Fastify, React web, Expo/React Native mobile, `node:test` through tsx.

**Spec:** `docs/superpowers/specs/2026-10-14-catalog-genres-design.md`

**Two phases, two PRs:**
- **Phase 1 (Tasks 1–6):** re-check on load, Portuguese words, the manual genre pass, and the genre-source columns.
- **Phase 2 (Tasks 7–11):** Jev and possible genres. Branch it from Phase 1's merged `main`.

## Global Constraints

- No comments in code (root `AGENTS.md`). The why goes in the commit message.
- Minimum code that works. Reuse `@scripta/shared` before writing a helper.
- Consumers read shared's `dist/`. Run `npm run build --workspace @scripta/shared` before any backend, frontend or mobile typecheck or test.
- A new backend `*.test.ts` file goes into the explicit list in `backend/package.json` `"test"`, or CI never runs it.
- A new Railway variable goes in `.railway/railway.ts` as `NAME: preserve()`. Only the user sets its value.
- API changes stay additive. Clients treat `genres` and `possibleGenres` as optional.
- The GitHub repo is public. No real reader names or library details in code, tests, fixtures or docs.
- Constants:
  - save line `GENRE_SAVE_LINE = 0.5`; confident line `CONFIDENT_GENRE_LINE = 0.8`;
  - pinned model `jev-1.13.0`;
  - the Jev job runs on the existing `BACKFILL_INTERVAL_MS` (10 min), 50 works per run, 4 requests in flight;
  - synopsis cut at 1,200 characters; at most 3 genres per work.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage and commit in one command, because concurrent sessions share the git index.
- Verify commands:
  - shared: `npm test --workspace @scripta/shared`
  - backend: `npm run typecheck --workspace backend && npm test --workspace backend`
  - frontend: `npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend`
  - mobile: `npm run typecheck --workspace mobile && npm test --workspace mobile`

## Review Focus

1. **The reader's own tags win.** A book whose genres came from the reader's own import tags is never replaced by catalog genres, even when they disagree. Pinned in Task 2.
2. **Empty lookups get filled.** A book saved as `_genres: []` by an earlier lookup picks up catalog genres. Pinned in Task 2.
3. **Unknown Jev answers are ignored.** If Jev answers with an option id the adapter doesn't know (API drift), nothing is written. Pinned in Task 7.
4. **Repeats are no-ops.** Running the import, or applying judgments, a second time changes nothing. Pinned in Tasks 6 and 8.
5. **Real data beats Jev, but blanks don't erase it.** A Jev genre that Open Library or ISBNdb later contradicts is replaced. A later empty answer leaves it in place. Pinned in Task 8.

---

## Phase 1

### Task 1: Portuguese subject words

**Files:**
- Modify: `packages/shared/src/library/bookGenres.ts:32-59` (`RULES`)
- Test: `packages/shared/src/library/bookGenres.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `normalizeBookGenres(value: unknown): BookGenre[]`, unchanged signature, now also matching Portuguese words.

- [ ] **Step 1: Write the failing tests**

In `bookGenres.test.ts`, change the import on line 4 to:

```ts
import { BOOK_GENRES, GENRE_LOOKUP_BATCH, genreLookupOrder, normalizeBookGenres, settleWithConcurrency } from "./bookGenres.js";
```

Append:

```ts
test("normalizeBookGenres maps Portuguese subjects and tags", () => {
  const cases: Array<[string, string]> = [
    ["Ficção científica", "Science Fiction"],
    ["Ficção científica e fantasia", "Science Fiction"],
    ["Ficção histórica", "Historical Fiction"],
    ["Romances históricos", "Historical Fiction"],
    ["Romance histórico", "Historical Fiction"],
    ["Ficção literária", "Literary Fiction"],
    ["Clássicos", "Classics"],
    ["Biografias e memórias", "Biography & Memoir"],
    ["Autobiografia", "Biography & Memoir"],
    ["Banda desenhada", "Comics & Graphic Novels"],
    ["Quadrinhos", "Comics & Graphic Novels"],
    ["Literatura juvenil", "Young Adult"],
    ["Livros infantis", "Children's"],
    ["Fantasia", "Fantasy"],
    ["Policial", "Mystery"],
    ["Policiais e thrillers", "Mystery"],
    ["Romance policial", "Mystery"],
    ["Mistérios e suspenses", "Mystery"],
    ["Suspenses", "Thriller"],
    ["Terror", "Horror"],
    ["Crimes", "Crime"],
    ["História", "History"],
    ["Filosofia", "Philosophy"],
    ["Psicologia", "Psychology"],
    ["Informática", "Technology"],
    ["Ciências", "Science"],
    ["Economia e gestão", "Business"],
    ["Autoajuda", "Self-Help"],
    ["Auto-ajuda", "Self-Help"],
    ["Desenvolvimento pessoal", "Self-Help"],
    ["Poesia", "Poetry"],
    ["Poemas", "Poetry"],
    ["Religião", "Religion"],
    ["Viagem: Ásia", "Travel"],
    ["Culinária", "Cooking"]
  ];
  for (const [subject, genre] of cases) assert.deepEqual(normalizeBookGenres([subject]), [genre], subject);
  assert.deepEqual(normalizeBookGenres(["Romance"]), ["Romance"]);
  assert.deepEqual(normalizeBookGenres(["Histórias"]), []);
});

test("every canonical genre name normalizes to itself", () => {
  for (const genre of BOOK_GENRES) assert.deepEqual(normalizeBookGenres([genre]), [genre], genre);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test --workspace @scripta/shared`
Expected: FAIL. "normalizeBookGenres maps Portuguese subjects and tags" fails on its first case, `Ficção científica`.

- [ ] **Step 3: Replace `RULES`**

In `bookGenres.ts`, replace the whole `const RULES` declaration with:

```ts
const RULES: Array<[BookGenre, RegExp]> = [
  ["Historical Fiction", /\bromances? historic\w*\b/],
  ["Mystery", /\bromances? polic\w*\b/],
  ["Science Fiction", /\b(?:science fiction|sci fi|scifi|ficcao cientifica)\b/],
  ["Historical Fiction", /\bhistorical fiction\b|\bfiction historical\b|\bficcao historica\b/],
  ["Literary Fiction", /\bliterary fiction\b|\bfiction literary\b|\bficcao literaria\b/],
  ["Classics", /\bclassics?\b|\bclassic literature\b|\bclassicos?\b/],
  ["Biography & Memoir", /\b(?:biograph\w*|autobiograph\w*|memoirs?|biografias?|autobiografias?|memorias)\b/],
  ["Comics & Graphic Novels", /\b(?:comics?|graphic novels?|manga|banda desenhada|quadrinhos)\b/],
  ["Young Adult", /\b(?:young adult|ya fiction|juvenil|jovens adultos)\b/],
  ["Children's", /\b(?:children s|childrens|juvenile fiction|picture books?|infantil|infantis)\b/],
  ["Fantasy", /\b(?:fantasy|fantasia)\b/],
  ["Romance", /\bromance\b/],
  ["Mystery", /\bmyst(?:ery|eries)\b|\bdetective fiction\b|\bpolicia(?:l|is)\b|\bmisterios?\b/],
  ["Thriller", /\bthrillers?\b|\bsuspenses?\b/],
  ["Horror", /\b(?:horror|terror)\b/],
  ["Crime", /\bcrimes?(?: fiction)?\b/],
  ["History", /\bhistory\b|\bhistorical studies\b|\bhistoria\b/],
  ["Politics", /\bpolitic\w*\b|\bgovernment\b/],
  ["Philosophy", /\b(?:philosoph\w*|filosofi\w*)\b/],
  ["Psychology", /\b(?:psycholog\w*|psicologi\w*)\b/],
  ["Technology", /\b(?:technology|computers?|programming|software|tecnologi\w*|informatica)\b/],
  ["Science", /\bscience\b|\b(?:physics|chemistry|biology|astronomy|ciencias?|fisica|quimica|biologia|astronomia)\b/],
  ["Business", /\b(?:business|economics|finance|entrepreneurship|management|economia|gestao|financas|negocios|empreendedorismo)\b/],
  ["Self-Help", /\bself help\b|\bpersonal development\b|\bauto ?ajuda\b|\bdesenvolvimento pessoal\b/],
  ["Poetry", /\bpoetry\b|\bpoems?\b|\bpoesia\b|\bpoemas?\b/],
  ["Religion", /\b(?:religion|theology|spirituality|religiao|teologia|espiritualidade)\b/],
  ["Travel", /\b(?:travel|viage(?:m|ns))\b/],
  ["Cooking", /\b(?:cooking|cookbooks?|food|culinaria|receitas|gastronomia)\b/]
];
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace @scripta/shared`
Expected: PASS, including the existing BISAC test.

Then:

```bash
npm run build --workspace @scripta/shared && npm test --workspace mobile
```

Expected: PASS. `mobile/src/features/library/bookGenres.test.ts` exercises the same rules.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/library/bookGenres.ts packages/shared/src/library/bookGenres.test.ts && git commit -m "$(cat <<'EOF'
Map Portuguese genre words to catalog genres

Portuguese subjects and shelf tags (História, Policial, Poesia, Ficção
científica…) mapped to nothing, so Portuguese imports and catalog
subjects lost their genres. "Romance histórico" and "romance policial"
match before the bare "romance" rule; a bare "romance" stays Romance so
every canonical name still maps to itself, and plural "histórias"
(stories) maps to nothing.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

### Task 2: `withCatalogGenres`

**Files:**
- Create: `packages/shared/src/library/catalogGenres.ts`
- Create: `packages/shared/src/library/catalogGenres.test.ts`
- Modify: `packages/shared/src/library/index.ts`. Add `export * from "./catalogGenres.js";` after `export * from "./bookGenres.js";`.

**Interfaces:**
- Consumes: `genresForBook` and `normalizeBookGenres` (`./bookGenres.js`), `bookKey` (`./merge.js`), `LibraryData` (`./types.js`).
- Produces:
  - `GENRES_FROM_CATALOG = "catalog"`
  - `withCatalogGenres(data: LibraryData, catalog: Record<string, string[]>): LibraryData`

- [ ] **Step 1: Write the failing tests**

`packages/shared/src/library/catalogGenres.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { GENRES_FROM_CATALOG, withCatalogGenres } from "./catalogGenres.js";

const dune = { Title: "Dune", Attribution: "Frank Herbert", ISBN: "9780441013593" };
const key = "isbn:9780441013593";

test("a book with no genres takes the catalog's and is marked", () => {
  for (const book of [dune, { ...dune, _genres: [] }]) {
    const next = withCatalogGenres({ books: [book] }, { [key]: ["Science Fiction", "Classics"] });
    assert.deepEqual(next.books, [{ ...book, _genres: ["Science Fiction", "Classics"], _genresFrom: GENRES_FROM_CATALOG }]);
  }
});

test("a marked book follows the catalog when it changes", () => {
  const book = { ...dune, _genres: ["Biography & Memoir"], _genresFrom: GENRES_FROM_CATALOG };
  const next = withCatalogGenres({ books: [book] }, { [key]: ["Historical Fiction"] });
  assert.deepEqual(next.books[0], { ...book, _genres: ["Historical Fiction"] });
});

test("genres of the reader's own are never replaced", () => {
  const data = { books: [{ ...dune, _genres: ["Romance"] }] };
  assert.equal(withCatalogGenres(data, { [key]: ["Science Fiction"] }), data);
});

test("nothing to apply returns the same object", () => {
  const marked = { ...dune, _genres: ["Science Fiction"], _genresFrom: GENRES_FROM_CATALOG };
  for (const data of [{ books: [dune] }, { books: [marked] }]) {
    assert.equal(withCatalogGenres(data, {}), data);
    assert.equal(withCatalogGenres(data, { [key]: [] }), data);
  }
  const same = { books: [marked] };
  assert.equal(withCatalogGenres(same, { [key]: ["Science Fiction"] }), same);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test --workspace @scripta/shared`
Expected: FAIL with "Cannot find module './catalogGenres.js'".

- [ ] **Step 3: Implement**

`packages/shared/src/library/catalogGenres.ts`:

```ts
import { genresForBook, normalizeBookGenres } from "./bookGenres.js";
import { bookKey } from "./merge.js";
import type { LibraryData } from "./types.js";

export const GENRES_FROM_CATALOG = "catalog";

export function withCatalogGenres(data: LibraryData, catalog: Record<string, string[]>): LibraryData {
  let changed = false;
  const books = data.books.map((book) => {
    const genres = normalizeBookGenres(catalog[bookKey(book)]);
    if (genres.length === 0) return book;
    const own = genresForBook(book);
    if (own.length > 0 && (book._genresFrom !== GENRES_FROM_CATALOG || own.join("|") === genres.join("|"))) return book;
    changed = true;
    return { ...book, _genres: genres, _genresFrom: GENRES_FROM_CATALOG };
  });
  return changed ? { ...data, books } : data;
}
```

Add the export line to `packages/shared/src/library/index.ts`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace @scripta/shared`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/library/catalogGenres.ts packages/shared/src/library/catalogGenres.test.ts packages/shared/src/library/index.ts && git commit -m "$(cat <<'EOF'
Add withCatalogGenres to copy catalog genres into a library

A book takes the catalog's genres when it has none, and follows them
when the ones it has came from the catalog (_genresFrom: "catalog"), so
a later correction reaches libraries. Genres a reader brought in import
tags carry no marker and are never touched.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

### Task 3: Catalog genres per work

**Files:**
- Create: `packages/shared/src/works/workGenres.ts`
- Create: `packages/shared/src/works/workGenres.test.ts`
- Modify: `packages/shared/src/works/index.ts`. Add `export * from "./workGenres.js";`.
- Modify: `backend/src/modules/books/adapters/sqlite/books.sql`. In `CREATE TABLE IF NOT EXISTS books`, add `genres_source TEXT,` and `genres_confidence REAL,` before `created_at`.
- Modify: `backend/src/modules/books/adapters/sqlite/connection.ts:42`. After the `title_group_blocked_at` ALTER, add the two guarded ALTERs below.
- Modify: `backend/src/modules/books/domain/types.ts`:
  - `GenresSource`
  - `BookRow` fields
  - `WorkPageRows` edition fields
- Modify: `backend/src/modules/books/domain/ports.ts`. Add `editionGenres`.
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`:
  - `pageEditionsStmt` columns (line 94)
  - the new `editionGenresStmt` statement and its method
- Modify: `backend/src/modules/books/works.ts`:
  - `CONFIDENT_GENRE_LINE`, `isPossibleGenre`, `catalogGenresWith`, `catalogGenres`
  - edition `possible` on `CatalogWorkPage`
- Modify: `backend/src/modules/books/index.ts`. Export `catalogGenres`.
- Modify: `backend/src/modules/works/service.ts:25-32,103`. Use `workGenres` from `@scripta/shared`.
- Test: `backend/src/modules/books/works.test.ts`, `backend/src/modules/books/useBooksRepository.test.ts`

**Interfaces:**
- Consumes: `normalizeBookGenres`.
- Produces:
  - shared: `type WorkGenres = { genres: string[]; possibleGenres: string[] }` and `workGenres(editions: Array<{ genres: readonly string[]; possible?: boolean }>): WorkGenres`
  - backend books module: `catalogGenres(workIds: string[]): Map<string, WorkGenres>`, plus `catalogGenresWith(books: BooksRepository, workIds: string[])`
  - backend books module: `CONFIDENT_GENRE_LINE = 0.8` and `isPossibleGenre(source: string | null, confidence: number | null): boolean`
  - repo: `editionGenres(workIds: string[]): Array<{ work_id: string; genres: string; genres_source: GenresSource | null; genres_confidence: number | null }>`

- [ ] **Step 1: Write the failing shared tests**

`packages/shared/src/works/workGenres.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { workGenres } from "./workGenres.js";

test("genres rank by how many editions carry them, capped at three", () => {
  assert.deepEqual(workGenres([{ genres: ["Fantasy", "Classics"] }, { genres: ["Classics", "Horror", "Romance"] }, { genres: ["Classics", "Horror"] }]), { genres: ["Classics", "Horror", "Fantasy"], possibleGenres: [] });
});

test("a genre only Jev guessed below the confident line is possible, after the confident ones", () => {
  assert.deepEqual(workGenres([{ genres: ["History"] }, { genres: ["Biography & Memoir"], possible: true }]), { genres: ["History"], possibleGenres: ["Biography & Memoir"] });
});

test("a genre any confident edition carries is not possible", () => {
  assert.deepEqual(workGenres([{ genres: ["History"], possible: true }, { genres: ["History"] }]), { genres: ["History"], possibleGenres: [] });
});

test("possible genres only fill what the cap leaves", () => {
  assert.deepEqual(workGenres([{ genres: ["Fantasy", "Classics", "Horror"] }, { genres: ["Poetry"], possible: true }]).possibleGenres, []);
  assert.deepEqual(workGenres([]), { genres: [], possibleGenres: [] });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test --workspace @scripta/shared`
Expected: FAIL with "Cannot find module './workGenres.js'".

- [ ] **Step 3: Implement `workGenres`**

`packages/shared/src/works/workGenres.ts`:

```ts
const CAP = 3;

export type WorkGenres = { genres: string[]; possibleGenres: string[] };

export function workGenres(editions: Array<{ genres: readonly string[]; possible?: boolean }>): WorkGenres {
  const counts = new Map<string, { editions: number; possible: number }>();
  for (const edition of editions) {
    for (const genre of edition.genres) {
      const count = counts.get(genre) ?? { editions: 0, possible: 0 };
      count.editions += 1;
      if (edition.possible) count.possible += 1;
      counts.set(genre, count);
    }
  }
  const ranked = [...counts].sort((a, b) => b[1].editions - a[1].editions);
  const genres = ranked.filter(([, count]) => count.possible < count.editions).map(([genre]) => genre).slice(0, CAP);
  const possibleGenres = ranked.filter(([, count]) => count.possible === count.editions).map(([genre]) => genre).slice(0, CAP - genres.length);
  return { genres, possibleGenres };
}
```

Add `export * from "./workGenres.js";` to `packages/shared/src/works/index.ts`. Run `npm test --workspace @scripta/shared` and expect PASS. Then run `npm run build --workspace @scripta/shared`.

- [ ] **Step 4: Write the failing backend tests**

In `backend/src/modules/books/works.test.ts`, add `catalogGenresWith` to the destructured import from `./works.js`, then append:

```ts
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
```

In `backend/src/modules/books/useBooksRepository.test.ts`, add `catalogGenres` to the import from `./works.js`. After the `getWorkPage` block, add:

```ts
  calls.length = 0;
  assert.deepEqual(catalogGenres([workId]), new Map());
  assert.deepEqual(calls, ["editionGenres"]);
```

- [ ] **Step 5: Run to verify they fail**

Run: `npm run typecheck --workspace backend`
Expected: FAIL. `catalogGenresWith`, `catalogGenres` and `editionGenres` do not exist.

- [ ] **Step 6: Implement the backend side**

1. **Migration.** `connection.ts`, after the `title_group_blocked_at` line:

```ts
  if (!columns.some((column) => column.name === "genres_source")) db.exec("ALTER TABLE books ADD COLUMN genres_source TEXT");
  if (!columns.some((column) => column.name === "genres_confidence")) db.exec("ALTER TABLE books ADD COLUMN genres_confidence REAL");
```

2. **Schema.** `books.sql`: add the two columns, as listed under Files.

3. **Types.** `domain/types.ts`:
   - add `export type GenresSource = "jev" | "manual";`;
   - add `genres_source: GenresSource | null;` and `genres_confidence: number | null;` to `BookRow` after `title_group_blocked_at`;
   - add `genres_source: GenresSource | null; genres_confidence: number | null` to the `WorkPageRows` edition type.

4. **Port.** `domain/ports.ts`: import `GenresSource`, and add to `BooksRepository`:

```ts
  editionGenres(workIds: string[]): Array<{ work_id: string; genres: string; genres_source: GenresSource | null; genres_confidence: number | null }>;
```

5. **Repository.** `sqliteBooksRepository.ts`:
   - Add `books.genres_source, books.genres_confidence` to `pageEditionsStmt`'s column list, after `books.pages`.
   - Next to `pageEditionsStmt`, add:

```ts
  const editionGenresStmt = db.prepare(`SELECT work_id, genres, genres_source, genres_confidence FROM books WHERE work_id IN (SELECT value FROM json_each(?)) AND genres <> '[]' ORDER BY created_at, rowid`);
```

   - In the returned object, after `aliasesOf`:

```ts
    editionGenres(workIds) {
      return editionGenresStmt.all(JSON.stringify(workIds)) as unknown as ReturnType<BooksRepository["editionGenres"]>;
    },
```

6. **Works module code.** `books/works.ts`:
   - Change the first import to `import { normalizeBookGenres, workGenres, type WorkGenres } from "@scripta/shared";`.
   - Add `possible?: boolean` to the `CatalogWorkPage` edition type, after `pages: number | null`.
   - Add `possible: isPossibleGenre(edition.genres_source, edition.genres_confidence)` to the edition map in `getWorkPageWith`.
   - Append:

```ts
export const CONFIDENT_GENRE_LINE = 0.8;

export function isPossibleGenre(source: string | null, confidence: number | null): boolean {
  return source === "jev" && (confidence ?? 0) < CONFIDENT_GENRE_LINE;
}

export function catalogGenresWith(books: BooksRepository, workIds: string[]): Map<string, WorkGenres> {
  const byWork = new Map<string, Array<{ genres: string[]; possible: boolean }>>();
  for (const row of workIds.length === 0 ? [] : books.editionGenres(workIds)) {
    const editions = byWork.get(row.work_id) ?? [];
    editions.push({ genres: normalizeBookGenres(JSON.parse(row.genres)), possible: isPossibleGenre(row.genres_source, row.genres_confidence) });
    byWork.set(row.work_id, editions);
  }
  return new Map([...byWork].map(([workId, editions]) => [workId, workGenres(editions)]));
}

export function catalogGenres(workIds: string[]): Map<string, WorkGenres> {
  return catalogGenresWith(booksRepository(), workIds);
}
```

7. **Public exports.** `books/index.ts` line 483 becomes:

```ts
export { canonicalWorks, catalogGenres, getWorkPage, matchWorks, resolveWorks } from "./works.js";
```

8. **Works service.** `works/service.ts`:
   - Delete `const GENRE_CAP = 3;` and the `topGenres` function, but keep the `type CatalogEdition` line.
   - Add `workGenres` to the `@scripta/shared` import on line 1.
   - Change line 103 to `genres: workGenres(work.editions).genres,`.

- [ ] **Step 7: Run to verify they pass**

Run: `npm run build --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend`
Expected: PASS. The existing "genres: most editions first, capped at three" test in `works/service.test.ts` still passes.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/works backend/src/modules/books backend/src/modules/works/service.ts && git commit -m "$(cat <<'EOF'
Rank catalog genres per work and track where an edition's genres came from

books.genres_source ('jev' | 'manual') and genres_confidence record a
genre's origin, so a Jev guess below 0.8 can be shown as possible and
manual labels can replace Jev's. workGenres moves to @scripta/shared so
the work page and library responses rank genres the same way without
the works module loading the books plugin.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

### Task 4: Catalog genres in every library response

**Files:**
- Modify: `backend/src/modules/library/domain/types.ts:23-40`. Add `genres` to `LibraryDocument` and `LibraryDocumentText`.
- Modify: `backend/src/modules/library/service.ts`:
  - imports (lines 10-14), `toLibraryDocument` and `toLibraryDocumentText` (lines 246-264), and the `createLibraryService` signature (line 304);
  - new `genresOf` and `catalogOf` helpers next to `worksOf`;
  - the call sites at lines 388, 394, 402-412, 482, 491, 526 and 534.
- Modify: `backend/src/modules/library/routes.ts:136-139` (`sendDocumentText`)
- Modify: `packages/shared/src/library/types.ts:33-39`. Add `genres?: Record<string, string[]>;` to `LibraryDocument`.
- Test: `backend/src/modules/library/service.test.ts`, `backend/src/modules/library/routes.test.ts`

**Interfaces:**
- Consumes: `catalogGenres` from `../books/index.js`; `WorkGenres` from `@scripta/shared`.
- Produces:
  - every library document response gains `genres: Record<bookKey, string[]>`, each value being genres followed by possible genres, at most 3;
  - `createLibraryService(..., canonicalWorks, catalogGenres: CatalogGenres = catalogCatalogGenres)`;
  - `export type CatalogGenres = (workIds: string[]) => Map<string, WorkGenres>`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/src/modules/library/service.test.ts`. It uses `titleWorks` and `memoryDb`, which the file defines earlier:

```ts
test("every library document answer carries the catalog genres of each copy's work", () => {
  const byWork = new Map([["w-Dune", { genres: ["Science Fiction"], possibleGenres: ["Classics"] }]]);
  const service = createLibraryService(createSqliteLibraryRepository(memoryDb()), () => "", 10_000_000, undefined, undefined, undefined, undefined, titleWorks, (ids) => new Map(ids.map((id) => [id, id])), (ids) => new Map(ids.flatMap((id) => (byWork.has(id) ? [[id, byWork.get(id)!]] : []))));
  const saved = service.saveLibrary("u1", { books: [{ Title: "Dune", Attribution: "Frank Herbert" }, { Title: "Orlando", Attribution: "Virginia Woolf" }] });
  const genres = { "ta:dune|frank herbert": ["Science Fiction", "Classics"] };
  assert.deepEqual(saved.genres, genres);
  assert.deepEqual(service.getLibraryText("u1")!.genres, genres);
  assert.deepEqual(service.getLibrary("u1")!.genres, genres);
  assert.deepEqual(service.share("u1").genres, genres);
});
```

In `backend/src/modules/library/routes.test.ts`, after "PUT and GET /library answer each copy's work id", add:

```ts
test("GET /library answers the catalog genres of each copy's work", async () => {
  const { app, put } = await setup();
  const saved = await put(JSON.stringify({ data: { books: [kobo] } }));
  const workId = saved.json().works["ta:dune|frank herbert"];
  const catalog = new DatabaseSync(process.env.COVERS_DB_PATH!);
  catalog.prepare("UPDATE books SET genres = ? WHERE work_id = ?").run(JSON.stringify(["Science Fiction"]), workId);
  catalog.close();
  const read = await app.inject({ method: "GET", url: "/library", headers: { authorization: "Bearer u1" } });
  assert.deepEqual(read.json().genres, { "ta:dune|frank herbert": ["Science Fiction"] });
  await app.close();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run typecheck --workspace backend`
Expected: FAIL. `createLibraryService` gets one argument too many, and `genres` does not exist on the response types.

- [ ] **Step 3: Implement**

1. **Types.** `domain/types.ts`: add `genres: Record<string, string[]>;` after `works` in both `LibraryDocument` and `LibraryDocumentText`.

2. **Imports.** `service.ts`:

```ts
import { canonicalWorks as canonicalCatalogWorks, catalogGenres as catalogCatalogGenres, resolveWorks as resolveCatalogWorks } from "../books/index.js";
```

   Add `type WorkGenres` to the existing `@scripta/shared` import. Next to `ResolveWorks`, add:

```ts
export type CatalogGenres = (workIds: string[]) => Map<string, WorkGenres>;
```

3. **Builders.** Replace `toLibraryDocument` and `toLibraryDocumentText`:

```ts
type DocumentCatalog = { works: Record<string, string>; genres: Record<string, string[]> };

function toLibraryDocument(row: LibraryDocumentRow, publicUrlFor: (token: string) => string, catalog: DocumentCatalog): LibraryDocument {
  return {
    data: JSON.parse(row.data),
    updatedAt: row.updated_at,
    shareToken: row.share_token,
    shareUrl: row.share_token ? publicUrlFor(row.share_token) : null,
    ...catalog
  };
}

function toLibraryDocumentText(row: LibraryDocumentRow, publicUrlFor: (token: string) => string, catalog: DocumentCatalog): LibraryDocumentText {
  return {
    data: row.data,
    updatedAt: row.updated_at,
    shareToken: row.share_token,
    shareUrl: row.share_token ? publicUrlFor(row.share_token) : null,
    ...catalog
  };
}
```

4. **Signature.** Append `, catalogGenres: CatalogGenres = catalogCatalogGenres` to the `createLibraryService` parameters.

5. **Helpers.** After `worksOf`:

```ts
  function genresOf(works: Record<string, string>): Record<string, string[]> {
    const byWork = catalogGenres([...new Set(Object.values(works))]);
    const genres: Record<string, string[]> = {};
    for (const [key, workId] of Object.entries(works)) {
      const work = byWork.get(workId);
      if (work) genres[key] = [...work.genres, ...work.possibleGenres];
    }
    return genres;
  }

  function catalogOf(userId: string): DocumentCatalog {
    const works = worksOf(userId);
    return { works, genres: genresOf(works) };
  }
```

6. **Call sites.**
   - Replace `worksOf(userId)` with `catalogOf(userId)` at the `toLibraryDocument(...)` and `toLibraryDocumentText(...)` calls in `getLibrary`, `getLibraryText`, `mergeBooks` (twice) and `share` (twice).
   - In `saveLibrary`, change `const works = worksOf(userId);` to `const catalog = catalogOf(userId);`. Change the events lambda to `(book) => catalog.works[bookKey(book)] ?? null`, and return `toLibraryDocumentText(row, publicUrlFor, catalog)`.

7. **Route.** `routes.ts` `sendDocumentText`, inside the template string:

```ts
  const body = `{"data":${document.data},"updatedAt":${JSON.stringify(document.updatedAt)},"shareToken":${JSON.stringify(document.shareToken)},"shareUrl":${JSON.stringify(document.shareUrl)},"works":${JSON.stringify(document.works)},"genres":${JSON.stringify(document.genres)}}`;
```

8. **Shared type.** `packages/shared/src/library/types.ts`: add `genres?: Record<string, string[]>;` after `works?`.

- [ ] **Step 4: Run to verify they pass**

Run: `npm run build --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend`
Expected: PASS. "saveLibrary reads the user's works once per save" still passes, because `catalogOf` calls `worksOf` once.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/library packages/shared/src/library/types.ts && git commit -m "$(cat <<'EOF'
Send each copy's catalog genres with every library document

Libraries stored _genres: [] after a lookup that found nothing and never
asked again, so genres the catalog learned later never reached them. The
response now carries genres per book key, beside works, for the client
to copy in.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

### Task 5: Enrichment hooks copy catalog genres

**Files:**
- Modify: `frontend/src/hooks/useGenreEnrichment.ts` (full file below)
- Modify: `mobile/src/features/library/hooks/useGenreEnrichment.ts` (full file below)
- Modify: `frontend/src/layouts/DashboardLayout.tsx:74`
- Modify: `mobile/src/app/(app)/_layout.tsx:18`

**Interfaces:**
- Consumes: `withCatalogGenres` and `GENRES_FROM_CATALOG` (Task 2), `LibraryDocument.genres` (Task 4).
- Produces: `useGenreEnrichment(books, catalogGenres: Record<string, string[]> | undefined, updateLibrary)`.

Neither client has a hook test harness. The logic lives in `withCatalogGenres`, which Task 2 tests. These hooks are checked by typecheck, lint and the device pass in Task 11.

- [ ] **Step 1: Replace the web hook**

`frontend/src/hooks/useGenreEnrichment.ts`:

```ts
import { useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { bookKey, genreLookupOrder, settleWithConcurrency, withCatalogGenres, GENRE_LOOKUP_BATCH, GENRE_LOOKUP_CONCURRENCY, GENRES_FROM_CATALOG, type LibraryData } from "@scripta/shared";
import type { LibraryDocument } from "../api/library";
import { bookMetadataOptions } from "../lib/bookMetadata";

export function useGenreEnrichment(
  books: Array<Record<string, unknown>>,
  catalogGenres: Record<string, string[]> | undefined,
  updateLibrary: (updater: (current: LibraryData) => LibraryData) => Promise<LibraryDocument>,
) {
  const client = useQueryClient();
  const save = useRef(updateLibrary);
  const stopped = useRef(false);
  const fromCatalog = useMemo(() => withCatalogGenres({ books }, catalogGenres ?? {}).books !== books, [books, catalogGenres]);
  const candidates = useMemo(() => genreLookupOrder(books).slice(0, GENRE_LOOKUP_BATCH), [books]);
  const signature = candidates.map(bookKey).join("|");

  useEffect(() => { save.current = updateLibrary; }, [updateLibrary]);

  useEffect(() => {
    if (!fromCatalog || stopped.current) return;
    let cancelled = false;
    save.current((current) => withCatalogGenres(current, catalogGenres ?? {})).catch((reason: unknown) => {
      if (!cancelled) {
        stopped.current = true;
        console.error(reason);
      }
    });
    return () => { cancelled = true; };
  }, [catalogGenres, fromCatalog]);

  useEffect(() => {
    if (fromCatalog || !signature || stopped.current) return;
    let cancelled = false;
    void settleWithConcurrency(candidates, GENRE_LOOKUP_CONCURRENCY, async (book) => ({ key: bookKey(book), metadata: await client.fetchQuery(bookMetadataOptions(book)) })).then(async (results) => {
      if (cancelled) return;
      const updates = new Map(results.flatMap((result) => result.status === "fulfilled" ? [[result.value.key, result.value.metadata?.genres ?? []] as const] : []));
      if (!updates.size) return;
      try {
        await save.current((current) => ({ ...current, books: current.books.map((book) => updates.has(bookKey(book)) ? { ...book, _genres: updates.get(bookKey(book)), _genresFrom: GENRES_FROM_CATALOG } : book) }));
      } catch (reason) {
        if (!cancelled) {
          stopped.current = true;
          console.error(reason);
        }
      }
    });
    return () => { cancelled = true; };
  }, [candidates, client, fromCatalog, signature]);
}
```

- [ ] **Step 2: Replace the mobile hook**

`mobile/src/features/library/hooks/useGenreEnrichment.ts`:

```ts
import { useEffect, useMemo, useRef } from "react";
import { bookKey, genreLookupOrder, settleWithConcurrency, withCatalogGenres, GENRE_LOOKUP_BATCH, GENRE_LOOKUP_CONCURRENCY, GENRES_FROM_CATALOG, type LibraryData } from "@scripta/shared";
import { fetchBookMetadata } from "../api/bookMetadata";

export function useGenreEnrichment(
  books: Array<Record<string, unknown>>,
  catalogGenres: Record<string, string[]> | undefined,
  updateLibrary: (updater: (current: LibraryData) => LibraryData) => Promise<unknown>,
) {
  const save = useRef(updateLibrary);
  const stopped = useRef(false);
  const fromCatalog = useMemo(() => withCatalogGenres({ books }, catalogGenres ?? {}).books !== books, [books, catalogGenres]);
  const candidates = useMemo(() => genreLookupOrder(books).slice(0, GENRE_LOOKUP_BATCH), [books]);
  const signature = candidates.map(bookKey).join("|");

  useEffect(() => { save.current = updateLibrary; }, [updateLibrary]);

  useEffect(() => {
    if (!fromCatalog || stopped.current) return;
    const controller = new AbortController();
    save.current((current) => withCatalogGenres(current, catalogGenres ?? {})).catch((reason: unknown) => {
      if (!controller.signal.aborted) {
        stopped.current = true;
        console.error(reason);
      }
    });
    return () => controller.abort();
  }, [catalogGenres, fromCatalog]);

  useEffect(() => {
    if (fromCatalog || !signature || stopped.current) return;
    const controller = new AbortController();
    void settleWithConcurrency(candidates, GENRE_LOOKUP_CONCURRENCY, async (book) => ({ key: bookKey(book), metadata: await fetchBookMetadata(book) })).then(async (results) => {
      if (controller.signal.aborted) return;
      const updates = new Map(results.flatMap((result) => result.status === "fulfilled" ? [[result.value.key, result.value.metadata?.genres ?? []] as const] : []));
      if (!updates.size) return;
      try {
        await save.current((current) => ({ ...current, books: current.books.map((book) => updates.has(bookKey(book)) ? { ...book, _genres: updates.get(bookKey(book)), _genresFrom: GENRES_FROM_CATALOG } : book) }));
      } catch (reason) {
        if (!controller.signal.aborted) {
          stopped.current = true;
          console.error(reason);
        }
      }
    });
    return () => controller.abort();
  }, [candidates, fromCatalog, signature]);
}
```

- [ ] **Step 3: Pass the catalog genres at both mount sites**

- `frontend/src/layouts/DashboardLayout.tsx:74`: `useGenreEnrichment(library?.data.books ?? [], library?.genres, updateLibrary);`
- `mobile/src/app/(app)/_layout.tsx:18`: `useGenreEnrichment(library?.data.books ?? [], library?.genres, updateLibrary);`

- [ ] **Step 4: Verify**

Run:

```bash
npm run build --workspace @scripta/shared && npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend && npm run typecheck --workspace mobile && npm test --workspace mobile
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useGenreEnrichment.ts frontend/src/layouts/DashboardLayout.tsx mobile/src/features/library/hooks/useGenreEnrichment.ts "mobile/src/app/(app)/_layout.tsx" && git commit -m "$(cat <<'EOF'
Copy catalog genres into the library before looking books up

The enrichment hook first saves the catalog genres the library response
carries (books with none, or whose genres came from the catalog), then
runs its per-book lookups as before. Lookup writes now carry the catalog
marker too, so later catalog corrections reach them.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

### Task 6: The manual genre pass

**Files:**
- Modify: `backend/src/modules/library/workHolders.ts`. Add `heldWorks` and `HeldWork`.
- Modify: `backend/src/modules/library/index.ts:21`. Export `heldWorks` and `type HeldWork`.
- Modify: `backend/src/modules/books/domain/types.ts`. Add `GenreEvidence`.
- Modify: `backend/src/modules/books/domain/ports.ts`. Add `genreEvidence` and `setManualGenres`.
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`. Add two statements and two methods.
- Create: `backend/src/modules/books/genrePass.ts`
- Create: `backend/src/modules/books/genrePass.test.ts`, and add `src/modules/books/genrePass.test.ts` to `backend/package.json` `"test"`.
- Create: `backend/scripts/genre-pass-export.mjs`, `backend/scripts/genre-pass-import.mjs`
- Modify: `backend/README.md`. Add a "Genre pass" section after "Seeding the catalog".
- Test: `backend/src/modules/library/workHolders.test.ts`

**Interfaces:**
- Consumes: `catalogGenresWith` (Task 3); `canonicalWorkIds` and `transaction` (repo).
- Produces:
  - library: `heldWorks(): HeldWork[]`, with `HeldWork = { workId: string; holders: number; finished: boolean }`, plus `createWorkHolders(db).heldWorks`.
  - repo: `genreEvidence(workId: string): GenreEvidence | undefined` and `setManualGenres(workId: string, genres: string[]): number`.
  - books (`genrePass.ts`): `SYNOPSIS_LIMIT`, `longestSynopsis(evidence)`, `genrePassWorksWith(books, held): GenrePassWork[]`, `importGenreLabelsWith(books, input: unknown): GenreImportReport`, and `GenreLabelsError`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/src/modules/library/workHolders.test.ts`:

```ts
test("held works count each work's holders and whether anyone finished it", () => {
  const { heldWorks } = createWorkHolders(seeded());
  assert.deepEqual(heldWorks().sort((a, b) => a.workId.localeCompare(b.workId)), [
    { workId: "w-new", holders: 2, finished: false },
    { workId: "w-old", holders: 1, finished: true },
    { workId: "w-other", holders: 1, finished: false }
  ]);
});
```

`backend/src/modules/books/genrePass.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "books-genre-pass-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("./adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("./adapters/sqlite/sqliteBooksRepository.js");
const { resolveWorksWith } = await import("./works.js");
const { GenreLabelsError, genrePassWorksWith, importGenreLabelsWith, longestSynopsis } = await import("./genrePass.js");

function seeded() {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  const repo = createSqliteBooksRepository(db);
  const [blank, tagged, other] = resolveWorksWith(repo, [
    { isbn: "9789722031240", title: "Os Anões", author: "Harold Pinter" },
    { isbn: null, title: "Dune", author: "Frank Herbert" },
    { isbn: null, title: "Orlando", author: "Virginia Woolf" }
  ]);
  db.prepare("UPDATE books SET summary = 'Um romance.', language = 'pt-PT', publisher = 'Relógio' WHERE work_id = ?").run(blank!);
  db.prepare("UPDATE books SET genres = ? WHERE work_id = ?").run(JSON.stringify(["Science Fiction"]), tagged!);
  return { db, repo, blank: blank!, tagged: tagged!, other: other! };
}

const row = (db: DatabaseSync, workId: string) => ({ ...db.prepare("SELECT genres, genres_source, genres_confidence FROM books WHERE work_id = ?").get(workId) });

test("the export lists held works with no genres, finished ones first", () => {
  const { repo, blank, tagged, other } = seeded();
  const rows = genrePassWorksWith(repo, [
    { workId: other, holders: 1, finished: false },
    { workId: blank, holders: 2, finished: true },
    { workId: tagged, holders: 1, finished: true }
  ]);
  assert.deepEqual(rows.map((entry) => entry.workId), [blank, other]);
  assert.deepEqual(rows[0], { workId: blank, title: "Os Anões", author: "Harold Pinter", editions: [{ title: "Os Anões", language: "pt-PT", isbn: "9789722031240", publisher: "Relógio", year: null }], synopsis: "Um romance.", finished: true, holders: 2 });
});

test("the export merges the holders of works merged into one", () => {
  const { repo, blank, other } = seeded();
  repo.mergeWorks(other, blank);
  const rows = genrePassWorksWith(repo, [{ workId: blank, holders: 1, finished: false }, { workId: other, holders: 2, finished: true }]);
  assert.deepEqual(rows.map((entry) => [entry.workId, entry.holders, entry.finished]), [[blank, 3, true]]);
});

test("the longest synopsis is cut at the limit", () => {
  const evidence = { work: { id: "w", title: "T", author: "A", summary: "short" }, editions: [{ title: "T", language: null, isbn: null, publisher: null, year: null, summary: "x".repeat(1500) }] };
  assert.equal(longestSynopsis(evidence), "x".repeat(1200));
  assert.equal(longestSynopsis({ ...evidence, work: { ...evidence.work, summary: null }, editions: [] }), null);
});

test("an import rejects unknown genres, unknown works and bad files without writing", () => {
  const { db, repo, blank } = seeded();
  assert.throws(() => importGenreLabelsWith(repo, [{ workId: blank, genres: ["Poetry"] }, { workId: blank, genres: ["Novel"] }]), GenreLabelsError);
  assert.throws(() => importGenreLabelsWith(repo, [{ workId: "missing", genres: ["Poetry"] }]), GenreLabelsError);
  assert.throws(() => importGenreLabelsWith(repo, { workId: blank }), GenreLabelsError);
  assert.equal(row(db, blank).genres, "[]");
});

test("an import fills empty, Jev and earlier manual editions, never source genres, and repeats as a no-op", () => {
  const { db, repo, blank, tagged, other } = seeded();
  db.prepare("UPDATE books SET genres = ?, genres_source = 'jev', genres_confidence = 0.6 WHERE work_id = ?").run(JSON.stringify(["Biography & Memoir"]), other);
  const labels = [{ workId: blank, genres: ["Literary Fiction"] }, { workId: tagged, genres: ["Poetry"] }, { workId: other, genres: ["Historical Fiction", "Classics"] }];
  assert.deepEqual(importGenreLabelsWith(repo, labels), { works: 2, editions: 2, skipped: [tagged] });
  assert.deepEqual(row(db, other), { genres: JSON.stringify(["Historical Fiction", "Classics"]), genres_source: "manual", genres_confidence: null });
  assert.deepEqual(row(db, tagged), { genres: JSON.stringify(["Science Fiction"]), genres_source: null, genres_confidence: null });
  assert.deepEqual(importGenreLabelsWith(repo, labels), { works: 0, editions: 0, skipped: [blank, tagged, other] });
  assert.deepEqual(importGenreLabelsWith(repo, [{ workId: other, genres: ["History"] }, { workId: blank, genres: [] }]), { works: 1, editions: 1, skipped: [blank] });
});
```

Add `src/modules/books/genrePass.test.ts` to the `backend/package.json` `"test"` list, after `src/modules/books/works.test.ts`.

- [ ] **Step 2: Run to verify they fail**

Run: `npm run typecheck --workspace backend`
Expected: FAIL. `./genrePass.js` and `heldWorks` don't exist.

- [ ] **Step 3: Implement**

1. **Held works.** `library/workHolders.ts`:
   - Add `export type HeldWork = { workId: string; holders: number; finished: boolean };` after `ViewerCopy`.
   - In `createWorkHolders`, add:

```ts
  const heldStmt = db.prepare(`SELECT work_id, COUNT(DISTINCT user_id) AS holders, MAX(read_status = 2) AS finished FROM library_books WHERE work_id IS NOT NULL GROUP BY work_id`);

  function heldWorks(): HeldWork[] {
    return (heldStmt.all() as Array<{ work_id: string; holders: number; finished: number | null }>).map((row) => ({ workId: row.work_id, holders: row.holders, finished: row.finished === 1 }));
  }
```

   - Return `{ holdersOfWorks, copyOfWork, communityRatings, heldWorks }`, and add:

```ts
export function heldWorks() {
  holders ??= createWorkHolders(openLibraryDb());
  return holders.heldWorks();
}
```

   - `library/index.ts:21` becomes `export { communityRatings, copyOfWork, heldWorks, holdersOfWorks, type HeldWork, type ViewerCopy } from "./workHolders.js";`.

2. **Evidence type.** `books/domain/types.ts`:

```ts
export type GenreEvidence = {
  work: { id: string; title: string; author: string; summary: string | null };
  editions: Array<{ title: string; language: string | null; isbn: string | null; publisher: string | null; year: number | null; summary: string | null }>;
};
```

3. **Port.** `domain/ports.ts`, in `BooksRepository`:

```ts
  genreEvidence(workId: string): GenreEvidence | undefined;
  setManualGenres(workId: string, genres: string[]): number;
```

4. **Repository.** `sqliteBooksRepository.ts`, next to `workStmt`:

```ts
  const evidenceEditionsStmt = db.prepare(`SELECT title, language, isbn, publisher, year, summary FROM books WHERE work_id = ? ORDER BY created_at, rowid`);
  const setManualGenresStmt = db.prepare(`
    UPDATE books SET genres = $genres, genres_source = 'manual', genres_confidence = NULL
    WHERE work_id = $work_id
      AND (genres = '[]' OR genres_source IN ('jev', 'manual'))
      AND NOT (genres = $genres AND genres_source = 'manual')
  `);
```

   and in the returned object:

```ts
    genreEvidence(workId) {
      const work = workStmt.get(workId) as { id: string; title: string; author: string; summary: string | null } | undefined;
      if (!work) return undefined;
      return { work: { id: work.id, title: work.title, author: work.author, summary: work.summary }, editions: evidenceEditionsStmt.all(workId) as GenreEvidence["editions"] };
    },
    setManualGenres(workId, genres) {
      return Number(setManualGenresStmt.run({ $genres: JSON.stringify(genres), $work_id: workId }).changes);
    },
```

5. **Genre pass module.** `books/genrePass.ts`:

```ts
import { BOOK_GENRES } from "@scripta/shared";
import type { BooksRepository } from "./domain/ports.js";
import type { GenreEvidence } from "./domain/types.js";
import { catalogGenresWith } from "./works.js";

export const SYNOPSIS_LIMIT = 1200;
const EDITION_LIMIT = 4;
const KNOWN_GENRES = new Set<string>(BOOK_GENRES);

export type HeldWork = { workId: string; holders: number; finished: boolean };
export type GenrePassWork = {
  workId: string;
  title: string;
  author: string;
  editions: Array<{ title: string; language: string | null; isbn: string | null; publisher: string | null; year: number | null }>;
  synopsis: string | null;
  finished: boolean;
  holders: number;
};
export type GenreImportReport = { works: number; editions: number; skipped: string[] };

export class GenreLabelsError extends Error {}

export function longestSynopsis(evidence: GenreEvidence): string | null {
  const texts = [evidence.work.summary, ...evidence.editions.map((edition) => edition.summary)].filter((text): text is string => Boolean(text?.trim()));
  const longest = texts.sort((a, b) => b.length - a.length)[0];
  return longest ? longest.slice(0, SYNOPSIS_LIMIT) : null;
}

export function genrePassWorksWith(books: BooksRepository, held: HeldWork[]): GenrePassWork[] {
  const canonical = books.canonicalWorkIds(held.map((work) => work.workId));
  const merged = new Map<string, { holders: number; finished: boolean }>();
  for (const work of held) {
    const id = canonical.get(work.workId);
    if (!id) continue;
    const entry = merged.get(id) ?? { holders: 0, finished: false };
    merged.set(id, { holders: entry.holders + work.holders, finished: entry.finished || work.finished });
  }
  const genres = catalogGenresWith(books, [...merged.keys()]);
  return [...merged]
    .flatMap(([workId, entry]) => {
      const evidence = genres.has(workId) ? undefined : books.genreEvidence(workId);
      if (!evidence) return [];
      const editions = [...new Map(evidence.editions.map((edition) => [`${edition.title}|${edition.language}|${edition.isbn}`, { title: edition.title, language: edition.language, isbn: edition.isbn, publisher: edition.publisher, year: edition.year }])).values()].slice(0, EDITION_LIMIT);
      return [{ workId, title: evidence.work.title, author: evidence.work.author, editions, synopsis: longestSynopsis(evidence), ...entry }];
    })
    .sort((a, b) => Number(b.finished) - Number(a.finished) || b.holders - a.holders || a.title.localeCompare(b.title));
}

function labelsOf(input: unknown): Array<{ workId: string; genres: string[] }> {
  if (!Array.isArray(input)) throw new GenreLabelsError("The labels file must be a JSON array of { workId, genres }.");
  const problems: string[] = [];
  const labels = input.flatMap((label: unknown, index) => {
    const workId = (label as { workId?: unknown } | null)?.workId;
    const genres = (label as { genres?: unknown } | null)?.genres;
    if (typeof workId !== "string" || !Array.isArray(genres)) {
      problems.push(`Label ${index} needs a workId and a genres array.`);
      return [];
    }
    const unknown = genres.filter((genre) => typeof genre !== "string" || !KNOWN_GENRES.has(genre));
    if (unknown.length > 0) problems.push(`Label ${index} (${workId}) has unknown genres: ${unknown.join(", ")}`);
    return [{ workId, genres: genres as string[] }];
  });
  if (problems.length > 0) throw new GenreLabelsError(problems.join("\n"));
  return labels;
}

export function importGenreLabelsWith(books: BooksRepository, input: unknown): GenreImportReport {
  const labels = labelsOf(input);
  const canonical = books.canonicalWorkIds(labels.map((label) => label.workId));
  const missing = labels.filter((label) => !canonical.has(label.workId)).map((label) => label.workId);
  if (missing.length > 0) throw new GenreLabelsError(`Unknown works: ${missing.join(", ")}`);
  return books.transaction(() => {
    const report: GenreImportReport = { works: 0, editions: 0, skipped: [] };
    for (const label of labels) {
      const changed = label.genres.length === 0 ? 0 : books.setManualGenres(canonical.get(label.workId)!, label.genres);
      if (changed === 0) report.skipped.push(label.workId);
      else {
        report.works += 1;
        report.editions += changed;
      }
    }
    return report;
  });
}
```

6. **Export script.** `backend/scripts/genre-pass-export.mjs`:

```js
import { DatabaseSync } from "node:sqlite";

for (const name of ["COVERS_DB_PATH", "LIBRARY_DB_PATH"]) {
  if (!process.env[name]) {
    console.error(`Missing environment variable: ${name}`);
    process.exit(1);
  }
}

const { createSqliteBooksRepository } = await import("../dist/modules/books/adapters/sqlite/sqliteBooksRepository.js");
const { genrePassWorksWith } = await import("../dist/modules/books/genrePass.js");
const { createWorkHolders } = await import("../dist/modules/library/workHolders.js");

const books = createSqliteBooksRepository(new DatabaseSync(process.env.COVERS_DB_PATH, { readOnly: true }));
const held = createWorkHolders(new DatabaseSync(process.env.LIBRARY_DB_PATH, { readOnly: true })).heldWorks();
console.log("---BEGIN---");
console.log(JSON.stringify(genrePassWorksWith(books, held)));
console.log("---END---");
```

7. **Import script.** `backend/scripts/genre-pass-import.mjs`:

```js
import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/genre-pass-import.mjs <labels.json>");
  process.exit(1);
}

const { openBooksDb } = await import("../dist/modules/books/adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("../dist/modules/books/adapters/sqlite/sqliteBooksRepository.js");
const { importGenreLabelsWith } = await import("../dist/modules/books/genrePass.js");

const report = importGenreLabelsWith(createSqliteBooksRepository(openBooksDb()), JSON.parse(readFileSync(file, "utf8")));
console.log(JSON.stringify(report, null, 2));
```

8. **README.** `backend/README.md`, a new `#### Genre pass` section after "Seeding the catalog":

````markdown
#### Genre pass

Fills catalog genres for works people own that Open Library and ISBNdb couldn't classify. Run it after a large import, or when the count of books without genres grows. The owner runs both commands; Claude classifies in between.

1. Export (read-only). The JSON between `---BEGIN---` and `---END---` lists each work's id, title, author, up to four editions, longest synopsis (1,200 characters), whether anyone finished it, and how many libraries hold it.

   ```bash
   npx -y @railway/cli@latest ssh --project 404b0e4a-701b-47ea-83fc-a82a80ae5094 --environment 39833834-0e18-4dde-a57f-3bf0bf0bab51 --service scripta -- sh -c 'cd /app/backend && node scripts/genre-pass-export.mjs' > genre-export.txt
   ```

2. Classify in a Claude session. Each work gets a main genre and up to two more from `BOOK_GENRES`, or none:
   - **Romance** only when a love story is the book's main thrust. Portuguese "romance" means *novel*.
   - **Classics** for canonical older works; **Literary Fiction** for other literary novels.
   - **Historical Fiction**, not Biography & Memoir, for novels about real historical figures.
   - **None** when nothing fits (pets, art books) or the book is unknown. No guessing from the title alone.
   - The owner reviews low-confidence, no-fit and unknown rows before importing.

   Write `labels.json` as `[{ "workId": "…", "genres": ["Main", "Other"] }]`. An empty `genres` leaves the work alone.

3. Import. The import rejects the whole file on an unknown genre or work. It writes only editions whose genres are empty, from Jev, or from an earlier pass, never Open Library, ISBNdb or search genres. It prints what it filled. Libraries pick the genres up on their owners' next load.

   ```bash
   npx -y @railway/cli@latest ssh --project 404b0e4a-701b-47ea-83fc-a82a80ae5094 --environment 39833834-0e18-4dde-a57f-3bf0bf0bab51 --service scripta -- sh -c "echo $(base64 < labels.json | tr -d '\n') | base64 -d > /tmp/genre-labels.json && cd /app/backend && node scripts/genre-pass-import.mjs /tmp/genre-labels.json; rm -f /tmp/genre-labels.json"
   ```
````

- [ ] **Step 4: Run to verify they pass**

Run: `npm run build --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend`
Expected: PASS.

Then build the backend and smoke-run the export against the local dev databases:

```bash
npm run build --workspace backend && (cd backend && node scripts/genre-pass-export.mjs | head -c 300)
```

Expected: `---BEGIN---` followed by a JSON array, possibly `[]`. It reads `COVERS_DB_PATH` and `LIBRARY_DB_PATH` from `backend/.env`. If it fails with "attempt to write a readonly database", report it rather than dropping `readOnly`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/library/workHolders.ts backend/src/modules/library/workHolders.test.ts backend/src/modules/library/index.ts backend/src/modules/books backend/scripts/genre-pass-export.mjs backend/scripts/genre-pass-import.mjs backend/package.json backend/README.md && git commit -m "$(cat <<'EOF'
Add the manual genre pass: export held works without genres, import labels

The owner exports the works libraries hold that have no catalog genres,
Claude classifies them in a session, and the import writes the labels as
genres_source 'manual'. The import validates the whole file first, fills
only empty, Jev or earlier manual editions, and repeats as a no-op.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

### Phase 1 wrap-up

- [ ] Run every verify command in Global Constraints. All must pass.
- [ ] Dispatch `branch-reviewer` with this plan and the spec.
- [ ] Ship Phase 1 with the `ship` skill: push, PR, `--auto`.

---

## Phase 2

Start a new branch from `main` once Phase 1 has merged.

### Task 7: TypeSafe key and the Jev genre classifier

**Files:**
- Modify: `backend/src/config/env.ts:133,218`
- Modify: `.railway/railway.ts`. Add `TYPESAFE_API_KEY: preserve(),` after `TIERLISTS_DB_PATH: preserve(),`.
- Modify: `backend/.env.example`. Add two lines after the ISBNdb block.
- Modify: `docs/services.md:53`. Add a TypeSafe line.
- Create: `backend/src/modules/books/adapters/typesafe/jevGenres.ts`
- Create: `backend/src/modules/books/adapters/typesafe/jevGenres.test.ts`, and add it to `backend/package.json` `"test"` after `src/modules/books/adapters/isbndb/isbndbDailyCap.test.ts`.

**Interfaces:**
- Consumes: `SourceUnavailableError` (`books/domain/errors.ts`), `BookGenre`.
- Produces:
  - `JEV_MODEL = "jev-1.13.0"`
  - `type JevBook = { title: string; author: string; editionLanguages: string[]; publishers: string[]; synopsis: string | null }`
  - `type GenreJudgment = { genre: BookGenre | null; confidence: number; model: string }`
  - `type ClassifyGenre = (book: JevBook) => Promise<GenreJudgment>`
  - `createJevGenreClassifier(apiKey: string, sleep?): ClassifyGenre`
  - `typesafeConfigured`

- [ ] **Step 1: Write the failing tests**

`backend/src/modules/books/adapters/typesafe/jevGenres.test.ts`:

```ts
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { SourceUnavailableError } from "../../domain/errors.js";
import { createJevGenreClassifier, JEV_MODEL } from "./jevGenres.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

type Seen = { url: string; init?: RequestInit };
function stub(responses: Array<() => Response>): Seen[] {
  const seen: Seen[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(input), init });
    return responses[Math.min(seen.length, responses.length) - 1]!();
  }) as typeof fetch;
  return seen;
}

const answer = (choice: string, confidence = 0.9) => () => Response.json({ model: "jev-1.13.0", answers: { genre: { type: "choice", choice, confidence, probabilities: {} } }, usage: { input_tokens: 300, output_tokens: 20 } });
const status = (code: number) => () => new Response("{}", { status: code });
const noSleep = async () => {};
const book = { title: "Os Anões", author: "Harold Pinter", editionLanguages: ["pt-PT"], publishers: [], synopsis: null };

test("asks the pinned model one genre Choice about the book's own fields", async () => {
  const seen = stub([answer("literary_fiction", 0.82)]);
  assert.deepEqual(await createJevGenreClassifier("key", noSleep)(book), { genre: "Literary Fiction", confidence: 0.82, model: "jev-1.13.0" });
  assert.equal(seen[0]!.url, "https://api.typesafe.ai/v1/systemone");
  assert.equal(seen[0]!.init?.method, "POST");
  assert.equal(new Headers(seen[0]!.init?.headers).get("authorization"), "Bearer key");
  const body = JSON.parse(String(seen[0]!.init?.body));
  assert.equal(body.model, JEV_MODEL);
  assert.deepEqual(body.state, { book: { title: "Os Anões", author: "Harold Pinter", edition_languages: ["pt-PT"] } });
  assert.deepEqual(Object.keys(body.questions), ["genre"]);
  assert.equal(body.questions.genre.type, "choice");
  assert.equal(Object.keys(body.questions.genre.criteria).length, 27);
  assert.ok(body.questions.genre.criteria.none);
});

test("none means no genre", async () => {
  stub([answer("none", 0.95)]);
  assert.deepEqual(await createJevGenreClassifier("key", noSleep)(book), { genre: null, confidence: 0.95, model: "jev-1.13.0" });
});

test("busy answers are retried, then the answer is used", async () => {
  const seen = stub([status(429), status(529), answer("poetry")]);
  assert.equal((await createJevGenreClassifier("key", noSleep)(book)).genre, "Poetry");
  assert.equal(seen.length, 3);
});

test("a service that stays busy fails after the retries", async () => {
  const seen = stub([status(529)]);
  await assert.rejects(createJevGenreClassifier("key", noSleep)(book), (error: unknown) => error instanceof SourceUnavailableError && error.status === 529);
  assert.equal(seen.length, 5);
});

test("a rejected key or request fails at once with its status", async () => {
  for (const code of [401, 422]) {
    const seen = stub([status(code)]);
    await assert.rejects(createJevGenreClassifier("key", noSleep)(book), (error: unknown) => error instanceof SourceUnavailableError && error.status === code);
    assert.equal(seen.length, 1);
  }
});

test("an option the adapter doesn't know is an error, not a genre", async () => {
  stub([answer("novel")]);
  await assert.rejects(createJevGenreClassifier("key", noSleep)(book), /unexpected answer/);
});
```

Add the file to `backend/package.json` `"test"`.

- [ ] **Step 2: Run to verify they fail**

Run: `npm run typecheck --workspace backend`
Expected: FAIL with "Cannot find module './jevGenres.js'".

- [ ] **Step 3: Implement**

1. **Env.** `config/env.ts`:
   - after the `ISBNDB_API_KEY` line: `  TYPESAFE_API_KEY: z.string().optional().default(""),`
   - after `isbndbConfigured`: `export const typesafeConfigured = env.TYPESAFE_API_KEY !== "";`

2. **Railway.** `.railway/railway.ts`: `      TYPESAFE_API_KEY: preserve(),` after `TIERLISTS_DB_PATH: preserve(),`.

3. **Example env.** `backend/.env.example`, after `ISBNDB_API_KEY=`:

```
# Optional — TypeSafe (https://typesafe.ai) key for classifying held catalog works that have no genres with Jev; blank turns the job off.
TYPESAFE_API_KEY=
```

4. **Services doc.** `docs/services.md`, after the ISBNdb line: `- TypeSafe (Jev genre classification): \`TYPESAFE_API_KEY\``

5. **Adapter.** `backend/src/modules/books/adapters/typesafe/jevGenres.ts`:

```ts
import type { BookGenre } from "@scripta/shared";
import { SourceUnavailableError } from "../../domain/errors.js";

export const JEV_MODEL = "jev-1.13.0";
const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const TIMEOUT_MS = 10_000;
const RETRIES = 4;

export type JevBook = { title: string; author: string; editionLanguages: string[]; publishers: string[]; synopsis: string | null };
export type GenreJudgment = { genre: BookGenre | null; confidence: number; model: string };
export type ClassifyGenre = (book: JevBook) => Promise<GenreJudgment>;

const OPTIONS: Array<[string, BookGenre | null, string]> = [
  ["fantasy", "Fantasy", "Fantasy: magic, invented worlds, mythical creatures."],
  ["science_fiction", "Science Fiction", "Science Fiction: speculative science or technology, space, the future, dystopias and utopias."],
  ["romance", "Romance", "Romance: a love story is the book's main thrust (romance novels, romantic comedies). Not for novels in general: in Portuguese 'romance' just means 'novel'."],
  ["mystery", "Mystery", "Mystery: detective or puzzle-solving crime fiction (Portuguese 'policial')."],
  ["thriller", "Thriller", "Thriller: suspense-driven plots with danger, chases or conspiracies."],
  ["horror", "Horror", "Horror: fiction meant to frighten, including gothic and supernatural terror."],
  ["crime", "Crime", "Crime: fiction centred on criminals and crimes, or true crime."],
  ["historical_fiction", "Historical Fiction", "Historical Fiction: novels set in a real historical period, often with real historical figures as characters, such as novels about kings and queens."],
  ["literary_fiction", "Literary Fiction", "Literary Fiction: literary novels and short stories that are neither genre fiction nor canonical classics."],
  ["classics", "Classics", "Classics: canonical works of world or Portuguese literature, mostly written before about 1960."],
  ["biography_memoir", "Biography & Memoir", "Biography & Memoir: the true story of a real person's life, including diaries, letters and autobiographies."],
  ["history", "History", "History: non-fiction about historical events or periods."],
  ["politics", "Politics", "Politics: non-fiction about politics, government, society, feminism, activism or political ideas."],
  ["philosophy", "Philosophy", "Philosophy: non-fiction philosophical essays and treatises."],
  ["psychology", "Psychology", "Psychology: non-fiction about the mind, mental health or behaviour."],
  ["science", "Science", "Science: non-fiction about the natural sciences."],
  ["technology", "Technology", "Technology: non-fiction about computing or technology."],
  ["business", "Business", "Business: economics, management, finance or entrepreneurship."],
  ["self_help", "Self-Help", "Self-Help: personal development and advice books."],
  ["poetry", "Poetry", "Poetry: collections of poems or verse."],
  ["religion", "Religion", "Religion: theology, spirituality or religious texts."],
  ["travel", "Travel", "Travel: travel writing and travel guides."],
  ["cooking", "Cooking", "Cooking: cookbooks and food writing."],
  ["young_adult", "Young Adult", "Young Adult: fiction written for teenagers."],
  ["childrens", "Children's", "Children's: books written for children."],
  ["comics", "Comics & Graphic Novels", "Comics & Graphic Novels: comics, manga or graphic novels."],
  ["none", null, "None: no genre above fits (for example pet care or art books), or the book cannot be identified from the information given."]
];
const INSTRUCTIONS = "Which genre best describes the book in `book`? Judge from its title, author and synopsis, and pick the single best fit.";
const CRITERIA = Object.fromEntries(OPTIONS.map(([id, , description]) => [id, description]));
const GENRE_BY_OPTION = new Map(OPTIONS.map(([id, genre]) => [id, genre]));

function stateOf(book: JevBook) {
  return {
    book: {
      title: book.title,
      author: book.author,
      ...(book.editionLanguages.length > 0 ? { edition_languages: book.editionLanguages } : {}),
      ...(book.publishers.length > 0 ? { publishers: book.publishers } : {}),
      ...(book.synopsis ? { synopsis: book.synopsis } : {})
    }
  };
}

function judgmentOf(body: unknown): GenreJudgment {
  const answer = (body as { answers?: { genre?: { choice?: unknown; confidence?: unknown } } } | null)?.answers?.genre;
  const model = (body as { model?: unknown } | null)?.model;
  if (typeof answer?.choice !== "string" || !GENRE_BY_OPTION.has(answer.choice) || typeof answer.confidence !== "number" || typeof model !== "string") {
    throw new SourceUnavailableError("typesafe", "unexpected answer");
  }
  return { genre: GENRE_BY_OPTION.get(answer.choice) ?? null, confidence: answer.confidence, model };
}

export function createJevGenreClassifier(apiKey: string, sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))): ClassifyGenre {
  return async (book) => {
    const body = JSON.stringify({ state: stateOf(book), model: JEV_MODEL, questions: { genre: { type: "choice", instructions: INSTRUCTIONS, criteria: CRITERIA } } });
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await fetch(ENDPOINT, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body, signal: AbortSignal.timeout(TIMEOUT_MS) });
      } catch (error) {
        if (error instanceof TypeError || (error instanceof DOMException && error.name === "TimeoutError")) throw new SourceUnavailableError("typesafe", error.message);
        throw error;
      }
      if ((response.status === 429 || response.status === 529) && attempt < RETRIES) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      if (!response.ok) throw new SourceUnavailableError("typesafe", `HTTP ${response.status}`, { status: response.status });
      let parsed: unknown;
      try {
        parsed = await response.json();
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        throw new SourceUnavailableError("typesafe", "invalid JSON");
      }
      return judgmentOf(parsed);
    }
  };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm run typecheck --workspace backend && npm test --workspace backend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/config/env.ts .railway/railway.ts backend/.env.example docs/services.md backend/src/modules/books/adapters/typesafe backend/package.json && git commit -m "$(cat <<'EOF'
Add the Jev genre classifier behind an optional TYPESAFE_API_KEY

One Choice per work over the 26 catalog genres plus none, with the
option descriptions measured on 2026-10-14, on the pinned jev-1.13.0 the
0.5/0.8 lines were measured on. Busy answers retry with backoff; a
rejected key or request, or an option the adapter doesn't know, fails
without a genre.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

### Task 8: Genre judgments in the catalog

**Files:**
- Modify: `backend/src/modules/books/adapters/sqlite/books.sql`. Add the `genre_judgments` table.
- Modify: `backend/src/modules/books/domain/ports.ts`. Add four methods.
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`:
  - new statements and methods;
  - rewrite `saveDetailsStmt` (lines 161-165) and its `.run` call (line 362).
- Test: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`

**Interfaces:**
- Produces, on the repo:
  - `worksNeedingGenreJudgment(workIds: string[], limit: number): string[]`
  - `saveGenreJudgment(judgment: { workId: string; model: string; genre: string | null; confidence: number; askedAt: string }): void`
  - `genreJudgments(workIds: string[]): Map<string, { genre: string | null; confidence: number }>`
  - `applyGenreJudgments(saveLine: number): void`
  - `saveDetails` now replaces Jev genres when the new answer has genres.

- [ ] **Step 1: Write the failing tests**

Append to `sqliteBooksRepository.test.ts`, which already has `freshRepo`, `NOW` and `richDetails`:

```ts
const genreRow = (db: DatabaseSync, id: string) => ({ ...db.prepare("SELECT genres, genres_source, genres_confidence FROM books WHERE id = ?").get(id) });
const titled = (repo: ReturnType<typeof freshRepo>["repo"], title: string) => repo.createBook({ title, author: "A", isbn: null }, [`ta:${title.toLowerCase()}|a|`], NOW);

test("works needing a genre judgment have no genres, a finished details lookup and no judgment", () => {
  const { db, repo } = freshRepo();
  const [ready, tagged, unchecked, judged] = ["Ready", "Tagged", "Unchecked", "Judged"].map((title) => titled(repo, title));
  for (const book of [ready, tagged, judged]) repo.markDetailsMissing(book!.id, NOW);
  db.prepare("UPDATE books SET genres = ? WHERE id = ?").run(JSON.stringify(["Poetry"]), tagged!.id);
  repo.saveGenreJudgment({ workId: judged!.work_id!, model: "jev-1.13.0", genre: null, confidence: 0.9, askedAt: NOW });
  const ids = [ready, tagged, unchecked, judged].map((book) => book!.work_id!);
  assert.deepEqual(repo.worksNeedingGenreJudgment(ids, 10), [ready!.work_id]);
  assert.deepEqual(repo.worksNeedingGenreJudgment(ids, 0), []);
  assert.deepEqual(repo.genreJudgments(ids), new Map([[judged!.work_id!, { genre: null, confidence: 0.9 }]]));
});

test("applying judgments writes Jev genres at or above the save line, idempotently, and undoes them when the line rises", () => {
  const { db, repo } = freshRepo();
  const [sure, unsure, none, manual] = ["Sure", "Unsure", "None", "Manual"].map((title) => titled(repo, title));
  const judge = (book: { work_id: string | null } | undefined, genre: string | null, confidence: number) => repo.saveGenreJudgment({ workId: book!.work_id!, model: "jev-1.13.0", genre, confidence, askedAt: NOW });
  judge(sure, "History", 0.9);
  judge(unsure, "Poetry", 0.3);
  judge(none, null, 0.95);
  judge(manual, "Romance", 0.9);
  db.prepare("UPDATE books SET genres = ?, genres_source = 'manual' WHERE id = ?").run(JSON.stringify(["Classics"]), manual!.id);
  repo.applyGenreJudgments(0.5);
  repo.applyGenreJudgments(0.5);
  assert.deepEqual(genreRow(db, sure!.id), { genres: JSON.stringify(["History"]), genres_source: "jev", genres_confidence: 0.9 });
  assert.deepEqual(genreRow(db, unsure!.id), { genres: "[]", genres_source: null, genres_confidence: null });
  assert.deepEqual(genreRow(db, none!.id), { genres: "[]", genres_source: null, genres_confidence: null });
  assert.deepEqual(genreRow(db, manual!.id), { genres: JSON.stringify(["Classics"]), genres_source: "manual", genres_confidence: null });
  repo.applyGenreJudgments(0.95);
  assert.deepEqual(genreRow(db, sure!.id), { genres: "[]", genres_source: null, genres_confidence: null });
});

test("Open Library genres replace a Jev guess, an empty answer keeps it, and manual genres stay", () => {
  const { db, repo } = freshRepo();
  const jev = titled(repo, "Guessed");
  const manual = titled(repo, "Labelled");
  db.prepare("UPDATE books SET genres = ?, genres_source = 'jev', genres_confidence = 0.6 WHERE id = ?").run(JSON.stringify(["History"]), jev.id);
  db.prepare("UPDATE books SET genres = ?, genres_source = 'manual' WHERE id = ?").run(JSON.stringify(["Poetry"]), manual.id);
  repo.saveDetails(jev.id, { ...richDetails, genres: [] }, ["openlibrary"], "openlibrary", NOW);
  assert.deepEqual(genreRow(db, jev.id), { genres: JSON.stringify(["History"]), genres_source: "jev", genres_confidence: 0.6 });
  repo.saveDetails(jev.id, richDetails, ["openlibrary"], "openlibrary", NOW);
  assert.deepEqual(genreRow(db, jev.id), { genres: JSON.stringify(["Fantasy"]), genres_source: null, genres_confidence: null });
  repo.saveDetails(manual.id, richDetails, ["openlibrary"], "openlibrary", NOW);
  assert.deepEqual(genreRow(db, manual.id), { genres: JSON.stringify(["Poetry"]), genres_source: "manual", genres_confidence: null });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run typecheck --workspace backend`
Expected: FAIL. The judgment methods don't exist.

- [ ] **Step 3: Implement**

1. **Table.** `books.sql`, after the `books` table:

```sql
CREATE TABLE IF NOT EXISTS genre_judgments (
  work_id    TEXT PRIMARY KEY,
  model      TEXT NOT NULL,
  genre      TEXT,
  confidence REAL NOT NULL,
  asked_at   TEXT NOT NULL
);
```

2. **Port.** `domain/ports.ts`:

```ts
  worksNeedingGenreJudgment(workIds: string[], limit: number): string[];
  saveGenreJudgment(judgment: { workId: string; model: string; genre: string | null; confidence: number; askedAt: string }): void;
  genreJudgments(workIds: string[]): Map<string, { genre: string | null; confidence: number }>;
  applyGenreJudgments(saveLine: number): void;
```

3. **New statements.** `sqliteBooksRepository.ts`:

```ts
  const needingJudgmentStmt = db.prepare(`
    SELECT w.value AS id FROM json_each(?) AS w
    WHERE NOT EXISTS (SELECT 1 FROM genre_judgments j WHERE j.work_id = w.value)
      AND NOT EXISTS (SELECT 1 FROM books b WHERE b.work_id = w.value AND b.genres <> '[]')
      AND EXISTS (SELECT 1 FROM books b WHERE b.work_id = w.value AND b.details_status IS NOT NULL)
    LIMIT ?
  `);
  const saveJudgmentStmt = db.prepare(`INSERT OR REPLACE INTO genre_judgments (work_id, model, genre, confidence, asked_at) VALUES (?, ?, ?, ?, ?)`);
  const judgmentsStmt = db.prepare(`SELECT work_id, genre, confidence FROM genre_judgments WHERE work_id IN (SELECT value FROM json_each(?))`);
  const applyJudgmentsStmt = db.prepare(`
    UPDATE books SET genres = json_array(j.genre), genres_source = 'jev', genres_confidence = j.confidence
    FROM genre_judgments AS j
    WHERE books.work_id = j.work_id AND j.genre IS NOT NULL AND j.confidence >= ?
      AND (books.genres = '[]' OR books.genres_source = 'jev')
  `);
  const undoJudgmentsStmt = db.prepare(`
    UPDATE books SET genres = '[]', genres_source = NULL, genres_confidence = NULL
    WHERE genres_source = 'jev' AND work_id IN (SELECT work_id FROM genre_judgments WHERE genre IS NULL OR confidence < ?)
  `);
```

4. **New methods**, in the returned object:

```ts
    worksNeedingGenreJudgment(workIds, limit) {
      return (needingJudgmentStmt.all(JSON.stringify(workIds), limit) as Array<{ id: string }>).map((row) => row.id);
    },
    saveGenreJudgment(judgment) {
      saveJudgmentStmt.run(judgment.workId, judgment.model, judgment.genre, judgment.confidence, judgment.askedAt);
    },
    genreJudgments(workIds) {
      const rows = judgmentsStmt.all(JSON.stringify(workIds)) as Array<{ work_id: string; genre: string | null; confidence: number }>;
      return new Map(rows.map((row) => [row.work_id, { genre: row.genre, confidence: row.confidence }]));
    },
    applyGenreJudgments(saveLine) {
      inTransaction(() => {
        undoJudgmentsStmt.run(saveLine);
        applyJudgmentsStmt.run(saveLine);
      });
    },
```

5. **`saveDetails`.** Replace `saveDetailsStmt` with:

```ts
  const saveDetailsStmt = db.prepare(`
    UPDATE books
    SET rating = $rating, rating_count = $rating_count,
        genres = CASE WHEN genres = '[]' OR (genres_source = 'jev' AND $genres <> '[]') THEN $genres ELSE genres END,
        genres_source = CASE WHEN genres_source = 'jev' AND $genres <> '[]' THEN NULL ELSE genres_source END,
        genres_confidence = CASE WHEN genres_source = 'jev' AND $genres <> '[]' THEN NULL ELSE genres_confidence END,
        data_sources = $data_sources, source_url = $source_url, details_status = 'found', details_checked_at = $checked_at
    WHERE id = $id
  `);
```

   and its call in `saveDetails` with:

```ts
        saveDetailsStmt.run({ $rating: details.rating, $rating_count: details.ratingCount, $genres: JSON.stringify(details.genres), $data_sources: JSON.stringify([...new Set([...stored, ...sources])]), $source_url: details.sourceUrl, $checked_at: checkedAt, $id: bookId });
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm run typecheck --workspace backend && npm test --workspace backend`
Expected: PASS, including the existing "pages, year, publisher, translator and genres only fill what is empty" test.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/books/adapters/sqlite backend/src/modules/books/domain/ports.ts && git commit -m "$(cat <<'EOF'
Store Jev genre judgments and apply them to editions without genres

Every answer is kept, so moving the 0.5 save line takes effect on the
next run without asking Jev again; applying is idempotent and undoes Jev
genres the line no longer covers. Open Library and ISBNdb genres now
replace a Jev guess, but an empty answer leaves it, and manual genres
are never touched.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

### Task 9: The genre judgment job

**Files:**
- Create: `backend/src/modules/books/genreJudgments.ts`
- Create: `backend/src/modules/books/genreJudgments.test.ts`, and add it to `backend/package.json` `"test"` after `src/modules/books/genrePass.test.ts`.
- Modify: `backend/src/modules/books/plugin.ts`:
  - imports (lines 4, 19);
  - `BooksPluginOptions` (lines 41-43);
  - start the job after `stopColorBackfill` (line 881);
  - stop it in `onClose`.
- Modify: `backend/src/app.ts`. Line 44 imports `heldWorks`; lines 167-174 pass `heldWorkIds`.
- Modify: `backend/README.md`. Add a bullet to the `books` section next to the details-backfill bullet (line 172), and an env bullet next to `ISBNDB_API_KEY` (line 173).

**Interfaces:**
- Consumes:
  - `ClassifyGenre` and `JevBook` (Task 7);
  - the repo judgment methods (Task 8);
  - `genreEvidence` and `longestSynopsis` (Task 6);
  - `heldWorks` (library, Task 6).
- Produces:
  - `GENRE_SAVE_LINE = 0.5`, `GENRE_JUDGMENT_BATCH = 50`
  - `jevBookOf(evidence: GenreEvidence): JevBook`
  - `judgeGenres(deps: GenreJudgmentDeps, limit: number, signal: AbortSignal): Promise<number | null>`. It returns a pause-until timestamp, or null.
  - `BooksPluginOptions.heldWorkIds?: () => string[]`

- [ ] **Step 1: Write the failing tests**

`backend/src/modules/books/genreJudgments.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "books-genre-judgments-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("./adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("./adapters/sqlite/sqliteBooksRepository.js");
const { SourceUnavailableError } = await import("./domain/errors.js");
const { jevBookOf, judgeGenres } = await import("./genreJudgments.js");

type Classify = Parameters<typeof judgeGenres>[0]["classify"];
const NOW = Date.parse("2026-10-14T12:00:00.000Z");

function seeded(titles: string[]) {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  const repo = createSqliteBooksRepository(db);
  const at = new Date(NOW).toISOString();
  const books = titles.map((title) => repo.createBook({ title, author: "A", isbn: null }, [`ta:${title.toLowerCase()}|a|`], at));
  for (const book of books) repo.markDetailsMissing(book.id, at);
  return { db, repo, workIds: books.map((book) => book.work_id!) };
}

function deps(repo: ReturnType<typeof seeded>["repo"], workIds: string[], classify: Classify, alerts: string[] = []) {
  return { repo, classify, heldWorkIds: () => workIds, now: () => NOW, alert: (subject: string) => { alerts.push(subject); } };
}

test("judges held works, stores every answer, saves the ones at or above the save line and never asks twice", async () => {
  const { db, repo, workIds } = seeded(["Sure", "Unsure"]);
  const answers = new Map([["Sure", { genre: "History" as const, confidence: 0.9, model: "jev-1.13.0" }], ["Unsure", { genre: "Poetry" as const, confidence: 0.3, model: "jev-1.13.0" }]]);
  const asked: string[] = [];
  assert.equal(await judgeGenres(deps(repo, workIds, async (book) => { asked.push(book.title); return answers.get(book.title)!; }), 50, new AbortController().signal), null);
  assert.deepEqual(asked.sort(), ["Sure", "Unsure"]);
  const genres = (title: string) => (db.prepare("SELECT genres FROM books WHERE title = ?").get(title) as { genres: string }).genres;
  assert.equal(genres("Sure"), JSON.stringify(["History"]));
  assert.equal(genres("Unsure"), "[]");
  assert.deepEqual(repo.genreJudgments(workIds).get(workIds[1]!), { genre: "Poetry", confidence: 0.3 });
  assert.equal(await judgeGenres(deps(repo, workIds, async () => { throw new Error("asked twice"); }), 50, new AbortController().signal), null);
});

test("a failed request stores nothing, stops the run and is rethrown", async () => {
  const { repo, workIds } = seeded(["A1", "A2", "A3", "A4", "A5", "A6"]);
  let calls = 0;
  const busy: Classify = async () => {
    calls += 1;
    throw new SourceUnavailableError("typesafe", "HTTP 529", { status: 529 });
  };
  await assert.rejects(judgeGenres(deps(repo, workIds, busy), 50, new AbortController().signal), SourceUnavailableError);
  assert.equal(calls, 4);
  assert.equal(repo.genreJudgments(workIds).size, 0);
});

test("a rejected key alerts and pauses the job for a day", async () => {
  const { repo, workIds } = seeded(["A"]);
  const alerts: string[] = [];
  const rejected: Classify = async () => { throw new SourceUnavailableError("typesafe", "HTTP 401", { status: 401 }); };
  assert.equal(await judgeGenres(deps(repo, workIds, rejected, alerts), 50, new AbortController().signal), NOW + 24 * 60 * 60 * 1000);
  assert.deepEqual(alerts, ["TypeSafe rejected the genre requests"]);
});

test("Jev reads the work's title, author, edition languages, publishers and longest synopsis", () => {
  assert.deepEqual(jevBookOf({ work: { id: "w", title: "Os Anões", author: "Harold Pinter", summary: null }, editions: [
    { title: "Os Anões", language: "pt-PT", isbn: null, publisher: "Relógio", year: null, summary: "Curto." },
    { title: "The Dwarfs", language: "en", isbn: null, publisher: null, year: 1990, summary: "x".repeat(1500) },
    { title: "Os Anões", language: "pt-PT", isbn: null, publisher: "Relógio", year: null, summary: null }
  ] }), { title: "Os Anões", author: "Harold Pinter", editionLanguages: ["pt-PT", "en"], publishers: ["Relógio"], synopsis: "x".repeat(1200) });
});
```

Add the file to `backend/package.json` `"test"`.

- [ ] **Step 2: Run to verify they fail**

Run: `npm run typecheck --workspace backend`
Expected: FAIL with "Cannot find module './genreJudgments.js'".

- [ ] **Step 3: Implement**

`backend/src/modules/books/genreJudgments.ts`:

```ts
import type { ClassifyGenre, JevBook } from "./adapters/typesafe/jevGenres.js";
import { SourceUnavailableError } from "./domain/errors.js";
import type { BooksRepository } from "./domain/ports.js";
import type { GenreEvidence } from "./domain/types.js";
import { longestSynopsis } from "./genrePass.js";

export const GENRE_SAVE_LINE = 0.5;
export const GENRE_JUDGMENT_BATCH = 50;
const IN_FLIGHT = 4;
const KEY_PAUSE_MS = 24 * 60 * 60 * 1000;

export type GenreJudgmentDeps = {
  repo: BooksRepository;
  classify: ClassifyGenre;
  heldWorkIds: () => string[];
  now: () => number;
  alert: (subject: string, text: string) => void;
};

const distinct = (values: Array<string | null>) => [...new Set(values.filter((value): value is string => Boolean(value)))];

export function jevBookOf(evidence: GenreEvidence): JevBook {
  return {
    title: evidence.work.title,
    author: evidence.work.author,
    editionLanguages: distinct(evidence.editions.map((edition) => edition.language)),
    publishers: distinct(evidence.editions.map((edition) => edition.publisher)),
    synopsis: longestSynopsis(evidence)
  };
}

export async function judgeGenres(deps: GenreJudgmentDeps, limit: number, signal: AbortSignal): Promise<number | null> {
  const held = [...new Set(deps.repo.canonicalWorkIds(deps.heldWorkIds()).values())];
  const workIds = deps.repo.worksNeedingGenreJudgment(held, limit);
  const failures: unknown[] = [];
  let next = 0;
  const worker = async () => {
    while (failures.length === 0 && !signal.aborted && next < workIds.length) {
      const workId = workIds[next++]!;
      const evidence = deps.repo.genreEvidence(workId);
      if (!evidence) continue;
      try {
        const judgment = await deps.classify(jevBookOf(evidence));
        deps.repo.saveGenreJudgment({ workId, model: judgment.model, genre: judgment.genre, confidence: judgment.confidence, askedAt: new Date(deps.now()).toISOString() });
      } catch (error) {
        failures.push(error);
      }
    }
  };
  await Promise.all(Array.from({ length: IN_FLIGHT }, worker));
  deps.repo.applyGenreJudgments(GENRE_SAVE_LINE);
  if (failures.length === 0) return null;
  const [failure] = failures;
  if (failure instanceof SourceUnavailableError && (failure.status === 401 || failure.status === 422)) {
    deps.alert("TypeSafe rejected the genre requests", `TypeSafe answered ${failure.status}, so genre judgments are paused for a day. Check TYPESAFE_API_KEY.`);
    return deps.now() + KEY_PAUSE_MS;
  }
  throw failure;
}
```

1. **Plugin.** `books/plugin.ts`:
   - Line 4 becomes `import { env, isbndbConfigured, typesafeConfigured } from "../../config/env.js";`.
   - Add the imports `import { createJevGenreClassifier } from "./adapters/typesafe/jevGenres.js";` and `import { GENRE_JUDGMENT_BATCH, judgeGenres } from "./genreJudgments.js";`.
   - `BooksPluginOptions` gains `heldWorkIds?: () => string[];`.
   - After `stopColorBackfill` is created:

```ts
  const heldWorkIds = options.heldWorkIds;
  const classify = typesafeConfigured ? createJevGenreClassifier(env.TYPESAFE_API_KEY) : null;
  const stopGenreJudgments = classify && heldWorkIds
    ? startDetailsBackfill(
        (signal) => judgeGenres({
          repo,
          classify,
          heldWorkIds,
          now: Date.now,
          alert: (subject, text) => {
            options.alert?.(subject, text).catch((error: unknown) => app.log.error({ err: error }, "TypeSafe key alert failed"));
          }
        }, GENRE_JUDGMENT_BATCH, signal),
        (error) => app.log.error({ err: error }, "genre judgments failed")
      )
    : () => undefined;
```

   - In `onClose`, add `stopGenreJudgments();` after `stopColorBackfill();`.

2. **App.** `app.ts`: add `heldWorks` to the `./modules/library/index.js` import on line 44. In the `registerBooksModule` options, add:

```ts
    heldWorkIds: () => heldWorks().map((work) => work.workId),
```

3. **README.** `backend/README.md`, `books` section:
   - A bullet: "**Genre judgments (Jev):** every 10 minutes, and once at boot, up to 50 works that a library holds, that have no genres, and whose details lookup has finished are asked once to Jev (`jev-1.13.0`, one genre Choice). Every answer is stored in `genre_judgments`. Answers at 0.5 or above are written as `genres_source = 'jev'`, and below 0.8 they show as possible genres. A 401 or 422 sends an alert and pauses the job for a day. Delete a judgment to ask again."
   - Next to `ISBNDB_API_KEY`: "**`TYPESAFE_API_KEY`** (optional): turns the genre judgment job on."

- [ ] **Step 4: Run to verify they pass**

Run: `npm run typecheck --workspace backend && npm test --workspace backend`
Expected: PASS. `booksWiring.test.ts` and `works/app.test.ts` set no `TYPESAFE_API_KEY`, so the job stays off there.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/books/genreJudgments.ts backend/src/modules/books/genreJudgments.test.ts backend/src/modules/books/plugin.ts backend/src/app.ts backend/package.json backend/README.md && git commit -m "$(cat <<'EOF'
Ask Jev for the genres of held works the catalog still can't place

A books backfill (10 min, 50 works, 4 in flight) classifies works a
library holds once Open Library and ISBNdb have had their try, stores
every answer and applies those at 0.5 or above. A failure stops the run
and stores nothing; a rejected key alerts and pauses the job for a day
instead of alerting every ten minutes. Off unless TYPESAFE_API_KEY is set.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

### Task 10: Possible genres on the work page, book screen model and export

**Files:**
- Modify: `packages/shared/src/works/types.ts`. Add `possibleGenres?: string[];` to `WorkPage["work"]` after `genres`.
- Modify: `packages/shared/src/works/bookScreen.ts`:
  - `BookScreenModel.possibleGenres` (line 17)
  - the value (line 73)
- Modify: `backend/src/modules/works/service.ts`. The genres line becomes `...workGenres(work.editions),`.
- Modify: `backend/src/modules/books/genrePass.ts`. Select works that have only possible genres, and attach `jev`.
- Test:
  - `packages/shared/src/works/bookScreen.test.ts`
  - `backend/src/modules/works/service.test.ts`
  - `backend/src/modules/books/genrePass.test.ts`

**Interfaces:**
- Produces:
  - `WorkPage.work.possibleGenres?: string[]`
  - `BookScreenModel.possibleGenres: string[]`
  - `GenrePassWork.jev: { genre: string | null; confidence: number } | null`

- [ ] **Step 1: Write the failing tests**

`packages/shared/src/works/bookScreen.test.ts`:

```ts
test("possible genres pass through, and a page from a backend without them gives none", () => {
  assert.deepEqual(bookScreenModel(page({ possibleGenres: ["History"] }), null, { isAdmin: false }).possibleGenres, ["History"]);
  assert.deepEqual(bookScreenModel(page(), null, { isAdmin: false }).possibleGenres, []);
  assert.deepEqual(bookScreenModel(null, owned(), { isAdmin: false }).possibleGenres, []);
});
```

`backend/src/modules/works/service.test.ts`, after "genres: most editions first, capped at three":

```ts
test("genres only a Jev guess below the confident line carries are possible, after the others", () => {
  const getWorkPage = pageOf([edition("e1", null, { genres: ["History"] }), edition("e2", null, { genres: ["Biography & Memoir"], possible: true })]);
  const work = createWorksService(deps({ getWorkPage })).getPage("w", null)!.work;
  assert.deepEqual([work.genres, work.possibleGenres], [["History"], ["Biography & Memoir"]]);
});
```

`backend/src/modules/books/genrePass.test.ts`:
- In "the export lists held works with no genres, finished ones first", add `jev: null` to the expected `rows[0]`.
- Append:

```ts
test("the export also lists works whose only genres are Jev's possible ones, with Jev's answer", () => {
  const { db, repo, blank, tagged } = seeded();
  repo.saveGenreJudgment({ workId: blank, model: "jev-1.13.0", genre: "Biography & Memoir", confidence: 0.6, askedAt: "2026-10-14T00:00:00.000Z" });
  repo.applyGenreJudgments(0.5);
  db.prepare("UPDATE books SET genres = ?, genres_source = 'jev', genres_confidence = 0.95 WHERE work_id = ?").run(JSON.stringify(["Science Fiction"]), tagged);
  const rows = genrePassWorksWith(repo, [{ workId: blank, holders: 1, finished: true }, { workId: tagged, holders: 1, finished: true }]);
  assert.deepEqual(rows.map((entry) => [entry.workId, entry.jev]), [[blank, { genre: "Biography & Memoir", confidence: 0.6 }]]);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test --workspace @scripta/shared && npm run typecheck --workspace backend`
Expected: FAIL. `possibleGenres` and `jev` don't exist.

- [ ] **Step 3: Implement**

1. **Shared type.** `works/types.ts`: in `WorkPage.work`, after `genres: string[];`, add `possibleGenres?: string[];`.

2. **Book screen model.** `bookScreen.ts`:
   - add `possibleGenres: string[];` to `BookScreenModel` after `genres`;
   - in the returned object, after `genres`, add `possibleGenres: work?.possibleGenres ?? [],`.

3. **Works service.** `works/service.ts`: replace `genres: workGenres(work.editions).genres,` with `...workGenres(work.editions),`.

4. **Genre pass.** `genrePass.ts`:
   - add `jev: { genre: string | null; confidence: number } | null;` to `GenrePassWork`;
   - in `genrePassWorksWith`, after `const genres = …`, add `const judgments = books.genreJudgments([...merged.keys()]);`;
   - change the evidence line to:

```ts
      const evidence = (genres.get(workId)?.genres.length ?? 0) > 0 ? undefined : books.genreEvidence(workId);
```

   - add `jev: judgments.get(workId) ?? null` to the returned object.
   - Update the README "Genre pass" export description: "…how many libraries hold it, and Jev's answer when there is one. It lists works with no genres or with only possible ones."

- [ ] **Step 4: Run to verify they pass**

Run: `npm run build --workspace @scripta/shared && npm test --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/works backend/src/modules/works/service.ts backend/src/modules/books/genrePass.ts backend/src/modules/books/genrePass.test.ts backend/README.md && git commit -m "$(cat <<'EOF'
Expose possible genres on the work page and queue them for review

Genres only a Jev guess below 0.8 carries come back as possibleGenres,
after the confident ones, within the three-genre cap; the book screen
model passes them through and an older backend just yields none. The
genre pass export now lists works whose only genres are possible, with
Jev's answer beside them.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

### Task 11: "Possibly …" chips on both book screens

**Files:**
- Modify: `frontend/src/components/book/BookScreen.tsx:188-199`
- Modify: `mobile/src/features/works/BookScreen.tsx:160-171` and the styles at lines 298-299
- Test: `frontend/scripts/test-work-page.mts`

**Interfaces:**
- Consumes: `BookScreenModel.possibleGenres` (Task 10).

- [ ] **Step 1: Write the failing web test**

Append to `frontend/scripts/test-work-page.mts`:

```ts
test("possible genres read as possible", () => {
  const html = render({ page: { ...page, work: { ...page.work, possibleGenres: ["History"] } } });
  assert.ok(html.includes("Possibly History"));
  assert.ok(html.includes("Science Fiction"));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build --workspace @scripta/shared && npm test --workspace frontend`
Expected: FAIL. "possible genres read as possible" can't find `Possibly History`.

- [ ] **Step 3: Implement**

Web, replacing the genres block:

```tsx
            {model.genres.length + model.possibleGenres.length > 0 ? (
              <ul className="mt-3 flex flex-wrap justify-center gap-1.5 sm:justify-start">
                {model.genres.map((genre) => (
                  <li key={genre} className="rounded-full border border-(--color-border) px-2 text-xs text-(--color-text-dim)">
                    {genre}
                  </li>
                ))}
                {model.possibleGenres.map((genre) => (
                  <li key={genre} className="rounded-full border border-dashed border-(--color-border) px-2 text-xs text-(--color-text-dim)">
                    {`Possibly ${genre}`}
                  </li>
                ))}
              </ul>
            ) : null}
```

Mobile, replacing the genres block:

```tsx
        {model.genres.length + model.possibleGenres.length > 0 ? (
          <View style={styles.chips}>
            {model.genres.map((genre) => (
              <View key={genre} style={[styles.chip, { borderColor: colors.border }]}>
                <Text numberOfLines={1} {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{genre}</Text>
              </View>
            ))}
            {model.possibleGenres.map((genre) => (
              <View key={genre} style={[styles.chip, styles.possibleChip, { borderColor: colors.border }]}>
                <Text numberOfLines={1} {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{`Possibly ${genre}`}</Text>
              </View>
            ))}
          </View>
        ) : null}
```

Then add `possibleChip: { borderStyle: "dashed" },` after `chip` in the mobile styles.

- [ ] **Step 4: Run to verify**

Run:

```bash
npm test --workspace frontend && npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm run typecheck --workspace mobile && npm test --workspace mobile
```

Expected: PASS.

- [ ] **Step 5: Device pass, covering Task 5 as well**

The device checker never writes the dev database, so prepare the data yourself, in the dev databases the emulator stack uses (see `docs/dev-workflow.md` and `scripts/dev-emulator.mjs`):
- In the dev catalog, give one fixture-owned work a possible genre: `UPDATE books SET genres = '["History"]', genres_source = 'jev', genres_confidence = 0.6 WHERE work_id = '<work id>'`.
- In the dev library document, set that book's `_genres` to `[]`.

Run `node scripts/dev-status.mjs --json` first. Then dispatch `device-checker` with:
- the worktree path;
- the screens: the library, and that book's screen;
- what correct looks like: after the app loads, the book has a genre (the catalog copy landed through the hook), and its book screen shows a dashed "Possibly History" chip.

Then restore the dev rows.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/book/BookScreen.tsx frontend/scripts/test-work-page.mts mobile/src/features/works/BookScreen.tsx && git commit -m "$(cat <<'EOF'
Show Jev's possible genres as dashed "Possibly …" chips

A genre only a Jev guess below 0.8 carries reads as a suggestion on the
book screen, after the confident genres, on web and mobile.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

### Phase 2 wrap-up

- [ ] Run every verify command in Global Constraints. All must pass.
- [ ] Dispatch `branch-reviewer` with this plan and the spec.
- [ ] This branch touches an API key. Run the `security-review` skill before merge.
- [ ] Ship Phase 2 with the `ship` skill: push, PR, `--auto`.

---

## After both PRs merge (the user runs these)

1. **Deploy** when the user asks, with `gh workflow run deploy.yml -f sha=<main tip>`. Then publish the mobile OTA by hand from `mobile/`, after building `@scripta/shared`:

   ```bash
   EXPO_PUBLIC_API_URL=https://api.atmyshelf.com npx eas-cli update --channel production --platform android --environment production
   ```

   `TYPESAFE_API_KEY` is still unset, so the Jev job stays off.
2. **First manual pass.** The 2026-10-14 export and Claude's labels are kept outside the repo, in `~/.config/scripta/genre-pass/2026-10-14/`.
   - The user reviews the 18 works where Jev disagreed with Claude, and Claude's 17 low-confidence, no-fit and unknown rows.
   - Claude converts the labels to `[{ workId, genres }]` (main genre first; none → `[]`).
   - The user runs the README import command.
3. **Turn Jev on.** The user creates a fresh TypeSafe key, because the current one passed through a chat transcript, and sets `TYPESAFE_API_KEY` in Railway. The job starts on the redeploy.
4. **Check.** Rerun the count. "Fixed by re-check" and "needs classification" should be near zero for libraries that have loaded since. A new import's genres should appear within about 20 minutes, on the owner's next load.
