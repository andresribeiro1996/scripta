# Faster Title-Key Grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `groupKeylessWorks(limit)` costs tens of milliseconds at 240k keyless books instead of 1–1.7 s, with the same source→target pairs.

**Architecture:** A covering index `books(title_key, work_id)` replaces `idx_books_title_key`. Each call walks title keys shared by two or more works in key order, and runs today's three CTEs only for the works holding those keys. It stops once it has `limit` pairs.

**Tech Stack:** Node 26, TypeScript, `node:sqlite` (`DatabaseSync`), `node:test` through `tsx`.

**Spec:** `docs/superpowers/specs/2026-10-18-faster-title-grouping-design.md`. Read it first.

## Global Constraints

- Worktree `/Users/andreribeiro/Documents/scripta/.claude/worktrees/vibrant-kare-865902`, branch `claude/vibrant-kare-865902`. Run git from the worktree root.
- No comments in code. The non-obvious *why* goes in the commit message.
- The source→target rules don't change: candidate, single keyed work, ambiguous keyed works skipped, oldest candidate by `created_at` then id, `title_group_blocked_at`, empty and NULL keys.
- `groupKeylessWorks` still does the SELECT and the merges inside one `inTransaction` call, and returns the number of pairs merged, never more than `limit`.
- It returns `limit` whenever at least `limit` pairs exist. `drainBatches` stops on a short batch, so a short batch with pairs left over would hold the rest for a day.
- Build shared before backend tests: `npm run build --workspace @scripta/shared`.
- One test file: `npm exec --workspace backend -- tsx --test src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`, with `--test-name-pattern "<text>"` for a subset.
- Before each commit: `npm run typecheck --workspace backend`.
- Stage and commit in one command, because concurrent sessions share the git index. End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never touch production.

## Review Focus

1. **Shared keys that never pair.** Two keyed works sharing a key, a mixed-key keyless work, or blocked editions all pass the shared-key filter but give no pair. A run of them before a real pair must not end a batch short. Pinned in Task 1 (stuck keys sorted first, `limit` 1).
2. **Order within one title key.** Sources must still merge oldest first when a key's sources span batches, because `mergeInto`'s summary and genre carries are first-wins. Pinned in Task 1 (batches of 1).
3. **Ties on `created_at`.** The oldest-candidate tie-break is the work id. Pinned in Task 1's fixture.
4. **A keyed work whose only matching edition is blocked** doesn't count as keyed for that key, so the keyless works group among themselves. Pinned in Task 1's fixture.
5. **The plan going back to a full scan.** If the `CROSS JOIN` order is lost, or the covering index is dropped, SQLite scans every keyless work again: correct but slow, and no behaviour test notices. Pinned in Task 2 by a query-plan test.

---

### Task 1: Pin today's grouping pairs

Tests only, written against the current code. They must pass **before** Task 2 changes anything, which proves they pin today's behaviour.

**Files:**
- Test: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`

**Interfaces:**
- Produces: a test helper `groupingFixture()` returning `{ db, repo, label }`. `label` is a `Map<string, string>` from each fixture work id to a short name. Also `mergedPairs(db, label): string[]`, which reads `SELECT from_work, into_work FROM work_merges WHERE source = 'title-key' ORDER BY id` and returns `"<from label>><into label>"` strings in that order. Build the fixture with the existing `edition(...)` helper and `at(n)`. Every edition needs its own ISBN: `createBook` silently returns the existing row when an ISBN is reused, and two labels would then name one work.

- [ ] **Step 1: Write the fixture and three tests**

The fixture holds one group per rule. Names are suggestions; the implementer picks titles whose title keys sort as each test needs.

| Group | Editions (each its own work unless noted) | Expected pairs |
|---|---|---|
| single keyed | keyed `OL1W` at(0); keyless `k1` at(2), `k2` at(1) | `k1>keyed`, `k2>keyed` |
| ambiguous keyed | keyed `OL2W`, keyed `OL3W`, keyless | none |
| keyless group | `m0` at(0), `m1` at(1), `m2` at(2), `m3` at(3), inserted in the order m3, m1, m0, m2 | `m1>m0`, `m2>m0`, `m3>m0` |
| tie | two keyless, both at(5), labelled by work id order: the smaller id is `tie-lo`, the larger `tie-hi` | `tie-hi>tie-lo` |
| blocked keyed edition | keyed `OL4W` whose edition has `title_group_blocked_at` set by SQL; keyless `b0` at(0), `b1` at(1) | `b1>b0` only |
| blocked keyless | keyed `OL5W`; keyless edition detached with `repo.detachEdition(id, at(1))` | none |
| mixed keyless | keyless "Blindness" and keyless "Ensaio sobre a Cegueira" merged with `repo.mergeWorks`; a newer keyless "Ensaio sobre a Cegueira" | none |
| empty key | two keyless with author `""` | none |
| NULL key | two keyless, one with `title_key` set NULL by SQL | none |

Tests:

```ts
test("grouping picks the same source and target for every rule case", () => {
  const { db, repo, label } = groupingFixture();
  assert.equal(repo.groupKeylessWorks(250, AT), <expected count>);
  assert.deepEqual(mergedPairs(db, label).sort(), [<every expected pair from the table>].sort());
  assert.equal(repo.groupKeylessWorks(250, AT), 0);
});

