# Original Title Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `originalTitleIn` returning `":"` or another label as an original title. Clear the values it already stored.

**Architecture:** One predicate, `isOriginalTitle`, in `domain/translation.ts`. Three places use it:
- the parser, `originalTitleIn`;
- the `fillOriginalTitle` write path;
- a once-only boot migration at `user_version` 5 that sets failing stored values to `NULL`.

**Tech Stack:** Fastify/TypeScript backend, SQLite (`node:sqlite`), `@scripta/shared` (from `dist`), `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-21-original-title-labels-design.md`

## Global Constraints

- **No comments in code** (root `AGENTS.md`).
- **Before backend typecheck or tests,** run `npm run build --workspace @scripta/shared`.
- **Reuse:**
  - `STRICT_METADATA_LABEL` and `LOOSE_METADATA_LABEL` from `@scripta/shared`. Don't add a new label list.
  - The `turnIsbndbFirstAuthors` migration shape and its tests (`connection.ts:242-262`, `sqliteBooksRepository.test.ts:1789-1865`).
- **Commits end with** `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- **The parser still reads a value on the line after a bare label** (`"Título original\n\nThe Hobbit"` → `"The Hobbit"`). Only a value that fails `isOriginalTitle` gives `null`.
- **Letters are checked with Unicode classes.** A Cyrillic or digit-only title passes.
- **The migration is gated on `user_version < 5`.** It sets the version inside the same transaction, and a later boot leaves rows alone.

### Task 1: Reject non-title values, guard the writer, repair stored rows

**Files:**
- Modify: `backend/src/modules/books/domain/translation.ts`
- Test: `backend/src/modules/books/domain/translation.test.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/connection.ts`
- Test: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`

- [ ] **Step 1: Failing parser tests.** Extend the `originalTitleIn` test in `translation.test.ts`, or add one beside it.
  - `originalTitleIn("Uma sinopse.\n\nTítulo original:")` → `null`. Today it is `":"`.
  - `originalTitleIn("Título original:\nTradução: Ana Lima")` → `null`.
  - `originalTitleIn("Título original:\nPáginas: 300")` → `null`.
  - `originalTitleIn("Título original —")` → `null`.
  - `originalTitleIn("Título original\n\nThe Hobbit")` → `"The Hobbit"`. This is the `<dt>/<dd>` layout and is kept.
  - `originalTitleIn("Título original: 1984")` → `"1984"`.
  - `originalTitleIn("Título original: Солярис")` → `"Солярис"`.

  Add an `isOriginalTitle` test:
  - false for `":"`, `""`, `"—"`, `"Tradução: Ana Lima"`, `"Tradução - Ana Lima"`, `"ISBN: 978…"`, `"Ano: 2019"`;
  - true for `"Solaris"`, `"1984"`, `"Солярис"`, `"Sapiens: A Brief History of Humankind"`, `"Data-Driven Science"`.

  Run it and confirm the new cases fail for the expected reason.
- [ ] **Step 2: Implement in `translation.ts`.**
  - `export function isOriginalTitle(value: string): boolean`. It needs a letter or digit (`/[\p{L}\p{N}]/u`). It must not match `^(?:STRICT|LOOSE)(?:\s*:|\s+[-–—])`, case-insensitive, built from the shared constants. A dash counts as a separator only after whitespace, so `"Data-Driven Science"` is still a title.
  - `originalTitleIn` returns the trimmed value only when `isOriginalTitle(value)` holds and the length is at most 200. The existing `value !== ""` check becomes redundant.
  - Run the tests: green.
- [ ] **Step 3: Failing repository tests** in `sqliteBooksRepository.test.ts`.
  - **`fillOriginalTitle` writes no non-title.** `repo.fillOriginalTitle(id, ":")` leaves `original_title` `NULL`. A later `repo.fillOriginalTitle(id, "Solaris")` stores `"Solaris"`.
  - **The migration clears only non-titles.**
    - Set `PRAGMA user_version = 4`.
    - With raw SQL, set `original_title` on separate books to `':'`, `''`, `'—'`, `'Tradução: Ana Lima'`, `'Solaris'`, `'1984'` and `'Солярис'`.
    - Run `applyBooksMigrations(db)`.
    - The first four are `NULL`, the last three are unchanged, and `user_version` is 5.
  - **The migration runs once.** After it runs, a raw-SQL `':'` written to another row survives a second `applyBooksMigrations`.
  - **Old version checks move to 5.** Update the existing assertions that expect `user_version` 4 after a full `applyBooksMigrations` (around lines 1438, 1803, 1837, 1862) to 5. Leave the part-way test's `[3, …]` alone.
- [ ] **Step 4: Implement.**
  - In `sqliteBooksRepository.ts`, `fillOriginalTitle` runs the statement only when `isOriginalTitle(title)` holds.
  - In `connection.ts`, add a migration after `turnIsbndbFirstAuthors` in `applyBooksMigrations`:
    - It returns when `user_version >= 5`.
    - It selects `id, original_title FROM books WHERE original_title IS NOT NULL`.
    - Inside `BEGIN IMMEDIATE`, it sets `original_title = NULL` for each id whose value fails `isOriginalTitle`. It then sets `PRAGMA user_version = 5` and commits. On error it rolls back and rethrows, as `indexConfirmedBooks` does.
    - When the count is above 0: `console.log(\`books: cleared ${n} original titles that were not titles\`)`.
- [ ] **Step 5: Verify.** Run `npm run build --workspace @scripta/shared`, `npm run typecheck --workspace backend` and `npm test --workspace backend`. Then `node scripts/gate.mjs`.
- [ ] **Step 6: Commit.** The commit message gives two reasons:
  - why the parser still crosses a newline: `<dt>/<dd>` layouts;
  - why the writer is guarded: the WooCommerce attribute and BNP paths would re-store what the repair clears.
