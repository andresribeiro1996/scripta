# ISBNdb-First Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- Title search lists ISBNdb's hits before Open Library's.
- 200 ISBNdb calls a day stay free for searches.
- Result rows show the publisher, so Portugal and Brazil editions can be told apart.

**Architecture:**
- `compositeCatalog.search({ text })` puts ISBNdb's hits first and lets Open Library fill the remaining places.
- A persisted daily budget, using the existing `typesafe_usage` counter, guards every ISBNdb request except searches.
- The `@scripta/shared` byline helper replaces three identical inline joins in the clients.

**Tech Stack:** Fastify/TypeScript backend with SQLite (`node:sqlite`), `@scripta/shared` (consumed from `dist`), Expo mobile app, React/Vite web app, `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-18-isbndb-first-search-design.md`

## Global Constraints

- **No comments in code** (root `AGENTS.md`). The why goes in the commit message.
- **Rebuild shared before typechecking or testing mobile, frontend or backend:** `npm run build --workspace @scripta/shared`.
- **New backend test files go in the explicit list** in `backend/package.json`'s `test` script, or CI won't run them.
- **Keep the API unchanged.** No route, field or query parameter changes. Older installed apps keep working.
- **Reuse:**
  - `SourcePausedError` from `backend/src/modules/books/domain/errors.ts`.
  - `nextUtcMidnight` from `adapters/isbndb/isbndbGate.ts`.
  - `utcDay` and the `Spend` type from `backend/src/modules/books/typesafe.ts`.
  - `repo.spendTypesafe(day, source, limit)` (persisted per day and source; returns false once the day's count has reached `limit`).
- **Commits end with:** `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## Review Focus

- The ISBN branch of `compositeCatalog.search` and all of `fetchDetails` are unchanged.
- User search requests never touch the budget. Every other ISBNdb request (covers, details, and the retitle job's ISBN searches) goes through it exactly once, at the moment the HTTP request is made (inside the throttle, in the gate's inner `run`).
- A spent budget throws `SourcePausedError` and does **not** pause the gate. A search right after a refused details or cover call still reaches ISBNdb.

### Task 1: ISBNdb hits first in text search

**Files:**
- Modify: `backend/src/modules/books/adapters/catalog/compositeCatalog.ts`
- Test: `backend/src/modules/books/adapters/catalog/compositeCatalog.test.ts`
- Modify: `backend/README.md`

**Behaviour:**
- `search({ text })` concatenates the secondary (ISBNdb) hits, then the primary (Open Library) hits.
- It drops repeats by `hitKey`. Hits with a null key are always kept.
- It slices to `SEARCH_LIMIT`.
- When a repeat is dropped, the kept hit takes the repeat's `workKey`, `olCoverId` and `result.coverUrl` for whichever it lacks (null or undefined). Without this, the Open Library work key search saves today would be lost, and the row would lose Open Library's thumbnail, since ISBNdb hits have `coverUrl: null`.
- `listsOf` failure semantics are unchanged: one source down returns the other's hits, and both down throws.
- The `interleave` helper becomes unused. Delete it.

- [ ] **Step 1: Rewrite the order tests to the new rule.** In `compositeCatalog.test.ts`, replace the three tests `"a text search alternates Open Library and ISBNdb hits, dropping repeats"`, `"a text search lets the longer side finish the list"` and `"a text search is capped with both sources represented"` with:

```ts
test("a text search lists ISBNdb hits first, then Open Library's, dropping repeats", async () => {
  const ol = fake(null, [hit("Dune", "9780441013593"), hit("Emma", null, "Jane Austen"), hit("Ubik", null, "Philip K. Dick")]);
  const bn = fake(null, [hit("Dune", "9780441013593"), hit("Emma", "9780141439587", "Jane Austen"), hit("Emma", null, "Jane Austen"), hit("Dune Messiah", "9780593098233")]);
  assert.deepEqual(titles(await createCompositeCatalog(ol.catalog, bn.catalog).search({ text: "dune" })), ["Dune", "Emma", "Emma", "Dune Messiah", "Ubik"]);

  const first = fake(null, [hit("A", "9780000000001"), hit("B", "9780000000002")]);
  const second = fake(null, [hit("C", "9780000000003"), hit("D", "9780000000004")]);
  assert.deepEqual(titles(await createCompositeCatalog(first.catalog, second.catalog).search({ text: "x" })), ["C", "D", "A", "B"]);
});

test("a text search lets Open Library fill the places ISBNdb leaves", async () => {
  const short = fake(null, [hit("A", "9780000000001")]);
  const long = fake(null, [hit("B", "9780000000002"), hit("C", "9780000000003"), hit("D", "9780000000004")]);
  assert.deepEqual(titles(await createCompositeCatalog(long.catalog, short.catalog).search({ text: "x" })), ["A", "B", "C", "D"]);
  assert.deepEqual(titles(await createCompositeCatalog(short.catalog, long.catalog).search({ text: "x" })), ["B", "C", "D", "A"]);
});

test("a text search is capped, and a full ISBNdb page leaves no room for Open Library", async () => {
  const many = (prefix: string) => Array.from({ length: 20 }, (_, index) => hit(`${prefix}${index}`, null, prefix));
  const hits = await createCompositeCatalog(fake(null, many("O")).catalog, fake(null, many("I")).catalog).search({ text: "book" });
  assert.equal(hits.length, 12);
  assert.deepEqual(titles(hits), Array.from({ length: 12 }, (_, index) => `I${index}`));
});

test("a kept ISBNdb hit takes the work key and cover id of the Open Library repeat it replaces", async () => {
  const plain = hit("Dune", "9780441013593");
  const olHit = { ...plain, result: { ...plain.result, coverUrl: "https://covers.openlibrary.org/b/id/42-M.jpg" }, olCoverId: 42, workKey: "/works/OL893415W" };
  const bnHit = hit("Dune", "9780441013593", "Frank Herbert", "isbndb");
  const [kept] = await createCompositeCatalog(fake(null, [olHit]).catalog, fake(null, [bnHit]).catalog).search({ text: "dune" });
  assert.equal(kept!.source, "isbndb");
  assert.equal(kept!.olCoverId, 42);
  assert.equal(kept!.workKey, "/works/OL893415W");
  assert.equal(kept!.result.coverUrl, "https://covers.openlibrary.org/b/id/42-M.jpg");
});
```

- [ ] **Step 2: Run them and watch them fail.** Run `cd backend && npx tsx --test src/modules/books/adapters/catalog/compositeCatalog.test.ts`. Expected: the four tests above fail and every other test passes.

- [ ] **Step 3: Implement.** Replace the `interleave(...)…slice(...)` chain in the text branch of `search` with a loop over `[...secondaryHits!, ...primaryHits!]`:
  - Keep a `Map` from key to index in the output.
  - Push hits whose key is new or null.
  - For a repeat, replace the kept entry with a copy that fills its missing `workKey`/`olCoverId` from the repeat. Only copy when there is something to fill.
  - Then `.slice(0, SEARCH_LIMIT)`.
  - Delete `interleave`.
  - In `backend/README.md`, change "the two lists are interleaved (Open Library first), repeats dropped, capped at 12 in all" to say that ISBNdb's hits come first, Open Library fills the rest, repeats are dropped (a kept ISBNdb hit takes a dropped Open Library repeat's work key and cover), and the list is capped at 12.

- [ ] **Step 4: Verify.** Run `npm run build --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend`. Expected: all pass.

- [ ] **Step 5: Commit.** Message: `List ISBNdb hits before Open Library's in title search`. The body explains that interleaving kept only ISBNdb's first six of twenty, so Porto Editora's *A Casa dos Espíritos* (ISBNdb's 9th) never showed, while Open Library filled the other six places with unrelated books.

