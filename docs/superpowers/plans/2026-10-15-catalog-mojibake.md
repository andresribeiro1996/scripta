# Catalog Mojibake Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop Open Library mojibake ("fÃ©" for "fé") from entering the catalog, and give the owner a script that repairs the rows already stored.

**Architecture:** Our decoding is correct; the mojibake arrives already broken in Open Library's own records, and nothing repairs it. A conservative `repairMojibake` in `@scripta/shared` undoes UTF-8-read-as-Windows-1252/Latin-1. It is applied where external text becomes catalog identity: `lookupIdentity` (the funnel for the seed, the publisher importer, user lookups and external-search saves) and `mapOpenLibraryDoc` (so external search results also display repaired). A thin owner-run script repairs stored `books` and `works` rows.

**Tech Stack:** TypeScript, `node:test` via tsx, `node:sqlite`.

**Spec:** this plan. The diagnosis below is the evidence for the design.

## Diagnosis

- Every upstream body becomes a string through `res.json()` or `res.text()` (`adapters/http/http.ts:51`, `seed/fetchRankedWorks.ts:16-17`, `scripts/import-publisher-covers.mjs:22-34`). Both always decode UTF-8 and ignore the `Content-Type` charset. Nothing uses `TextDecoder` or `Buffer#toString` on upstream text.
- All 15 publisher feeds serve UTF-8 JSON. Page 1 of each (1,936 product names) has no mojibake. WooCommerce names carry `&#8211;`, `&#8217;`, `&#8230;` and `&amp;`, and `decodeEntities` (`seed/publisherFeed.ts:94-103`) decodes them correctly.
- Open Library stores the mojibake itself. `https://openlibrary.org/isbn/9789898217134.json` (source record `amazon:9898217138`) has the title `A Verdadeira Imagem : Entre a fÃ© e a crenÃ§a nas imagens`, and so do its work record and the search index. 26,516 public Open Library titles and authors (20 publishers, 4 languages) contain 4 such strings.
- `https://openlibrary.org/isbn/9789898895240.json` (source record `bwb:9789898895240`) has `N©o Abras Este Livro Outra Vez`. That corruption is lossy: every accented letter became `©`, as in other Open Library records like `Hist©rias` and `Guimar©es`. It can't be recovered from the text, so the repair leaves it alone and the script reports it.
- Every new `books.title`/`author` reaches the repository through `createBook` or `fillIdentity`. Every caller passes `lookupIdentity`'s output except two. `saveHits` passes the raw search result. `fillBlankTitles` passes publisher feed text, which is clean.
- The rule in Task 1 repairs all 4 mojibake strings in that public corpus and changes nothing else in it, nor any of the 2,260 publisher feed names.

## Global Constraints

- No comments in code.
- `@scripta/shared` is bundled into the mobile app. Its new module must not construct a non-UTF-8 `TextDecoder` at load time, so the Windows-1252 table is a string literal.
- Tests use synthetic strings only, never rows or titles taken from production.
- Backend: a new `*.test.ts` file must be added to the explicit list in `backend/package.json`'s `test` script. A test whose imports reach `config/env.js` (anything importing `adapters/sqlite/connection.js`) sets the env preamble first and loads modules with `await import()`; copy the preamble from `src/modules/books/seed/resetPublisherCovers.test.ts`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Verify: `npm run build --workspace @scripta/shared`, `npm test --workspace @scripta/shared`, `npm run typecheck --workspace @scripta/shared`, `npm run typecheck --workspace backend`, `npm test --workspace backend`.

## Review Focus

