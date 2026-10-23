# Original Arrivals Subtitle Originals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The original-arrivals drain plans Portuguese claimants whose original has a colon, dash or bracketed part, instead of skipping them. The whole-title rule already in `planMatch` and the drain's target check decides the join.

**Architecture:** Delete one condition from the drain's per-work skip in `backend/src/modules/books/originalArrivals.ts`, along with the imports only it used. Flip the two tests that pinned the skip, and add tests for a main-title arrival, a dash series pair, a dash edition note and a bracketed note. Update the drain paragraph in `backend/README.md`.

**Tech Stack:** TypeScript, Fastify backend, `node:sqlite`, `node:test` via `tsx --test`, `@scripta/shared`.

**Spec:** `docs/superpowers/specs/2026-10-23-original-arrivals-subtitle-originals-design.md`

## Global Constraints

- Guard 1, Guard 2, `sharedOriginals`, `planMatch`, `mainTitle`, `sameMainTitle`, `originalKey`, `originalWholeKey` and `portugueseWorksNeedingMatch` are unchanged. `ORIGINAL_KEY_VERSION` stays `1`.
- The drain's other skips stay exactly as they are: `!original`, `originalKey(original) !== stem`, `!arrived(original)` and `shared(original, author)`. So do its target check (`olWorkKey` plus `sameWholeTitle`) and its code-only writes.
- The `fetch-originals` fill (`seed/originalsFill.ts`) keeps its own `subtitle` skip. Don't touch it.
- No comments in code. No new test files; `originalArrivals.test.ts` is already listed in `backend/package.json`.
- The worktree may have no `node_modules`: run `npm run dev:link-deps` once from the worktree root before the first test run.
- Rebuild shared before any backend run: `npm run build --workspace @scripta/shared`.
- Run the test file from `backend/` with `npx tsx --test src/modules/books/originalArrivals.test.ts`.
- Verify with `node scripts/gate.mjs` before committing. Stage and commit in one command.
- No production counts or titles in code, docs or commit messages.

## Review Focus

- **Main-title arrivals.** A "Dune" arrival must not join a "Dune: Messiah" claimant into the "Dune" work: it is planned and not joined. Pinned by "an original with a colon subtitle is not joined by its main title".
- **Dash series.** Guard 1 counts "Série - Volume" Portuguese titles as one title. So two volumes under one dash series stem rely on the shared rule, and neither joins. Pinned by "two volumes under one dash series stem are not joined when one arrives whole", which passes before and after the change.
- **Edition notes in originals.** "The Hobbit - Illustrated Edition" must not join an arriving "The Hobbit". Pinned by "an original with an edition note after a dash is not joined by the plain title".
- **Unused imports.** After the deletion, `normalizeTitle`, `normalizeWords` and `mainTitle` have no use left in `originalArrivals.ts`. The backend has no lint step and no `noUnusedLocals`, so nothing catches leftovers: Step 3 removes them, and the reviewer reads the file's import lines.

---

### Task 1: Plan subtitle originals in the arrivals drain

**Files:**
- Modify: `backend/src/modules/books/originalArrivals.ts`
- Test: `backend/src/modules/books/originalArrivals.test.ts`
- Modify: `backend/README.md`

**Interfaces:**
- Consumes: `joinArrivedOriginals(deps, limit, onKeyError)` and its `{ arrivals, claimants, codeMerges, codeBlocked }` result, unchanged. Also the test file's existing helpers `freshRepo`, `claimant`, `book`, `emptyQueue` and `drain`.
- Produces: nothing new. The drain's exported signatures don't change.

- [ ] **Step 1: Change and add the tests in `originalArrivals.test.ts`**

Replace the test "an original with a subtitle part is not joined by its main title" with these two tests:

```ts
test("an original with a colon subtitle joins when it arrives under its whole title", () => {
  const repo = freshRepo();
  const pt = claimant(repo, "9789720000801", "O Messias de Dune", "Frank Herbert", "Dune: Messiah");
  emptyQueue(repo);
  const en = book(repo, "9780441172696", "Dune: Messiah", "Frank Herbert", { workKey: "OL893415W" });
  assert.deepEqual(drain(repo), { arrivals: 1, claimants: 1, codeMerges: 1, codeBlocked: 0 });
  assert.equal(repo.canonicalWorkIds([pt.work_id!]).get(pt.work_id!), en.work_id);
});

test("an original with a colon subtitle is not joined by its main title", () => {
  const repo = freshRepo();
  const pt = claimant(repo, "9789720000801", "O Messias de Dune", "Frank Herbert", "Dune: Messiah");
  emptyQueue(repo);
  book(repo, "9780441172691", "Dune", "Frank Herbert", { workKey: "OL893416W" });
  assert.deepEqual(drain(repo), { arrivals: 1, claimants: 1, codeMerges: 0, codeBlocked: 0 });
  assert.equal(repo.workMatchJudgments([pt.work_id!]).size, 0);
  assert.equal(repo.canonicalWorkIds([pt.work_id!]).get(pt.work_id!), pt.work_id);
});
```

Replace the test "an original with a dash part is found when it arrives whole but stays skipped as a subtitle original" with these four tests:

```ts
test("an original with a dash part joins when it arrives under its whole title", () => {
  const repo = freshRepo();
  const pt = claimant(repo, "9789720000814", "A Profecia Sombria", "Rick Riordan", "The Trials of Apollo - The Dark Prophecy");
  emptyQueue(repo);
  const en = book(repo, "9781484746424", "The Trials of Apollo - The Dark Prophecy", "Rick Riordan", { workKey: "OL19345722W" });
  assert.deepEqual(drain(repo), { arrivals: 1, claimants: 1, codeMerges: 1, codeBlocked: 0 });
  assert.equal(repo.canonicalWorkIds([pt.work_id!]).get(pt.work_id!), en.work_id);
});

test("two volumes under one dash series stem are not joined when one arrives whole", () => {
  const repo = freshRepo();
  const prophecy = claimant(repo, "9789720000814", "A Profecia Sombria", "Rick Riordan", "The Trials of Apollo - The Dark Prophecy");
  const oracle = claimant(repo, "9789720000818", "O Oráculo Oculto", "Rick Riordan", "The Trials of Apollo - The Hidden Oracle");
  emptyQueue(repo);
  book(repo, "9781484746424", "The Trials of Apollo - The Dark Prophecy", "Rick Riordan", { workKey: "OL19345722W" });
  assert.deepEqual(drain(repo), { arrivals: 1, claimants: 0, codeMerges: 0, codeBlocked: 0 });
  assert.equal(repo.workMatchJudgments([prophecy.work_id!, oracle.work_id!]).size, 0);
});

test("an original with an edition note after a dash is not joined by the plain title", () => {
  const repo = freshRepo();
  const pt = claimant(repo, "9789720000819", "O Hobbit", "J. R. R. Tolkien", "The Hobbit - Illustrated Edition");
  emptyQueue(repo);
  book(repo, "9780261102217", "The Hobbit", "J. R. R. Tolkien", { workKey: "OL262758W" });
  assert.deepEqual(drain(repo), { arrivals: 1, claimants: 1, codeMerges: 0, codeBlocked: 0 });
  assert.equal(repo.workMatchJudgments([pt.work_id!]).size, 0);
});

test("an original with a bracketed note joins when the title without it arrives", () => {
  const repo = freshRepo();
  const pt = claimant(repo, "9789720000820", "O Principezinho", "Antoine de Saint-Exupéry", "Le Petit Prince (Édition illustrée)");
  emptyQueue(repo);
  const fr = book(repo, "9782070612758", "Le Petit Prince", "Antoine de Saint-Exupéry", { workKey: "OL24379W" });
  assert.deepEqual(drain(repo), { arrivals: 1, claimants: 1, codeMerges: 1, codeBlocked: 0 });
  assert.equal(repo.canonicalWorkIds([pt.work_id!]).get(pt.work_id!), fr.work_id);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx --test src/modules/books/originalArrivals.test.ts` (from `backend/`)
Expected: 5 failures, each with `claimants: 0` where `1` is expected:
- "an original with a colon subtitle joins when it arrives under its whole title"
- "an original with a colon subtitle is not joined by its main title"
- "an original with a dash part joins when it arrives under its whole title"
- "an original with an edition note after a dash is not joined by the plain title"
- "an original with a bracketed note joins when the title without it arrives"

"two volumes under one dash series stem are not joined when one arrives whole" passes, because it pins the unchanged shared rule.

- [ ] **Step 3: Drop the subtitle condition in `originalArrivals.ts`**

- In `joinClaimants`, remove `|| normalizeWords(original) !== normalizeTitle(mainTitle(original))` from the per-work `continue` condition. The other four conditions stay in the same order.
- Remove the `import { normalizeTitle, normalizeWords } from "@scripta/shared";` line.
- Remove `mainTitle` from the `./domain/translation.js` import.

- [ ] **Step 4: Update the drain paragraph in `backend/README.md`**

In the paragraph that starts "Every new or changed title key, and a book's first Open Library work key, is queued by a trigger":
- Replace "and it skips originals with a subtitle part and originals two different Portuguese titles share." with "and it skips originals two different Portuguese titles share."
- Replace "An original with a dash part is found the same way but is still skipped as a subtitle original." with "An original with a dash part is found the same way. An original with a colon, dash or bracketed part is planned like any other, and the whole-title rule decides: a "Dune: Messiah" claimant joins an arriving "Dune: Messiah", never an arriving "Dune". The shared rule groups claims by the part before the colon or dash, so a "Dune" claimant by the same author keeps both from joining on arrival."

- [ ] **Step 5: Run the tests and checks to verify they pass**

Run: `npx tsx --test src/modules/books/originalArrivals.test.ts` (from `backend/`)
Expected: `ℹ fail 0`, 30 tests passing.

Run: `node scripts/gate.mjs` (from the worktree root)
Expected: every Verify command it lists passes (shared build, backend typecheck, backend tests).

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/books/originalArrivals.ts backend/src/modules/books/originalArrivals.test.ts backend/README.md && git commit -m "Plan subtitle originals in the arrivals drain

The drain skipped a claimant whose original has a colon, dash or bracketed part (#325 decision 3). Since #333, planMatch settles in code only on an edition carrying the whole original title, and the drain checks the target again, so the skip guarded nothing. It only made these claimants wait for the backlog and the held-work job, which have no such skip. Guard 1, Guard 2, the shared-original rule and the target check are unchanged.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
