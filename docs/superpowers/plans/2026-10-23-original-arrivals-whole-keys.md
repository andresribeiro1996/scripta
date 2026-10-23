# Original Arrivals Whole Keys Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The original-arrivals drain also finds Portuguese works whose original has a part after `". "`, such as "Mr. Mercedes", when that original arrives under its whole title.

**Architecture:** `books.original_whole_key` stores `originalWholeKey(original_title)` next to `original_key`. A covering partial index maps it to the stem keys. Every writer of `original_title` writes it, and the boot self-heal fills it. The drain probes both keys, then loads Guard 1's and the #323 rule's claims by each found stem key, so both stay exact.

**Tech Stack:** TypeScript, Fastify backend, `node:sqlite`, `node:test` via `tsx --test`, `@scripta/shared`.

**Spec:** `docs/superpowers/specs/2026-10-23-original-arrivals-whole-keys-design.md`

## Global Constraints

- `originalKey`, `titlePattern`, `titlePatterns` and `arrivalKey` outputs don't change. `ORIGINAL_KEY_VERSION` stays `1`.
- Guard 1, Guard 2, `sharedOriginals`, `planMatch`, the drain's subtitle rule, its target check (`olWorkKey` plus `sameWholeTitle`) and its code-only writes are unchanged. `manual` answers are never selected (`portugueseWorksNeedingMatch` is unchanged).
- No comments in code. No new test files. Every test file touched is already listed in `backend/package.json`.
- The worktree has no `node_modules`: run `npm run dev:link-deps` once before the first test run.
- Rebuild shared before any backend run: `npm run build --workspace @scripta/shared`.
- Run single test files from `backend/` with `npx tsx --test <file>`. Backend tests need the env preamble that each test file already sets.
- Verify per task with `node scripts/gate.mjs` before committing. Stage and commit in one command.

## Review Focus

- **Stale whole keys.** Every statement that writes `original_title` or `original_key` must write `original_whole_key` under the same condition. `rg -n "original_key" backend/src -g '!*.test.ts'` must show no writer without it.
- **The self-heal's index.** The old `idx_books_original_key_missing` must be dropped and the new one created with the exact `WHERE` of `UNKEYED_ORIGINALS_SQL`, or SQLite won't use it. The `EXPLAIN` test checks this.
- **Guard 1 exactness.** In the drain, `seriesLike` and `shared` are built from one stem's full claim list, and a work is planned only under the stem of its own evidence original.

---

### Task 1: Store and index the whole key

**Files:**
- Modify: `backend/src/modules/books/domain/translation.ts`
- Test: `backend/src/modules/books/domain/translation.test.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/books.sql`
- Modify: `backend/src/modules/books/adapters/sqlite/connection.ts`
- Modify: `backend/src/modules/books/domain/ports.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Test: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`
- Modify: `backend/src/modules/books/seed/summaryCleanup.ts`
- Test: `backend/src/modules/books/seed/summaryCleanup.test.ts`

**Interfaces:**
- Produces, from `domain/translation.ts`: `originalWholeKey(title: string): string | null`.
- Produces, on `BooksRepository`: `originalKeysOf(wholeKey: string): string[]`.
- Produces, from `sqliteBooksRepository.ts`: `export const ORIGINAL_KEYS_OF_WHOLE_SQL`.
- Changes, in `connection.ts`: `UNKEYED_ORIGINALS_SQL` also selects `original_key` and `original_whole_key`, and its `WHERE` becomes `original_title IS NOT NULL AND (original_key IS NULL OR original_whole_key IS NULL)`.

- [ ] **Step 1: Write the failing tests in `translation.test.ts`**

Import `originalWholeKey` alongside the existing imports. `catalogTitleKey` is already imported.