1. Correct text with an accented capital next to word-final punctuation (`NESCAFÉ® Receitas`, `CAFÉ’S`, `IRMÃ…`, `Zu Fuß…`) comes back unchanged. Tested in Task 1.
2. A title ending in a mojibake `à` (`VoilÃ` followed by U+00A0) is repaired, so repair must run before `trim()` (`trim` strips U+00A0). Tested in Task 1 (`mapOpenLibraryDoc`) and Task 2 (`lookupIdentity`).
3. A string that mixes mojibake with a character outside Windows-1252 (`fÃ© 日本`) is left whole, never half-repaired. Tested in Task 1.
4. A row edited between the script's scan and its write is skipped, not overwritten. Tested in Task 3.
5. When a repaired title's `ta:` key already belongs to another book, the key stays with that book and the run continues. Tested in Task 3.

---

### Task 1: `repairMojibake` in `@scripta/shared`, applied to Open Library search docs

**Files:**
- Create: `packages/shared/src/library/mojibake.ts`
- Create: `packages/shared/src/library/mojibake.test.ts`
- Modify: `packages/shared/src/library/index.ts` (add `export * from "./mojibake.js";`)
- Modify: `packages/shared/src/library/bookSearch.ts:109-127` (`mapOpenLibraryDoc`)
- Test: `packages/shared/src/library/bookSearch.test.ts`

**Interfaces:**
- Produces: `repairMojibake(text: string): string` and `hasMojibake(text: string): boolean`, both exported from `@scripta/shared`.

**Rule.** A *sequence* is what one UTF-8 multi-byte character looks like after a Windows-1252 or Latin-1 decode: a lead character U+00C2–U+00DF followed by 1 continuation character, U+00E0–U+00EF followed by 2, or U+00F0–U+00F4 followed by 3. Continuation characters are those standing for bytes 0x80–0xBF: U+0080–U+00BF, plus Windows-1252's 0x80–0x9F row. A sequence is *suspicious* unless it reads as ordinary text at the end of a word. That is the case when the character before the lead is a letter of the same case as the lead, and every continuation character is one of U+00A0 © ® » – — ’ ” … ™.

`repairMojibake` repeats one step until it stops:
- Stop if the text has no suspicious sequence.
- Map every character to its byte. Stop if any character has none.
- Decode the bytes as UTF-8. Stop on invalid UTF-8; the input can't contain U+FFFD, so a U+FFFD in the output means invalid bytes.
- Stop unless the result has fewer suspicious sequences than the input.
- Otherwise take the result and repeat.

Double-encoded text takes two steps. Each step lowers the count, so the loop ends.

- [ ] **Step 1: Write the failing tests**

`packages/shared/src/library/mojibake.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { hasMojibake, repairMojibake } from "./mojibake.js";

const asWindows1252 = (text: string) => new TextDecoder("windows-1252").decode(new TextEncoder().encode(text));
const asLatin1 = (text: string) => Buffer.from(text, "utf8").toString("latin1");

test("repairs UTF-8 that was read as Windows-1252", () => {
  for (const text of ["Café com Açúcar", "Viagem à Lua — “Edição” de Júlio’s", "Stanisław Lem", "日本語の本", "Um paraíso", "Voilà"]) {
    assert.equal(repairMojibake(asWindows1252(text)), text);
  }
});

test("repairs UTF-8 that was read as Latin-1, with C1 controls", () => {
  assert.equal(repairMojibake(asLatin1("Coração — “Edição”")), "Coração — “Edição”");
});

test("repairs text that was mis-decoded twice", () => {
  assert.equal(repairMojibake(asWindows1252(asWindows1252("Coração"))), "Coração");
  assert.equal(repairMojibake(asLatin1(asLatin1("Coração"))), "Coração");
});

test("leaves correct text alone", () => {
  for (const text of ["Coração", "SÃO PAULO", "CANAÃ AO OESTE", "O ESPIÃO DE DEUS", "Ângela", "1º Volume", "© 2010", "naïve café", "ÉTÉ", "Åsa Larsson", "Stanisław Lem", ""]) {
    assert.equal(repairMojibake(text), text);
  }
});

test("leaves an accented capital before word-final punctuation alone", () => {
  for (const text of ["NESCAFÉ® Receitas", "CAFÉ’S", "IRMÃ…", "A IRMÃ…", "Zu Fuß…", "irmã…»"]) {
    assert.equal(repairMojibake(text), text);
  }
});

test("leaves text it cannot repair whole", () => {
  assert.equal(repairMojibake("P©ssaro Azul"), "P©ssaro Azul");
  assert.equal(repairMojibake("fÃ© 日本"), "fÃ© 日本");
  assert.equal(repairMojibake("fÃ© \u{1F600}"), "fÃ© \u{1F600}");
});

test("hasMojibake flags text that still looks mis-decoded", () => {
  assert.equal(hasMojibake("Entre a fÃ© e a crenÃ§a"), true);
  assert.equal(hasMojibake("P©ssaro Azul"), true);
  assert.equal(hasMojibake("Caf�"), true);
  for (const text of ["Entre a fé e a crença", "IRMÃ…", "© 2010", "SÃO PAULO"]) assert.equal(hasMojibake(text), false);
});
```