test("batches of one merge the same pairs as one call, oldest first within a title key", () => {
  const one = groupingFixture();
  while (one.repo.groupKeylessWorks(1, AT) === 1);
  const all = groupingFixture();
  all.repo.groupKeylessWorks(250, AT);
  assert.deepEqual(mergedPairs(one.db, one.label).sort(), mergedPairs(all.db, all.label).sort());
  assert.deepEqual(mergedPairs(one.db, one.label).filter((pair) => pair.endsWith(">m0")), ["m1>m0", "m2>m0", "m3>m0"]);
});

test("shared title keys that never pair don't end a batch early", () => {
  // two or more keys each held by two keyed works, whose title keys sort before one keyless pair
  assert.equal(repo.groupKeylessWorks(1, AT), 1);
  assert.equal(repo.groupKeylessWorks(1, AT), 0);
});
```

`AT` is any fixed ISO timestamp. Use the existing `NOW` if it fits. Work ids are random UUIDs, so `groupingFixture` must give the tie group's labels by comparing the two ids. A fixed label per edition makes the batches-of-one test fail about half the time.

One more test, for the sum in Task 2's loop (`limit - pairs.length`). It needs three title keys in this sort order: key A with one keyless pair, key B stuck (held by two keyed works), key C with two keyless pairs (three keyless works).

```ts
test("a batch never merges more than its limit when shared keys yield uneven pairs", () => {
  assert.deepEqual([repo.groupKeylessWorks(2, AT), repo.groupKeylessWorks(2, AT), repo.groupKeylessWorks(2, AT)], [2, 1, 0]);
});
```

- [ ] **Step 2: Run them on the current code**

Run: `npm exec --workspace backend -- tsx --test --test-name-pattern "grouping|batches of one|never pair|uneven pairs" src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`
Expected: all pass, the existing grouping tests included. A failure means the fixture or the expectation is wrong, not the code. Fix the test.

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts && git commit -m "Pin which works title-key grouping merges, before speeding it up" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: Group by shared title keys, in key order

**Files:**
- Modify: `backend/src/modules/books/adapters/sqlite/connection.ts` (line 53, the `idx_books_title_key` migration)
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts` (`groupablePairsStmt` about line 200, `groupKeylessWorks` about line 980, exported SQL constants at the top)
- Test: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`

**Interfaces:**
- Consumes: Task 1's tests, unchanged.
- Produces: `export const GROUPABLE_KEYS_SQL` and `export const GROUPABLE_PAIRS_SQL` in `sqliteBooksRepository.ts`, beside `WORK_LOOKUP_SQL`. The index is `idx_books_title_work ON books(title_key, work_id)`. `groupKeylessWorks(limit, at)` keeps its signature (`domain/ports.ts:53`).

- [ ] **Step 1: Write the query-plan test**

Add `GROUPABLE_KEYS_SQL` and `GROUPABLE_PAIRS_SQL` to the import on line 18.

```ts
test("grouping reads shared title keys from the covering index and starts from them", () => {
  const { db } = freshRepo();
  const plan = (sql: string, ...params: Array<string | number>) => (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as Array<{ detail: string }>).map((row) => row.detail).join(" | ");
  const keys = plan(GROUPABLE_KEYS_SQL, "", 250);
  assert.match(keys, /USING COVERING INDEX idx_books_title_work\b/, keys);
  assert.doesNotMatch(keys, /TEMP B-TREE/, keys);
  const pairs = plan(GROUPABLE_PAIRS_SQL, "[]", 250);
  assert.match(pairs, /SEARCH books USING COVERING INDEX idx_books_title_work \(title_key=\?\)/, pairs);
  assert.doesNotMatch(pairs, /sqlite_autoindex_works_2/, pairs);
});
```

In the migration test "the title key columns are added to an existing database once" (about line 983), drop and assert `idx_books_title_work` instead of `idx_books_title_key`. Also assert that `idx_books_title_key` is gone after `applyBooksMigrations` runs on a database that still has it.

- [ ] **Step 2: Run them to see them fail**

Run: `npm exec --workspace backend -- tsx --test --test-name-pattern "covering index|title key columns" src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`
Expected: both fail. The plan test fails at `prepare("EXPLAIN QUERY PLAN undefined")`, because the destructured import of a missing export is `undefined`. The migration test fails on the index name.

- [ ] **Step 3: Swap the index in `connection.ts`**

Replace line 53 with `DROP INDEX IF EXISTS idx_books_title_key`, then `CREATE INDEX IF NOT EXISTS idx_books_title_work ON books(title_key, work_id)`.

- [ ] **Step 4: Write the two statements**

`GROUPABLE_KEYS_SQL`, taking `(after, limit)`:

```sql
SELECT title_key FROM books
WHERE title_key > ?
GROUP BY title_key
HAVING COUNT(DISTINCT work_id) > 1
ORDER BY title_key
LIMIT ?
```

`GROUPABLE_PAIRS_SQL`, taking `(keysJson, limit)`, is today's `groupablePairsStmt` with exactly two edits.

The `candidates` FROM starts from the given keys, with `CROSS JOIN` to hold that join order:

```sql
FROM (SELECT DISTINCT work_id FROM books WHERE title_key IN (SELECT value FROM json_each(?))) AS hits
CROSS JOIN works ON works.id = hits.work_id
CROSS JOIN books ON books.work_id = works.id
WHERE works.ol_work_key IS NULL AND works.merged_into IS NULL
```

Its GROUP BY and HAVING are unchanged. `keyed` and `oldest` are unchanged.

The final `ORDER BY` becomes `candidates.title_key, candidates.created_at, candidates.work_id`.

Without `CROSS JOIN`, SQLite drives `candidates` from `sqlite_autoindex_works_2` (every keyless work) and checks the key list per row. That measured 90 ms instead of 17 ms on the 240k copy. Say so in the commit message.

- [ ] **Step 5: Rewrite `groupKeylessWorks`**

The loop is the decision, so here it is. Prepare both statements once beside the others, replacing `groupablePairsStmt`:

```ts
groupKeylessWorks(limit, at = new Date().toISOString()) {
  return inTransaction(() => {
    const pairs: Array<{ source: string; target: string }> = [];
    let after = "";
    while (pairs.length < limit) {
      const keys = (groupableKeysStmt.all(after, limit) as Array<{ title_key: string }>).map((row) => row.title_key);
      if (keys.length === 0) break;
      pairs.push(...(groupablePairsStmt.all(JSON.stringify(keys), limit - pairs.length) as Array<{ source: string; target: string }>));
      after = keys[keys.length - 1]!;
    }
    for (const pair of pairs) mergeInto(pair.source, pair.target, { source: "title-key", confidence: null, at, carrySummary: true });
    return pairs.length;
  });
}
```

`after = ""` excludes NULL and `''` keys, as today's `MIN(title_key) <> ''` and `COUNT(title_key) = COUNT(*)` do.

- [ ] **Step 6: Run the whole books repository test file**

Run: `npm exec --workspace backend -- tsx --test src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`
Expected: all pass, Task 1's pins and the existing grouping tests included, with none of them edited.

- [ ] **Step 7: Run the backend gate**

Run: `node scripts/gate.mjs`
Expected: typecheck and `npm test --workspace backend` pass.

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/books/adapters/sqlite/connection.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts && git commit -m "Group keyless works by shared title keys in key order" -m "<why: 1.1 s per call at 240k; key-order batches; CROSS JOIN; index swap>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## After the tasks (main session)

The scale check on the 240k scratch copy, with the harness in the session scratchpad:

- Drain with the new code on a fresh copy of the built database. Record every call's time, then one more call once nothing is left.
- Compare the final `books (id, work_id, genres, genres_source)`, `works (id, merged_into, title, author, summary_hash)`, `work_merges (from, into, source, moved, repointed)`, `genre_judgments` and `genre_rejections` with the drain the current code made. The only diffs allowed are on keyed targets that took sources under two or more title keys. List those first; any diff outside that list is a bug.
- Repeat the timings under production's Node (`npx -y node@24.21.0`), which bundles a different SQLite.
- The numbers go in the PR, before and after.
