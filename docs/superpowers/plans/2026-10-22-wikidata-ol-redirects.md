# Wikidata OL Redirects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `fill-series.mjs wikidata` follow Open Library redirects. A Wikidata P648 key that Open Library has merged into another work then still matches the catalog's work.

**Architecture:** `fillFromWikidata` gets an injected `fetchWork(key)`, which returns the raw JSON of `/works/<key>.json`, or `null` on a 404. For each unmatched key the function follows `/type/redirect` records for up to 2 hops, and it returns `redirected` and `failedKeys`. The script wires `fetchWork` to `fetchJson` through an Open Library throttle. It runs every Wikidata page first and then calls the fill once.

**Tech Stack:** Fastify/TypeScript backend, `node:sqlite`, `node:test` via tsx.

**Spec:** `docs/superpowers/specs/2026-10-22-wikidata-ol-redirects-design.md`

## Global Constraints

- **No comments in code** (root `AGENTS.md`).
- **Before backend typecheck or tests,** run `npm run build --workspace @scripta/shared`.
- **Reuse:**
  - `normalizeWorkKey` from `domain/normalize.ts` to read `location`.
  - `SourceUnavailableError` from `domain/errors.ts`.
  - `fetchJson` and `createThrottle` from `adapters/http/http.ts`. The script imports them from `../dist/...`, as it already imports `USER_AGENT` and `createThrottle`.
- **Failure handling copies `fillHeldEditions`:** `if (!(error instanceof SourceUnavailableError) || error.status === 429) throw error;`
- **Commits end with** `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- **Fetches.** A key is fetched only when it has no catalog work and its row passed the name-key and `--skip` checks. Each distinct key is fetched at most once per call, and there are at most 2 requests per key.
- **No match.** A 404 (`null`), a non-redirect record, or a `location` that `normalizeWorkKey` rejects matches nothing. None of them goes in `failedKeys`.
- **Redirect targets** are looked up through `repo.workIdsByWorkKeys`. It already resolves `merged_into`.
- **The dry run fetches and writes nothing.**
- **`redirected` counts distinct keys,** not rows.

### Task 1: Follow Open Library redirects in the Wikidata fill

**Files:**
- Modify: `backend/src/modules/books/seed/seriesFill.ts`
- Test: `backend/src/modules/books/seed/seriesFill.test.ts`
- Modify: `backend/scripts/fill-series.mjs`
- Modify: `backend/README.md`

**Interfaces:**

```ts
export async function fillFromWikidata(
  repo: Pick<BooksRepository, "transaction" | "findBookByKey" | "workIdsByWorkKeys" | "addWorkSeries">,
  fetchWork: (olWorkKey: string) => Promise<unknown>,
  rows: WikidataRow[],
  at: string,
  options: WikidataOptions
): Promise<{ matched: number; added: number; redirected: number; failedKeys: string[] }>
```

`fetchWork` resolves to the parsed JSON body, or to `null` on a 404. It rejects with `SourceUnavailableError` when the source is unavailable, which is what `fetchJson` does.

Add a private constant `REDIRECT_HOPS = 2` in `seriesFill.ts`.

- [ ] **Step 1: Write the failing tests** in `seriesFill.test.ts`.
  - Existing `fillFromWikidata` calls pass a fake that returns `null`. Their report assertions gain `redirected: 0, failedKeys: []`.
  - New tests: a fake `fetchWork` backed by a `Record<string, unknown>` of bodies, which records the keys it was asked for. A missing key answers `null`.
  1. **A redirected key matches** (*Memories of Ice*). The catalog has a work with key `OL5734773W`, and the row is `"Malazan Book of the Fallen"` position `"3"` with `olWorkIds: ["OL17731722W"]`. The fake answers `{ key: "/works/OL17731722W", type: { key: "/type/redirect" }, location: "/works/OL5734773W" }`. Expect `matched: 1, added: 1, redirected: 1`, and `bestSeriesOf` gives the work that series at position `"3"`.
  2. **Hops.** A two-hop chain (A → B → catalog C) matches, and the fake is asked A, then B. A three-hop chain (D → E → F → catalog G) matches nothing, and the fake is asked exactly D and E.
  3. **A non-redirect stays unmatched.** These answers all leave the row unmatched, with `redirected: 0` and `failedKeys: []`, and nothing is written:
     - a `/type/work` record;
     - `null` (a 404);
     - a `/type/delete` record;
     - a redirect whose `location` is `"/authors/OL1A"`.
  4. **Who gets fetched.**
     - A key that already has a catalog work is never fetched.
     - The key of a skipped series row is never fetched, and neither is the key of a row whose series has no name key.
     - A key shared by two rows is fetched once. Both rows match the redirect target.
     - A dry run fetches the same keys and writes nothing.
  5. **Failures.**
     - A `SourceUnavailableError` with status 503, or with no status, for one key puts it in `failedKeys`. The other rows are still written.
     - A status 429 rejects the call.
     - A plain `Error` rejects the call.
- [ ] **Step 2: Run** `npm run build --workspace @scripta/shared && npm test --workspace backend`. Expect the new tests to fail.
- [ ] **Step 3: Implement in `seriesFill.ts`.** After `byOpenLibraryKey`, collect the unmatched keys of rows that pass the name-key and skip checks, in row order. For each one, sequentially:
  1. `await fetchWork(current)`.
  2. If the record is a redirect, run `normalizeWorkKey` on `location`.
  3. Look the target up with `repo.workIdsByWorkKeys([target])`. On a hit, `byOpenLibraryKey.set(key, workId)` and count it in `redirected`. Otherwise continue from the target, up to `REDIRECT_HOPS` requests.
  4. Catch failures as `fillHeldEditions` does.

  Then the existing row loop runs unchanged.
- [ ] **Step 4: Update `fill-series.mjs`:**
  - Import `fetchJson`.
  - In wikidata mode, create `createThrottle(OPEN_LIBRARY_GAP_MS)`. Define `fetchWork = (key) => throttle(() => fetchJson("openlibrary", \`https://openlibrary.org/works/${key}.json\`))`, with a counter that logs `JSON.stringify({ openLibraryRequests: n })` every 100 requests.
  - `runWikidata` queries every kind and page first. Its page log keeps `{ kind, offset, bindings, rows }`. Then it calls `fillFromWikidata` once with all rows.
  - The report is `{ pages, rows, matched, added, redirected, failedKeys, unmatchedSkips, series }`.
- [ ] **Step 5: Update `backend/README.md`** ("Series and collection fills"):
  - The `wikidata` bullet describes the redirect step, the progress line, `redirected` and `failedKeys`, and that the queries all run before the lookups.
  - The timing sentence says `wikidata` takes about ten paged queries plus one second per Open Library ID without a catalog work, for both the dry run and the real run.
  - No production numbers.
- [ ] **Step 6: Verify:**
  - `npm run build --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend`
  - `node --check backend/scripts/fill-series.mjs`, which shows the script still parses.
- [ ] **Step 7: Commit** the four files.