```ts
test("the whole original key keeps the parts after a full stop or a dash, and drops a colon part and brackets", () => {
  assert.deepEqual(
    ["Mr. Mercedes", "Les rois maudits. Le roi de fer", "The Trials of Apollo - The Dark Prophecy", "Dune: Messiah", "Le Petit Prince (illustré)", "Harry Potter 2", "()"].map(originalWholeKey),
    ["mr mercedes|", "les rois maudits le roi de fer|", "the trials of apollo the dark prophecy|", "dune|", "le petit prince|", "harry potter 2|2", null]
  );
});

test("an arriving title's arrival key is the whole key of the same title as an original", () => {
  for (const title of ["To the Lighthouse", "Mr. Mercedes", "Les rois maudits. Le roi de fer", "The Trials of Apollo - The Dark Prophecy", "Dune: Messiah", "Le Petit Prince (illustré)", "Harry Potter 2", "Catch-22"]) {
    assert.equal(arrivalKey(catalogTitleKey(title, "Some Author")!), originalWholeKey(title), title);
  }
});
```

In the pin test, rename it to `"the original keys are pinned: a change must bump ORIGINAL_KEY_VERSION so stored keys are recomputed"`. Keep its two assertions, and add before `assert.equal(ORIGINAL_KEY_VERSION, 1)`:

```ts
  assert.deepEqual(
    ["To the Lighthouse", "Dune: Messiah", "Les rois maudits. Le roi de fer", "Harry Potter 2", "Le Petit Prince (illustré)"].map(originalWholeKey),
    ["to the lighthouse|", "dune|", "les rois maudits le roi de fer|", "harry potter 2|2", "le petit prince|"],
    "originalWholeKey changed: bump ORIGINAL_KEY_VERSION so stored original_whole_key values are recomputed"
  );
```

- [ ] **Step 2: Run them and see them fail**

Run: `npm run build --workspace @scripta/shared && cd backend && npx tsx --test src/modules/books/domain/translation.test.ts`
Expected: FAIL, because `originalWholeKey` is not exported.

- [ ] **Step 3: Add `originalWholeKey` and define `originalKey` through it**

In `translation.ts`, replace `originalKey` with:

```ts
export function originalWholeKey(title: string): string | null {
  const normalized = normalizeTitle(title);
  return normalized === "" ? null : `${normalized}|${titleNumbers(title)}`;
}

export function originalKey(title: string): string | null {
  return originalWholeKey(stem(title));
}
```

Run Step 2's command again. Expected: PASS, including the unchanged `originalKey` pin and the `titlePattern`/`arrivalKey` equivalence test.

- [ ] **Step 4: Write the failing repository and cleanup tests**

In `sqliteBooksRepository.test.ts`, import `ORIGINAL_KEYS_OF_WHOLE_SQL` from `./sqliteBooksRepository.js`, and `originalWholeKey` from the translation module alongside `originalKey`.

- **`originalsOf`** also selects `original_whole_key`. Every existing `originalsOf` assertion gains it.
- **The writers test** ("every writer of an original title writes its key in the same statement") gives each writer path an original whose two keys differ, so a stem key written into the whole-key column fails it:
  - `filled` (`fillOriginalTitle`) stays "To the Lighthouse", with `original_whole_key: originalWholeKey("To the Lighthouse")`;
  - a new `stopped` book, "O Senhor Mercedes" by "Stephen King" (ISBN `9789720000115`), gets `fillOriginalTitle(stopped.id, "Mr. Mercedes")` and expects `{ original_title: "Mr. Mercedes", original_key: "mr|", original_whole_key: "mr mercedes|" }`;
  - `merged` (`saveDetails` → `mergeDetails`) becomes "O Rei de Ferro" by "Maurice Druon" with summary `"Uma sinopse longa o bastante.\n\nTítulo original: Les rois maudits. Le roi de fer"`, and expects `{ original_title: "Les rois maudits. Le roi de fer", original_key: "les rois maudits|", original_whole_key: "les rois maudits le roi de fer|" }`;
  - `kept` is unchanged, with `original_whole_key: "orlando|"`;
  - `labelled` (`fillOriginalTitlesFromSummaries`) becomes "O Telefone do Sr. Harrigan" by "Stephen King" with summary `"Um telefone.\n\nTítulo original: Mr. Harrigan's Phone"`, and expects `{ original_title: "Mr. Harrigan's Phone", original_key: "mr|", original_whole_key: "mr harrigan s phone|" }`.