Append to `packages/shared/src/library/bookSearch.test.ts` (import `mapOpenLibraryDoc` from `./bookSearch.js` if the file doesn't already):

```ts
test("mapOpenLibraryDoc repairs mojibake in the title and authors", () => {
  const result = mapOpenLibraryDoc({ title: "Entre a fÃ© e a crenÃ§a", author_name: ["JosÃ© Silva"], isbn: ["9780000000002"] });
  assert.equal(result?.title, "Entre a fé e a crença");
  assert.deepEqual(result?.authors, ["José Silva"]);
});

test("mapOpenLibraryDoc repairs a title ending in a mis-decoded à", () => {
  assert.equal(mapOpenLibraryDoc({ title: "VoilÃ " })?.title, "Voilà");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run build --workspace @scripta/shared && npm test --workspace @scripta/shared`
Expected: FAIL. `mojibake.test.ts` cannot import `./mojibake.js`, and the two `mapOpenLibraryDoc` tests fail on the title.

- [ ] **Step 3: Implement**

`packages/shared/src/library/mojibake.ts`:

```ts
const WINDOWS_1252_HIGH =
  "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ";
const BYTE_OF = new Map<string, number>();
for (let byte = 0; byte < 256; byte++) BYTE_OF.set(String.fromCharCode(byte), byte);
for (let index = 0; index < WINDOWS_1252_HIGH.length; index++) BYTE_OF.set(WINDOWS_1252_HIGH[index]!, 0x80 + index);

const CONTINUATION = `[\\u0080-\\u00bf${WINDOWS_1252_HIGH}]`;
const SEQUENCE = new RegExp(`[\\u00c2-\\u00df]${CONTINUATION}|[\\u00e0-\\u00ef]${CONTINUATION}{2}|[\\u00f0-\\u00f4]${CONTINUATION}{3}`, "g");
const WORD_END = /^[ ©®»–—’”…™]+$/;
const LETTER = /\p{L}/u;
const LOSSY = /�|\p{L}©\p{L}/u;

const isUpper = (char: string) => char !== char.toLowerCase();

function suspiciousSequences(text: string): number {
  let count = 0;
  for (const { 0: sequence, index } of text.matchAll(SEQUENCE)) {
    const before = text[index - 1] ?? "";
    const endsAWord = LETTER.test(before) && isUpper(before) === isUpper(sequence[0]!) && WORD_END.test(sequence.slice(1));
    if (!endsAWord) count++;
  }
  return count;
}

function decodeOnce(text: string): string | null {
  const suspicious = suspiciousSequences(text);
  if (suspicious === 0) return null;
  const bytes: number[] = [];
  for (const char of text) {
    const byte = BYTE_OF.get(char);
    if (byte === undefined) return null;
    bytes.push(byte);
  }
  const decoded = new TextDecoder().decode(Uint8Array.from(bytes));
  return decoded.includes("�") || suspiciousSequences(decoded) >= suspicious ? null : decoded;
}

export function repairMojibake(text: string): string {
  for (let next = decodeOnce(text); next !== null; next = decodeOnce(text)) text = next;
  return text;
}

export function hasMojibake(text: string): boolean {
  return suspiciousSequences(text) > 0 || LOSSY.test(text);
}
```

In `packages/shared/src/library/index.ts` add `export * from "./mojibake.js";` beside the other `book*` exports.

In `mapOpenLibraryDoc` (`bookSearch.ts`), import `repairMojibake` from `./mojibake.js` and repair before trimming:

```ts
    title: repairMojibake(doc.title).trim(),
    authors: Array.isArray(doc.author_name) ? doc.author_name.filter((a): a is string => typeof a === "string").map(repairMojibake) : [],
```

If TypeScript rejects `index` as possibly undefined in `suspiciousSequences`, use `match.index!` on the `RegExpExecArray`. Don't change the logic.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run build --workspace @scripta/shared && npm test --workspace @scripta/shared && npm run typecheck --workspace @scripta/shared`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/library/mojibake.ts packages/shared/src/library/mojibake.test.ts packages/shared/src/library/index.ts packages/shared/src/library/bookSearch.ts packages/shared/src/library/bookSearch.test.ts
git commit -m "Repair UTF-8 read as Windows-1252 in Open Library search docs" -m "<why: Open Library stores some titles already mis-decoded (e.g. /isbn/9789898217134.json, an amazon: import); our res.json() decoding is correct; the rule and its word-end guard>"
```

---

### Task 2: Repair at `lookupIdentity`, and store what was keyed in `saveHits`

**Files:**
- Modify: `backend/src/modules/books/domain/normalize.ts:1,102-110` (`lookupIdentity`)
- Modify: `backend/src/modules/books/booksService.ts:167-184` (`saveHits`)
- Test: `backend/src/modules/books/domain/normalize.test.ts`
- Test: `backend/src/modules/books/seed/seedCatalog.test.ts`
- Test: `backend/src/modules/books/booksService.test.ts`

**Interfaces:**
- Consumes: `repairMojibake` from `@scripta/shared` (Task 1). Rebuild shared first: `npm run build --workspace @scripta/shared`.
- Produces: `lookupIdentity` returns repaired, trimmed `title` and `author`, and its `titleKey`/`key` are computed from them. Callers need no change.

- [ ] **Step 1: Write the failing tests**

In `normalize.test.ts`, next to the existing `lookupIdentity` tests (match their style):

```ts
test("lookupIdentity repairs mojibake before keying", () => {
  assert.deepEqual(lookupIdentity({ isbn: "978-0-00-000000-2", title: "Entre a fÃ© e a crenÃ§a", author: "JosÃ© Silva" }), {
    key: "isbn:9780000000002",
    aliasKeys: [],
    titleKey: "ta:entre a fe e a crenca|jose silva|",
    isbn: "9780000000002",
    title: "Entre a fé e a crença",
    author: "José Silva"
  });
});

test("lookupIdentity repairs before trimming", () => {
  assert.equal(lookupIdentity({ title: "VoilÃ ", author: "Ana Lima" })?.title, "Voilà");
});
```

If `978-0-00-000000-2` doesn't canonicalise to `9780000000002` in this codebase, use any valid ISBN-13 and adjust `key`/`isbn`. The assertion that matters is the repaired title, author and `titleKey`.

In `seedCatalog.test.ts`, using that file's existing repository setup: seed one entry `{ isbn: "9780000000002", title: "Entre a fÃ© e a crenÃ§a", author: "JosÃ© Silva" }` through `seedBook`/`seedCatalog`. Assert:
- the stored book's `title` is `Entre a fé e a crença` and its `author` is `José Silva`;
- `title_key` is `ta:entre a fe e a crenca|jose silva|`;
- `findBookByKey("ta:entre a fe e a crenca|jose silva|")` returns that book.

In `booksService.test.ts`, using the existing harness's fake catalog: make an external search hit whose `result.title` is `Entre a fÃ© e a crenÃ§a` and whose `result.authors` is `["JosÃ© Silva"]`, as ISBNdb could send. Call `searchExternal`, then assert that the stored catalog row (found by the hit's ISBN key) has the repaired title and author. Model it on the existing `searchExternal` tests around `booksService.test.ts:674-750`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run build --workspace @scripta/shared && npm test --workspace backend`
Expected: the new tests FAIL on the mojibake title.

- [ ] **Step 3: Implement**

`normalize.ts`: add `repairMojibake` to the `@scripta/shared` import and repair before trimming:

```ts
  const title = repairMojibake(lookup.title ?? "").trim();
  const author = repairMojibake(lookup.author ?? "").trim();
```

`booksService.ts` `saveHits`: store the identity's values, the same text the keys were computed from:

```ts
      const book = findExisting(deps.repo, identity) ?? deps.repo.createBook(
        { title: identity.title, author: identity.author, isbn: identity.isbn, year: result.year, publisher: result.publisher, olCoverId, workKey, genres: result.genres, sources: [source] },
        keysOf(deps.repo, identity),
        now().toISOString()
      );
      if (!book.title || !book.author) deps.repo.fillIdentity(book.id, identity.title, identity.author);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run typecheck --workspace backend && npm test --workspace backend`
Expected: PASS, and no existing test changes.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/books/domain/normalize.ts backend/src/modules/books/booksService.ts backend/src/modules/books/domain/normalize.test.ts backend/src/modules/books/seed/seedCatalog.test.ts backend/src/modules/books/booksService.test.ts
git commit -m "Repair mojibake where external titles become catalog identity" -m "<why: lookupIdentity is the funnel for the seed, the importer, user lookups and search saves; keys and stored text now come from the same repaired text>"
```

---

### Task 3: Owner-run repair of stored rows

**Files:**
- Create: `backend/src/modules/books/seed/mojibakeRepair.ts`
- Create: `backend/src/modules/books/seed/mojibakeRepair.test.ts` (add to `backend/package.json`'s `test` list, after `seed/resetPublisherCovers.test.ts`)
- Create: `backend/scripts/repair-mojibake.mjs`
- Modify: `backend/README.md` (new `#### Mojibake repair` subsection after `#### Genre pass`)

**Interfaces:**
- Consumes: `repairMojibake`, `hasMojibake` from `@scripta/shared`; `workTitleKey` from `../domain/normalize.js`.
- Produces:

```ts
export interface RowRepair { id: string; title: string; author: string; repairedTitle: string; repairedAuthor: string }
export interface BookRepair extends RowRepair { origin: string }
export interface MojibakePlan {
  scanned: { books: number; works: number };
  books: BookRepair[];
  works: RowRepair[];
  stillBroken: Array<{ id: string; title: string; author: string }>;
}
export interface MojibakeApplied { books: number; works: number; skipped: number }
export function planMojibakeRepairs(db: DatabaseSync): MojibakePlan;
export function applyMojibakeRepairs(db: DatabaseSync, plan: MojibakePlan): MojibakeApplied;
export function mojibakeReport(plan: MojibakePlan, applied: MojibakeApplied | null): object;
```

**Behaviour:**
- `planMojibakeRepairs` reads only. It iterates `SELECT id, title, author, created_by, data_sources FROM books` and `SELECT id, title, author FROM works`.
  - A row is a repair when `repairMojibake(title) !== title` or `repairMojibake(author) !== author`. The repaired values are stored as returned, not trimmed.
  - A book whose repaired title or author still satisfies `hasMojibake` goes in `stillBroken`.
  - `origin` is `created_by` when set. Otherwise it is the `data_sources` JSON array joined with `+`, or `lookup` when that array is empty.
- `applyMojibakeRepairs` handles each book in its own `BEGIN IMMEDIATE` … `COMMIT`, with `ROLLBACK` and rethrow on error, as `resetPublisherCovers.ts` does. Inside each transaction:
  1. Run `UPDATE books SET title = ?, author = ?, title_key = ? WHERE id = ? AND title = ? AND author = ?`. The `title_key` is `repairedTitle ? workTitleKey(repairedTitle, repairedAuthor) : null`, matching `fillIdentity`. If no row changed, count it as `skipped` and commit.
  2. Otherwise, if `workTitleKey(repairedTitle, repairedAuthor)` is non-empty, run `INSERT OR IGNORE INTO book_keys (key, book_id) VALUES (?, ?)`. The mis-decoded key stays, so a later lookup with the old text still lands on this row.
  3. Run `UPDATE books_fts SET title = ?, author = ? WHERE book_id = ?`.
  
  Each work is one statement: `UPDATE works SET title = ?, author = ? WHERE id = ? AND title = ? AND author = ?`. If it changes nothing, count it as `skipped`.
- `mojibakeReport` returns:
  - `dryRun` (`applied === null`);
  - `books: { scanned, repaired, titles, authors }`, where `titles` and `authors` count changed fields;
  - `works: { scanned, repaired }`;
  - `origins`, the repaired books counted by `origin`;
  - `examples`, the first 20 book repairs as `{ id, from: "<title> — <author>", to: "<repairedTitle> — <repairedAuthor>" }`;
  - `stillBroken: { count, examples }`, with the first 10 as `"<title> — <author>"`;
  - `applied`, or `null` on a dry run.
- `scripts/repair-mojibake.mjs`:

```js
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false } } });
const dryRun = values["dry-run"];

const { env } = await import("../dist/config/env.js");
const { openBooksDb } = await import("../dist/modules/books/adapters/sqlite/connection.js");
const { applyMojibakeRepairs, mojibakeReport, planMojibakeRepairs } = await import("../dist/modules/books/seed/mojibakeRepair.js");

const db = dryRun ? new DatabaseSync(env.COVERS_DB_PATH, { readOnly: true }) : openBooksDb();
const plan = planMojibakeRepairs(db);
console.log(JSON.stringify(mojibakeReport(plan, dryRun ? null : applyMojibakeRepairs(db, plan)), null, 2));
```

- [ ] **Step 1: Write the failing tests**

`mojibakeRepair.test.ts`: env preamble, then `await import()` of `applyBooksMigrations` (`adapters/sqlite/connection.js`), `createSqliteBooksRepository`, `catalogTitleKey`/`workTitleKey` (`domain/normalize.js`) and the new module.

Build each case on a fresh `new DatabaseSync(":memory:")` + `applyBooksMigrations` + the real repository. Create rows with `repo.createBook(...)`, passing keys the way `seedBook` does (`["isbn:…", catalogTitleKey(title, author)]`) and `createdBy: "seed"` so the row is searchable. A row with `sources: ["openlibrary"]` and no `createdBy` covers the other origin. Cases:

1. **Repairs a mis-decoded book and everything derived from it.** Book `Entre a fÃ© e a crenÃ§a` / `JosÃ© Silva`, ISBN `9780000000002`. After `applyMojibakeRepairs(db, planMojibakeRepairs(db))`:
   - `books.title`/`author` are `Entre a fé e a crença`/`José Silva`;
   - `title_key` is `workTitleKey` of those;
   - `repo.findBookByKey("ta:entre a fe e a crenca|jose silva|")` returns the book, and the old mis-decoded `ta:` key still does;
   - `SELECT title, author FROM books_fts WHERE book_id = ?` returns the repaired text;
   - the book's `works` row has the repaired title and author;
   - `applied` is `{ books: 1, works: 1, skipped: 0 }`.
2. **Leaves correct and guarded text alone.** Books `Coração` / `Ana Lima` and `NESCAFÉ® Receitas` / `Rui Costa` are absent from `plan.books` and unchanged after apply.
3. **Planning writes nothing.** After `planMojibakeRepairs` alone, the mis-decoded book's row is byte-for-byte unchanged.
4. **Skips a row edited after the scan** (Review Focus 4). Plan, then `UPDATE books SET title = 'Edited' WHERE id = ?`, then apply. `skipped` is 1 and the title stays `Edited`.
5. **Leaves a `ta:` key held by another book** (Review Focus 5). Create a correct-titled book `Entre a fé e a crença` / `José Silva` (ISBN `9780000000019`) first, then the mis-decoded one (ISBN `9780000000002`). After apply, `findBookByKey("ta:entre a fe e a crenca|jose silva|")` still returns the first book, and the mis-decoded one is repaired.
6. **Reports what it can't repair.** Book `P©ssaro Azul` / `Ana Lima` is in `plan.stillBroken` and not in `plan.books`.
7. **Report shape.** With 25 mis-decoded books (vary the title per row, e.g. `Livro ${n} da fÃ©`), `mojibakeReport(plan, null)` has `dryRun: true`, `books.repaired: 25`, `examples.length: 20`, `origins: { seed: 25 }` and `applied: null`. With the `openlibrary`-sourced row, `origins.openlibrary` is 1.

ISBNs only need to be distinct, because `createBook` stores the keys you pass. Case 7 can use `isbn: null` with only the `ta:` key, since `${n}` makes each key distinct.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run build --workspace @scripta/shared && npm test --workspace backend`
Expected: FAIL. `mojibakeRepair.js` cannot be imported.

- [ ] **Step 3: Implement** `mojibakeRepair.ts` as specified, then the script, then the README subsection.

README `#### Mojibake repair` subsection (house style, short):
- Some Open Library records store titles and authors already mis-decoded (`fÃ©` for `fé`). New rows are repaired as they enter (`lookupIdentity`, `mapOpenLibraryDoc`). This script repairs rows stored earlier: title, author, `title_key`, the corrected `ta:` key, the search index and the works' copies.
- It repairs only text that round-trips. Text where every accented letter became `©` (`N©o`) is lossy and is listed under `stillBroken`.
- Run it after the deploy that contains it: first the dry run, then the real run. Reruns are safe; a second run finds nothing. Editions that now share a title key join one work at the next works grouping (boot, daily, or `POST /books/works/group`).
- Commands:

```
npx -y @railway/cli@latest ssh --project 404b0e4a-701b-47ea-83fc-a82a80ae5094 --environment 39833834-0e18-4dde-a57f-3bf0bf0bab51 --service scripta -- sh -c 'cd /app/backend && node scripts/repair-mojibake.mjs --dry-run'
npx -y @railway/cli@latest ssh --project 404b0e4a-701b-47ea-83fc-a82a80ae5094 --environment 39833834-0e18-4dde-a57f-3bf0bf0bab51 --service scripta -- sh -c 'cd /app/backend && node scripts/repair-mojibake.mjs'
```

- [ ] **Step 4: Run the tests, then smoke-test the script against a scratch database**

Run: `npm run typecheck --workspace backend && npm test --workspace backend`
Expected: PASS.

Then `npm run build --workspace backend`, and create a scratch covers DB in the scratchpad (not under `backend/data`) holding one mis-decoded book. Run the script with all six required env vars pointing into the scratchpad:
- `COVERS_DB_PATH` at the scratch DB;
- `AUTH_DB_PATH`, `LIBRARY_DB_PATH`, `GALLERY_DB_PATH`, `GALLERY_STORAGE_PATH` at scratch paths;
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` as any 32+ character strings.

Run it once with `--dry-run`: it should report the repair, and the DB file's row should be unchanged. Run it once without: the row should be repaired. Run it a third time: it should report `books.repaired: 0`. Paste the three outputs in the task report. Delete the scratch files.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/books/seed/mojibakeRepair.ts backend/src/modules/books/seed/mojibakeRepair.test.ts backend/scripts/repair-mojibake.mjs backend/package.json backend/README.md
git commit -m "Add an owner-run repair for mis-decoded catalog titles" -m "<why: rows stored before the fix keep their mojibake and mis-keyed title keys; per-row transactions keep each write lock short on the live database>"
```

---

## Out of scope (reported, not fixed here)

- Lossy `©` titles (`N©o`): they need a title from another source for the same ISBN (ISBNdb or a publisher feed). That would be a separate change.
- Open Library titles carrying MARC non-sorting markers U+0098/U+009C around a leading article (`\u0098O \u009cNatal…`). This affects 3.7% of the public sample, is invisible in most renderers, and is a separate clean-up.
- ISBNdb's `plainText` decodes only six entities, so a numeric entity in an ISBNdb title would stay literal.

## Amendments after review

These changes were made after review; the code, not the task text above, is authoritative.

- **Task 1 rule.** `Ã` followed by `©` or `®` never occurs in correct text, so `Ã©` and `Ã®` always count as suspicious, and `Ã»` counts when a lowercase letter follows it (`IRMÃ»` is ordinary text at a word end). Every other sequence keeps the word-end guard, because correct text such as `JOSÉ`, NBSP, `de Alencar`, `Groß`, NBSP, `und klein` and `NESCAFÉ®receitas` has an accented capital or `ß` before NBSP, ® or » and then a lowercase letter. Without this, mis-decoded text right after a capital (`PÃ©rez`, `MÃ©dia`, `SÃ©rgio` and the short `PÃ© de Meia`, `A FÃ©`, `ZÃ© Povinho`, `SÃ© de Braga`) was left alone. On the 28,776 public strings, it changes only the 4 that are mis-decoded. Mis-decoding 11,208 clean accented strings, as Windows-1252 or as Latin-1, it repairs all but 3. Cost: those 3 are an NBSP-spelled `à` right after a capital, as in Catalan `Pàmies`, which stays unrepaired. The guard's case check counts a mismatch only when an uppercase lead follows a lowercase letter, as the `Ã` of `VoilÃ`, NBSP does. A lowercase lead after a capital is ordinary text, and counting it decoded `A Fé`, NBSP, `– Poemas`, `Já`, NBSP, `– Poemas`, `Ilha da Sé`, NBSP, `— Guia` and `DER GROß`, NBSP, `UND KLEIN` into CJK, Mongolian and NKo letters. A mis-decoded lowercase lead after a capital (`Iâ€™m`) is still repaired, because its continuation characters are not all word-end ones. On the same 28,776 strings the output is unchanged, with the same 3 misses.
- **Task 3 search index.** `books_fts.book_id` is UNINDEXED, so updating by `book_id` scanned the whole index inside each write transaction. At about 19 ms per book, that held the write lock almost continuously and starved the live API. The rowids are now read in one query before any write, and each transaction updates by `rowid`. 150 repairs on 78k index rows went from 2.8 s to 73 ms.
- **Task 3 title key.** The corrected `ta:` key is `catalogTitleKey(repaired)`, added only when the row holds `catalogTitleKey(original)`. An ISBN-less book with a blank author now gets its corrected key. An ISBN book with a blank author still gets no authorless key.
- **Task 3 report.** The real run rewrites production text and the script keeps no copy of the originals, so the owner has to review every change in the dry run, not a sample. `mojibakeReport` lists every planned book repair as `repairs` (`{ id, from, to }`, no cap) instead of the first 20 as `examples`. `stillBroken.examples` stays capped at 10, because those rows are not changed. The README tells the owner to save the real run's output, which holds each repaired book's original title and author.
