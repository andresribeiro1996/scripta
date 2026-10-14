# Reader Card Genre Floor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let genre-based reader identities count once 20 finished books have known genres, even when that is under half the library, so large imports with thin genre data (Marta: 25 of 107) stop being stuck on an unwritten card.

**Architecture:** One rule change in `readerIdentity` (`@scripta/shared`), which the backend, web and mobile all call. A `LIBRARY_ROWS_VERSION` bump makes the backend's startup backfill recompute every stored `library_summary.reader_card` and `library_derived.glyph` once.

**Tech Stack:** TypeScript, `node:test` via tsx, Fastify backend with SQLite.

**Spec:** `docs/superpowers/specs/2026-09-26-my-shelf-release-2-design.md` (the "Genres come from…" bullet under the signal table). This plan amends that one rule; the change is agreed in conversation on 2026-10-14.

## Background (why)

Production check on 2026-10-14: Marta's StoryGraph library has 107 finished books, 25 with genres. Of the 82 others, all are linked to catalog works but only 2 works have genres, because ISBNdb and Open Library have no subjects for most Portuguese editions. The gate `known.length * 2 >= n` needs 54, so every genre signal is skipped and the card is `unwritten` with "Genres known for 25 of 107 books". Better genre data is a separate, larger project.

## Global Constraints

- Gate: genre signals and the Wayfarer count when `known.length * 2 >= n` **or** `known.length >= 20`. The half rule stays, so libraries under 40 finished books behave exactly as today.
- The unwritten `missing` text must use the same gate: "Genres known for N of M books" only when the gate is closed; otherwise "No reading pattern stands out yet".
- No code comments (root `AGENTS.md`). The why goes in the commit message.
- Shared consumers read `dist/`: run `npm run build --workspace @scripta/shared` before backend typecheck/tests.

## Review Focus

- Library just under the floor and under half (19 of 60 known): must stay unwritten with "Genres known for 19 of 60 books". Pinned in Task 1.
- Library past the floor with no clear pattern (25 of 60 known, spread thin): must say "No reading pattern stands out yet", not the genre-coverage message. Pinned in Task 1.
- Small library under half (4 of 10 known): unchanged, still gated. Already pinned by the existing test "genre signals wait until genres are known for half the finished books".
- Existing stored cards and glyphs in production must change without the user re-saving. Covered by the existing test "raising the rows version rebuilds every account…" in `backend/src/modules/library/service.test.ts` plus the post-deploy check below.
- A user's own card on mobile is computed on the device from shared code, so it only changes after an OTA. Covered by the deploy notes, not a test.

---

### Task 1: Genre floor in `readerIdentity`

**Files:**
- Modify: `packages/shared/src/library/readerIdentity.ts` (constants near line 30, gate at line 129, fallback at line 162)
- Test: `packages/shared/src/library/readerIdentity.test.ts` (add after the test "genre signals wait until genres are known for half the finished books", line 66)
- Modify: `docs/superpowers/specs/2026-09-26-my-shelf-release-2-design.md:63`

**Interfaces:**
- Consumes: nothing new.
- Produces: `readerIdentity(books, groups)` keeps its signature and return type; only the gate changes.

- [ ] **Step 1: Write the failing tests**

Add after the test at line 66. The file's `shelf(count, fields)` helper gives each book a unique title and author, so the series, highlights and loyal-author signals all stay at 0.

```ts
test("genre signals count once 20 finished books have known genres, even under half", () => {
  const books = shelf(60, (i) => (i < 10 ? { _genres: ["History"] } : i < 20 ? { _genres: ["Romance"] } : {}));
  const result = readerIdentity(books, []);
  assert.equal(result.state, "settled");
  assert.equal(result.identity, "arch");
  assert.equal(result.missing, null);
  assert.deepEqual(result.coverage, ["genres known for 20 of 60 finished books"]);
});

test("one book under the genre floor and under half stays unwritten", () => {
  const books = shelf(60, (i) => (i < 10 ? { _genres: ["History"] } : i < 19 ? { _genres: ["Romance"] } : {}));
  const result = readerIdentity(books, []);
  assert.equal(result.state, "unwritten");
  assert.equal(result.missing, "Genres known for 19 of 60 books");
});

test("past the genre floor with no clear pattern says no pattern, not genre coverage", () => {
  const books = shelf(60, (i) => (i < 13 ? { _genres: ["Romance"] } : i < 25 ? { _genres: ["Psychology"] } : {}));
  const result = readerIdentity(books, []);
  assert.equal(result.state, "unwritten");
  assert.equal(result.missing, "No reading pattern stands out yet");
});
```