- **New test, after "originalClaimsOf reads the claims of one original key by index":**

  ```ts
  test("originalKeysOf reads the stem keys of one whole key from its covering index", () => {
    const { db, repo } = freshRepo();
    repo.fillOriginalTitle(portuguese(repo, "O Senhor Mercedes", "Stephen King", "9789720000401").id, "Mr. Mercedes");
    repo.fillOriginalTitle(portuguese(repo, "Passeio ao Farol", "Virginia Woolf", "9789720000402").id, "To the Lighthouse");
    assert.deepEqual(repo.originalKeysOf("mr mercedes|"), ["mr|"]);
    assert.deepEqual(repo.originalKeysOf("to the lighthouse|"), ["to the lighthouse|"]);
    assert.deepEqual(repo.originalKeysOf("mr|"), []);
    const plan = (db.prepare(`EXPLAIN QUERY PLAN ${ORIGINAL_KEYS_OF_WHOLE_SQL}`).all("mr mercedes|") as Array<{ detail: string }>).map((row) => row.detail).join(" ");
    assert.match(plan, /COVERING INDEX idx_books_original_whole_key/);
  });
  ```

- **The Guard 1 parity test** ("the series rule built from one key's claims answers like the one built from every claim"):
  - Before `db.exec("DELETE FROM original_key_version")`, add three Druon volumes by `"Maurice Druon"`:
    - `"O Rei de Ferro"` (ISBN `9789720000501`), original `"Les rois maudits. Le roi de fer"`;
    - `"A Rainha Estrangulada"` (`9789720000502`), original `"Les rois maudits. La reine étranglée"`;
    - `"Os Venenos da Coroa"` (`9789720000503`), original `"Les rois maudits. Les poisons de la couronne"`.
  - Add `["Les rois maudits. Le roi de fer", "Maurice Druon"]` to `cases`.
  - In the loop, keep the existing assertion and add the drain's path:

    ```ts
    const found = repo.originalKeysOf(originalWholeKey(original)!).flatMap((stem) => repo.originalClaimsOf(stem));
    assert.equal(seriesLikeOriginals(found)(original, author), everything(original, author), `whole ${original} / ${author}`);
    ```

  - Add `assert.equal(everything("Les rois maudits. Le roi de fer", "Maurice Druon"), true)`.
- **The version test** ("the original keys are stored once, recomputed when the version changes, and cleared with their title"):
  - Before dropping `original_key`, also drop `idx_books_original_whole_key` and `idx_books_original_keys_missing` (instead of `idx_books_original_key_missing`). Then drop the `original_whole_key` column.
  - After the first `applyBooksMigrations`, assert `idx_books_original_whole_key` exists.
  - `originalsOf(db, "labelled")` after the first run expects `original_whole_key: "orlando|"`.
  - The tamper step sets both keys: `UPDATE books SET original_key = 'x', original_whole_key = 'x' WHERE id = 'keyed'`. After the plain boot both are still `"x"`: the self-heal only fills missing keys.
  - After the version-0 run, `keyed` has both keys recomputed (`originalKey("To the Lighthouse")` and `originalWholeKey("To the Lighthouse")`), and `labelled` has `original_whole_key` `null`. That pins the version backfill rewriting a whole key that is already set.
- **The self-heal test** ("a title stored without its key is keyed at the next boot, found through its own index"):
  - Add a rollback row: `rawBook(db, "rolled", "O Senhor Mercedes", "Mr. Mercedes", null)`, then `db.prepare("UPDATE books SET original_key = 'mr|', original_whole_key = NULL WHERE id = 'rolled'").run()`.
  - Simulate an older build's index: `db.exec("CREATE INDEX idx_books_original_key_missing ON books(id) WHERE original_title IS NOT NULL AND original_key IS NULL")`.
  - After `applyBooksMigrations(db)`:
    - assert `rolled` has `original_whole_key` `"mr mercedes|"`, and `original_key` still `"mr|"`;
    - assert `stray` has `original_whole_key` `originalWholeKey("To the Lighthouse")`;
    - assert `blank` has `original_whole_key` `null`;
    - assert `idx_books_original_key_missing` no longer exists in `sqlite_master`.
  - The `EXPLAIN` assertion matches `/idx_books_original_keys_missing/`.