### Task 2: Keep 200 ISBNdb calls a day for searches

**Files:**
- Create: `backend/src/modules/books/adapters/isbndb/isbndbBudget.ts`
- Test: `backend/src/modules/books/adapters/isbndb/isbndbBudget.test.ts`
- Modify: `backend/src/modules/books/adapters/sources/isbndb.ts`
- Test: `backend/src/modules/books/adapters/sources/sources.test.ts`
- Modify: `backend/src/modules/books/adapters/isbndb/isbndbCatalog.ts`
- Test: `backend/src/modules/books/adapters/isbndb/isbndbCatalog.test.ts`
- Modify: `backend/src/modules/books/plugin.ts`
- Modify: `backend/package.json`
- Modify: `backend/README.md`

**Interfaces:**
- Produces `createIsbndbBudget(repo: Pick<BooksRepository, "spendTypesafe">, limit: number, now: () => number = Date.now): Spend`.
  - Each call runs `repo.spendTypesafe(utcDay(now()), "isbndb", limit)`.
  - When that returns false, it throws `new SourcePausedError("isbndb", \`daily budget of ${limit} non-search calls reached\`, { retryAt: nextUtcMidnight(now()) })`.
- `createIsbndbGet(apiKey, throttle, gate, urgent = false, spend?: Spend)` calls `spend?.()` immediately before `fetchJson`, inside the inner `gate.run`:

```ts
gate.run(() => throttle(() => gate.run(() => {
  spend?.();
  return fetchJson("isbndb", url, { Authorization: apiKey });
}), { urgent }))
```

- `createIsbndbSource(apiKey, throttle, gate, spend?: Spend)` passes `spend` to its getter, so `byIsbn` and `byTitle` both spend.
- `createIsbndbCatalog(apiKey, throttle, gate, urgent = true, spends: { details?: Spend; search?: Spend } = {})` builds one getter for `fetchDetails` with `spends.details` and one for `search` with `spends.search`.
- `plugin.ts`:
  - Add `const ISBNDB_DAILY_QUOTA = 5000;` and `const ISBNDB_SEARCH_RESERVE = 200;` next to the other ISBNdb constants.
  - After `repo` exists, build `const isbndbSpend = createIsbndbBudget(repo, ISBNDB_DAILY_QUOTA - ISBNDB_SEARCH_RESERVE);`.
  - Pass it to:
    - the cover source (`createIsbndbSource`);
    - the foreground catalog as `{ details: isbndbSpend }`;
    - the background catalog as `{ details: isbndbSpend }` (inside `capDailyCalls`, which stays);
    - `retitleIsbndb` as `{ details: isbndbSpend, search: isbndbSpend }`, since the retitle job (`retitleJob.ts:29`) calls `search({ isbn })` up to 25 times every 10 minutes.

- [ ] **Step 1: Write the failing tests.**
  - `isbndbBudget.test.ts`, with a fake `{ spendTypesafe }` that records its arguments and answers like the SQL does (the first call of a day always succeeds; later ones only while the count is below `limit`). Don't import `connection.ts`: it pulls in `config/env.js`, which exits without its variables. `spendTypesafe` itself is already covered by the TypeSafe tests. With `limit` 2 and a fixed `now`:
    - two calls pass, and the third throws `SourcePausedError` with `retryAt` equal to the next UTC midnight;
    - every call passes `utcDay(now())`, `"isbndb"` and `2`;
    - moving `now` past midnight lets calls pass again.
  - `sources.test.ts`:
    - with a counting `spend`, one `byIsbn` makes exactly one spend call;
    - a `spend` that throws `SourcePausedError` makes `byIsbn` reject with `SourcePausedError`, makes no `fetch` call, and does not pause the gate (a later `byIsbn` with a working spend reaches `fetch`).
  - `isbndbCatalog.test.ts`:
    - with `{ details: counting }`, `search({ text: "dune" })` and `search({ isbn })` spend nothing, and `fetchDetails` spends once;
    - with `{ details: throwing }`, `fetchDetails` rejects with `SourcePausedError` while `search({ text: "dune" })` still returns its hits;
    - with `{ search: counting }`, `search({ isbn })` spends once.