Expected values: the first test gives Architect 10 of 20 known = 50%, strength 0.5 / 0.35 ≈ 1.43, which clears. The Wayfarer is at 2 genres / 6 ≈ 0.33, so it is not a streak. The third test leaves every genre signal at 0, and the Wayfarer at 0.33 stays below 0.75.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/shared && node --import tsx --test src/library/readerIdentity.test.ts`
Expected: the first and third new tests FAIL. The first gets `state` `"unwritten"`. The third gets `missing` `"Genres known for 25 of 60 books"`. The second new test passes already.

- [ ] **Step 3: Implement the gate**

In `packages/shared/src/library/readerIdentity.ts`, next to `const MIN_BOOKS = 5;`:

```ts
const MIN_GENRE_BOOKS = 20;
```

Just before the `if (known.length * 2 >= n) {` line (line 129), add:

```ts
  const genresKnown = known.length * 2 >= n || known.length >= MIN_GENRE_BOOKS;
```

and change that line to:

```ts
  if (genresKnown) {
```

Change the fallback (line 162) from:

```ts
    return unwritten(known.length * 2 < n ? `Genres known for ${known.length} of ${n} books` : "No reading pattern stands out yet");
```

to:

```ts
    return unwritten(genresKnown ? "No reading pattern stands out yet" : `Genres known for ${known.length} of ${n} books`);
```

- [ ] **Step 4: Run the whole shared suite and build**

Run: `npm test --workspace @scripta/shared && npm run build --workspace @scripta/shared`
Expected: all tests PASS, including the existing "genre signals wait until genres are known for half the finished books" (4 of 10 known), and the build succeeds.

- [ ] **Step 5: Amend the spec**

In `docs/superpowers/specs/2026-09-26-my-shelf-release-2-design.md` line 63, replace:

```
The four genre signals and the Wayfarer count only when genres are known for at least half of the finished books.
```

with:

```
The four genre signals and the Wayfarer count only when genres are known for at least half of the finished books, or for at least 20 of them (amended 2026-10-14: large imports whose editions have no genre data were stuck unwritten).
```

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/library/readerIdentity.ts packages/shared/src/library/readerIdentity.test.ts docs/superpowers/specs/2026-09-26-my-shelf-release-2-design.md && git commit -m "$(cat <<'EOF'
Count genre signals once 20 finished books have genres

A large import whose editions have no genre data never reached the
half-the-library gate: a StoryGraph library with 25 of 107 genres known
stayed unwritten even though those 25 point clearly at one identity.
The half rule stays, so libraries under 40 finished books are unchanged.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

### Task 2: Recompute stored cards on deploy

**Files:**
- Modify: `backend/src/modules/library/domain/constants.ts:2`

**Interfaces:**
- Consumes: Task 1's rebuilt `@scripta/shared` `dist/`.
- Produces: `LIBRARY_ROWS_VERSION = 3`. At the next boot, `backfillLibraryDerived` (`backend/src/modules/library/migration.ts`, run from `runStartupMigrations.ts`) finds every account stale and rewrites `library_summary.reader_card` (`setRows`) and `library_derived.glyph` (`setDerived`).

- [ ] **Step 1: Bump the version**

`backend/src/modules/library/domain/constants.ts`:

```ts
export const LIBRARY_ROWS_VERSION = 3;
```

`backend/README.md` already requires this bump when `deriveLibraryRows` output changes. The reader card is part of that output, through `readerCardOf`. The tests read the constant, and none hard-codes 2 (checked: the `rows_version` literals in `quizzes`, `tierlists` and `murals` tests are 1, an unrelated fixture value).

- [ ] **Step 2: Typecheck and test the backend**

Run: `npm run build --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend`
Expected: PASS. The relevant existing tests are "raising the rows version rebuilds every account and rewrites every book row, and the same version rebuilds nothing" and the `publicViews.test.ts` / `murals/home.test.ts` coverage-string assertions. Neither of those fixtures reaches 20 known genres, so their expected cards don't change.

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/library/domain/constants.ts && git commit -m "$(cat <<'EOF'
Rebuild stored reader cards for the genre floor

Bumps LIBRARY_ROWS_VERSION so the startup backfill recomputes every
account's stored reader card and glyph once with the new genre gate;
small saves never refresh them.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

## After merge (user-triggered deploy)

Merged ≠ live. Production moves only by `gh workflow run deploy.yml -f sha=<main tip>`, and only when the user asks.

- **Backend:** the first boot after deploy re-derives every library once. The previous bump (`76d494a9`) did the same.
- **Mobile:** a user's own card is computed on the device. EAS CI is out of minutes until 11-01, so the OTA is published by hand from `mobile/` after building `@scripta/shared`:
  `EXPO_PUBLIC_API_URL=https://api.atmyshelf.com npx eas-cli update --channel production --platform android --environment production`
- **Check:** the user re-runs the scratchpad `marta-card.mjs` command. Expect `stored.state` and `fresh.state` to no longer be `unwritten`, and `glyph.glyph` to be set if the card is settled. Arch is likely but not verified: her 25 known books are mostly history, biography and politics.