In `summaryCleanup.test.ts`, import `originalWholeKey` next to `originalKey`.
- In `TAIL`, change `Título Original The Island` to `Título Original Mr. Mercedes`. "The Island" appears nowhere else in the file.
- The `dirty` assertions expect `original_title: "Mr. Mercedes"` and `original_key` `"mr|"`.
- Add an assertion that `dirty`'s `original_whole_key` is `"mr mercedes|"`.

- [ ] **Step 5: Run them and see them fail**

Run: `cd backend && npx tsx --test src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts src/modules/books/seed/summaryCleanup.test.ts`
Expected: FAIL. There is no `original_whole_key` column, no `originalKeysOf` and no `ORIGINAL_KEYS_OF_WHOLE_SQL`.

- [ ] **Step 6: Implement storage, writers, the self-heal and the lookup**

- **`books.sql`:** add `original_whole_key  TEXT,` after `original_key        TEXT,`.
- **`connection.ts`:**
  - Import `originalWholeKey` alongside `originalKey`.
  - `UNKEYED_ORIGINALS_SQL` becomes `"SELECT id, original_title, original_key, original_whole_key FROM books WHERE original_title IS NOT NULL AND (original_key IS NULL OR original_whole_key IS NULL)"`.
  - In `applyBooksMigrations`'s column list, after the `retitle_wanted_at` line, add `if (!columns.some((column) => column.name === "original_whole_key")) db.exec("ALTER TABLE books ADD COLUMN original_whole_key TEXT");`, like the other added columns.
  - In the version block:
    - the `SELECT` also reads `original_whole_key`, and adds `OR original_whole_key IS NOT NULL` to its `WHERE`;
    - `whole = title === null ? null : originalWholeKey(title)`;
    - a row is skipped only when the title and both keys are unchanged;
    - the update is `UPDATE books SET original_title = ?, original_key = ?, original_whole_key = ? WHERE id = ?`;
    - it counts `keyed` when `key !== null || whole !== null`.
  - Replace the two index lines after the version block with:

    ```ts
    db.exec("CREATE INDEX IF NOT EXISTS idx_books_original_key ON books(original_key) WHERE original_key IS NOT NULL");
    db.exec("CREATE INDEX IF NOT EXISTS idx_books_original_whole_key ON books(original_whole_key, original_key) WHERE original_whole_key IS NOT NULL");
    db.exec("DROP INDEX IF EXISTS idx_books_original_key_missing");
    db.exec("CREATE INDEX IF NOT EXISTS idx_books_original_keys_missing ON books(id) WHERE original_title IS NOT NULL AND (original_key IS NULL OR original_whole_key IS NULL)");
    ```

  - **The self-heal** reads the four columns. For each row it computes `key = originalKey(title)` and `whole = originalWholeKey(title)`, and keeps the row only when `key !== row.original_key || whole !== row.original_whole_key`. It writes `UPDATE books SET original_key = ?, original_whole_key = ? WHERE id = ?` in the existing transaction, and adds the number of rows written to `keyed`.
- **`ports.ts`:** add `originalKeysOf(wholeKey: string): string[];` after `originalClaimsOf`.
- **`sqliteBooksRepository.ts`:**
  - Import `originalWholeKey`.
  - Export `ORIGINAL_KEYS_OF_WHOLE_SQL` after `ORIGINAL_CLAIMS_SQL`:

    ```ts
    export const ORIGINAL_KEYS_OF_WHOLE_SQL = `
      SELECT DISTINCT original_key FROM books WHERE original_whole_key = ? AND original_key IS NOT NULL
    `;
    ```

  - Prepare it next to `originalClaimsOfStmt`, and add the repository method `originalKeysOf(wholeKey)`. It returns the `original_key` of each row.
  - `fillOriginalTitleStmt` becomes `UPDATE books SET original_title = ?, original_key = ?, original_whole_key = ? WHERE id = ? AND original_title IS NULL`. Both callers pass `originalWholeKey(title)` after `originalKey(title)`.
  - In `mergeDetailsStmt`, after the `original_key` line, add `original_whole_key = CASE WHEN ${takesSummary} AND original_title IS NULL THEN $original_whole_key ELSE original_whole_key END,`. The caller passes `$original_whole_key: originalTitle === null ? null : originalWholeKey(originalTitle)`.