- [ ] **Step 2: Run them and watch them fail.** Run `cd backend && npx tsx --test src/modules/books/adapters/isbndb/isbndbBudget.test.ts src/modules/books/adapters/sources/sources.test.ts src/modules/books/adapters/isbndb/isbndbCatalog.test.ts`. Expected: the new tests fail; the budget test fails because the module is missing.
- [ ] **Step 3: Implement** the interfaces above. Add `src/modules/books/adapters/isbndb/isbndbBudget.test.ts` to `backend/package.json`'s `test` list, next to `isbndbDailyCap.test.ts`. In `backend/README.md`:
  - Replace "Users' and covers' ISBNdb calls don't count against the cap." with a sentence saying the 500 cap counts only the backfill.
  - Add one bullet after the ISBNdb gate bullet: every ISBNdb request except a user's search counts against a persisted daily budget of 4,800 (`ISBNDB_DAILY_QUOTA` − `ISBNDB_SEARCH_RESERVE` in `plugin.ts`, stored as source `isbndb` in `typesafe_usage`). That keeps 200 calls for searches. A spent budget throws `SourcePausedError` until 00:00 UTC without pausing the gate.
- [ ] **Step 4: Verify.** Run `npm run build --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend`. Expected: all pass.
- [ ] **Step 5: Commit.** Message: `Keep 200 ISBNdb calls a day for searches`. The body covers four points:
  - On 2026-10-17, cover re-checks and other background calls spent the 5,000-call quota by 02:29Z, so searches silently got Open Library only until midnight.
  - The budget counts every non-search request, stops at 4,800, and is persisted in the existing `typesafe_usage` counter so a deploy doesn't reset it.
  - A spent budget throws the same `SourcePausedError` `capDailyCalls` throws, and it doesn't pause the gate.
  - Searches aren't counted.

### Task 3: Show the publisher on search result rows

**Files:**
- Modify: `packages/shared/src/library/bookSearch.ts`
- Test: `packages/shared/src/library/bookSearch.test.ts`
- Modify: `mobile/src/features/search/SearchResultRow.tsx`
- Modify: `mobile/src/features/library/components/AddBookForm.tsx`
- Modify: `frontend/src/components/AddBookModal.tsx`
- Modify: `frontend/src/lib/bookSearch.ts`

**Interfaces:**
- Produces `searchResultByline(result: Pick<BookSearchResult, "authors" | "publisher" | "year">): string`, exported from `@scripta/shared` through `library/index.ts`'s existing `export * from "./bookSearch.js"`. It returns `[result.authors.join(", "), result.publisher, result.year].filter(Boolean).join(" · ")`.

- [ ] **Step 1: Write the failing test** in `bookSearch.test.ts`:

```ts
test("a search result byline reads author · publisher · year and skips what is missing", () => {
  const base = { authors: ["Isabel Allende"], publisher: "Porto Editora", year: 2013 };
  assert.equal(searchResultByline(base), "Isabel Allende · Porto Editora · 2013");
  assert.equal(searchResultByline({ ...base, publisher: null }), "Isabel Allende · 2013");
  assert.equal(searchResultByline({ authors: [], publisher: "Porto Editora", year: null }), "Porto Editora");
});
```

- [ ] **Step 2: Run it and watch it fail.** Run `npm test --workspace @scripta/shared`. Expected: the new test fails because `searchResultByline` is not exported.
- [ ] **Step 3: Implement and replace the three inline joins.**
  - `SearchResultRow.tsx:120`: `const byline = searchResultByline(result);`
  - `AddBookForm.tsx:193` and `AddBookModal.tsx:275`: `{searchResultByline(r)}`
  - `AddBookModal.tsx` imports from `../lib/bookSearch`, so add `searchResultByline` to that file's re-export from `@scripta/shared`.
  - The rows keep their existing one-line truncation.
- [ ] **Step 4: Verify.** Run, in order:
  1. `npm run build --workspace @scripta/shared && npm test --workspace @scripta/shared`
  2. `npm run typecheck --workspace mobile && npm test --workspace mobile`
  3. `npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend`

  Expected: all pass.
- [ ] **Step 5: Commit.** Message: `Show the publisher on book search results`. The body explains that Brazilian and Portugal editions of the same title read identically ("A casa dos espíritos · Isabel Allende · 2010"), and the publisher is what tells them apart.
- [ ] **Step 6: Device pass (main session dispatches `device-checker`; it gates merge, not the PR).** The web modal gets no browser check: the shared helper's test and the frontend typecheck cover a one-line join.
  - Search tab: submit "dune". Each book row's second line reads author · publisher · year when the publisher is known, on one line.
  - Library → Add → Search by title: the same for one search.
  - Two screenshots.