- **`summaryCleanup.ts`:**
  - Import `originalWholeKey`.
  - In `updateBook`, after the `original_key` assignment, add `original_whole_key = CASE WHEN original_title IS NULL THEN ? ELSE original_whole_key END`.
  - Pass `change.originalTitle === null ? null : originalWholeKey(change.originalTitle)` as the parameter right after the `original_key` one.

- [ ] **Step 7: Run the affected tests and see them pass**

Run: `cd backend && npx tsx --test src/modules/books/domain/translation.test.ts src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts src/modules/books/seed/summaryCleanup.test.ts src/modules/books/originalArrivals.test.ts`
Expected: PASS.

Run: `rg -n "original_key" backend/src -g '!*.test.ts'`
Expected: every `UPDATE` that sets `original_key` also sets `original_whole_key`.

- [ ] **Step 8: Verify and commit**

Run: `node scripts/gate.mjs`
Expected: every Verify command for `backend/` passes.

```bash
git add backend/src/modules/books/domain/translation.ts backend/src/modules/books/domain/translation.test.ts backend/src/modules/books/adapters/sqlite/books.sql backend/src/modules/books/adapters/sqlite/connection.ts backend/src/modules/books/domain/ports.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts backend/src/modules/books/seed/summaryCleanup.ts backend/src/modules/books/seed/summaryCleanup.test.ts && git commit -m "Store each original title's whole key beside its stem key"
```

---

### Task 2: The drain finds claimants by both keys

**Files:**
- Modify: `backend/src/modules/books/originalArrivals.ts`
- Test: `backend/src/modules/books/originalArrivals.test.ts`
- Modify: `backend/README.md`

**Interfaces:**
- Consumes: `originalWholeKey` and `repo.originalKeysOf` from Task 1.
- `joinArrivedOriginals` and `startOriginalArrivals` keep their signatures and their returned counts.

- [ ] **Step 1: Write the failing tests in `originalArrivals.test.ts`**

Add a helper after `drain`:

```ts
function drainReading(repo: Repo) {
  const read: string[] = [];
  const reading = { ...repo, translationEvidence: (workId: string) => (read.push(workId), repo.translationEvidence(workId)) };
  return { steps: joinArrivedOriginals({ repo: reading, sharesArena: () => false, now: () => NOW }, 500, rethrow), read };
}
```

Add these tests after "an original with a part after a full stop is not joined by the title before it":

```ts
test("an original with a full stop joins when it arrives under its whole title", () => {
  const repo = freshRepo();
  const pt = claimant(repo, "9789720000811", "O Senhor Mercedes", "Stephen King", "Mr. Mercedes");
  emptyQueue(repo);
  const en = book(repo, "9781501125607", "Mr. Mercedes", "Stephen King", { workKey: "OL17073965W" });
  assert.deepEqual(drain(repo), { arrivals: 1, claimants: 1, codeMerges: 1, codeBlocked: 0 });
  assert.equal(repo.canonicalWorkIds([pt.work_id!]).get(pt.work_id!), en.work_id);
  assert.deepEqual(repo.workMatchJudgments([pt.work_id!]).get(pt.work_id!), { model: "code", intoWorkId: en.work_id, confidence: null, askedAt: AT });
});

test("another original under the same full-stop stem is never read, and the two count as one shared original", () => {
  const repo = freshRepo();
  const mercedes = claimant(repo, "9789720000812", "O Senhor Mercedes", "Stephen King", "Mr. Mercedes");
  const harrigan = claimant(repo, "9789720000813", "O Telefone do Sr. Harrigan", "Stephen King", "Mr. Harrigan's Phone");
  emptyQueue(repo);
  book(repo, "9781501125607", "Mr. Mercedes", "Stephen King", { workKey: "OL17073965W" });
  const { steps, read } = drainReading(repo);
  assert.deepEqual(steps, { arrivals: 1, claimants: 0, codeMerges: 0, codeBlocked: 0 });
  assert.deepEqual(read, [mercedes.work_id]);
  assert.equal(repo.workMatchJudgments([mercedes.work_id!, harrigan.work_id!]).size, 0);
});

test("an original with a dash part is found when it arrives whole but stays skipped as a subtitle original", () => {
  const repo = freshRepo();
  const pt = claimant(repo, "9789720000814", "A Profecia Sombria", "Rick Riordan", "The Trials of Apollo - The Dark Prophecy");
  emptyQueue(repo);
  book(repo, "9781484746424", "The Trials of Apollo - The Dark Prophecy", "Rick Riordan", { workKey: "OL19345722W" });
  const { steps, read } = drainReading(repo);
  assert.deepEqual(steps, { arrivals: 1, claimants: 0, codeMerges: 0, codeBlocked: 0 });
  assert.deepEqual(read, [pt.work_id]);
  assert.equal(repo.workMatchJudgments([pt.work_id!]).size, 0);
});
```

The existing Druon test ("an original with a part after a full stop is not joined by the title before it") stays unchanged.

- [ ] **Step 2: Run them and see them fail**

Run: `cd backend && npx tsx --test src/modules/books/originalArrivals.test.ts`
Expected: FAIL. The first test gets `claimants: 0` and no join, and the other two read nothing.

- [ ] **Step 3: Implement the two-key lookup**

In `originalArrivals.ts`, import `originalWholeKey`. `joinClaimants` takes the stem:

```ts
function joinClaimants(deps: ArrivalDeps, key: string, stem: string, surname: string, claims: OriginalClaim[], steps: ArrivalSteps) {
  const arrived = (original: string) => originalKey(original) === key || originalWholeKey(original) === key;
  const seriesLike = seriesLikeOriginals(claims);
  const shared = sharedOriginals(claims);
  const at = new Date(deps.now()).toISOString();
  const named = claims.flatMap((claim) => (claim.workId && arrived(claim.originalTitle) && mentionsSurname([claim.author], surname) ? [claim.workId] : []));
```

The rest of its body is unchanged except the skip line, which becomes:

```ts
    if (!original || originalKey(original) !== stem || !arrived(original) || normalizeWords(original) !== normalizeTitle(mainTitle(original)) || shared(original, author)) continue;
```

In `drainKey`, replace the two claim lines inside `if (key !== null && surname !== null)` with:

```ts
      for (const stem of new Set([key, ...deps.repo.originalKeysOf(key)])) {
        const claims = deps.repo.originalClaimsOf(stem);
        if (claims.length > 0) joinClaimants(deps, key, stem, surname, claims, drained);
      }
```

- [ ] **Step 4: Run the drain tests and see them pass**

Run: `cd backend && npx tsx --test src/modules/books/originalArrivals.test.ts`
Expected: PASS, every existing test included.

- [ ] **Step 5: Update `backend/README.md`**

In the arrivals paragraph (it starts "Every new or changed title key, and a book's first Open Library work key, is queued by a trigger"):
- Replace the sentence that starts "An original with a full stop ("Mr. Mercedes") is joined by the fill and the backlog, not on its own arrival" and ends "carries the whole title." with: claimants are found by their original's stem key and by its whole key, so an arriving "Mr. Mercedes" reaches the works whose original is "Mr. Mercedes" though they are stored under the stem `mr|`. Guard 1 and the shared rule still read every claim of that stem, so two originals by one author that share the part before a full stop ("Mr. Mercedes", "Mr. Harrigan's Phone") count as one shared original and neither is joined on arrival. An original with a dash part is found the same way but is still skipped as a subtitle original.
- In its last sentence, "keys stored original titles that lack a key" becomes "keys stored original titles that lack either key".

- [ ] **Step 6: Verify and commit**

Run: `node scripts/gate.mjs`
Expected: every Verify command for `backend/` passes.

```bash
git add backend/src/modules/books/originalArrivals.ts backend/src/modules/books/originalArrivals.test.ts backend/README.md && git commit -m "Find arriving originals' claimants by their whole key too"
```
