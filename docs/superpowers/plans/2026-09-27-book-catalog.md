# Book Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the backend's cover cache into a self-filling book database (covers, details, search) that picks the best cover from ISBNdb → Apple Books → Open Library, looks books up in a background worker, serves 600px thumbnails to grids, and lets the admin reject or replace shared covers.

**Architecture:** `backend/src/modules/covers` becomes `backend/src/modules/books`, keeping its SQLite file and blob directory. A book row (keyed by ISBN or normalized title+author) holds details and a pointer to its current cover image; `/covers/resolve` answers from the database immediately and queues unknown books for an in-process worker that runs the source chain with per-source throttling. Both clients share one cover-cache/polling implementation in `@scripta/shared` and call `/books/details` and `/books/search` instead of Open Library.

**Tech Stack:** Fastify, `node:sqlite` (FTS5), `sharp`, zod, `node:test` + `tsx`; React (web), Expo/React Native (mobile); `@scripta/shared`.

**Spec:** `docs/superpowers/specs/2026-09-27-book-catalog-design.md`

## Global Constraints

- No code comments unless the task shows them (repo rule, `AGENTS.md`).
- Catch only the specific failure you expect; let everything else propagate (repo rule).
- Reuse `@scripta/shared` for logic both clients need; never duplicate it in `frontend/` and `mobile/`.
- New backend test files must be added to the explicit list in `backend/package.json`'s `test` script, or CI never runs them.
- Backend tests that import anything reaching `config/env.ts` set env vars first and use dynamic `await import(...)` (see the preamble in Task 3).
- Cover thresholds: good cover width ≥ **400px**; accepted aspect ratio (height ÷ width) **1.2–1.9**; ISBNdb placeholder is exactly **200×248**.
- Encodings: full image ≤**1600px** long edge, WebP quality **85**; thumbnail fits **600×900**, WebP quality **80**; no enlargement.
- Retry windows: `missing`/`low_res` covers and `missing` details retry after **30 days**; a chain with a failed source backs the book off for **10 minutes** (in memory).
- Source spacing: ISBNdb **1100ms**, Apple **3200ms**, Open Library **1000ms** (shared by cover lookups, details and search). Apple storefronts in order: **pt, us, br**.
- Client cover cache: entries expire after **7 days**; storage key **`scripta.covers.resolved.v2`**; pending answers re-ask after 5s doubling to a **300s** cap, at most **10** attempts.
- Rate limits: `/covers/resolve` **1200/min**; `/books/details` + `/books/search` **300/min**; admin routes **30/min**; cover files unlimited. Upload cap **20 MB**.
- Git: this is a worktree; use `/usr/bin/git` (not `rtk git`), and stage + commit in one command. End every commit message with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- Run `npm run build --workspace @scripta/shared` before typechecking any package that imports a shared change.

## Review Focus

- An EPUB identifier in the ISBN field (`urn:uuid:…`, common in Kobo exports) must be treated as "no ISBN" and fall back to the title key, not create an `isbn:urn…` book. → Task 7, test "an EPUB urn:uuid ISBN falls back to the title key".
- A title that normalizes to nothing (`"?!"`) with no ISBN must not create a book: every such book would share the key `ta:|…`. → Task 2 (`lookupIdentity` returns null) and Task 7, test "a title that normalizes to nothing creates no book".
- A search query containing FTS syntax (`"`, `*`, `-`, parentheses) must never reach SQLite as FTS syntax and 500; punctuation-only queries return `[]` without calling Open Library. → Task 8, test "search strips FTS syntax and ignores punctuation-only queries".
- An unexpected error while processing one book (a sharp crash, a full disk) must be reported and the worker must keep draining the queue. → Task 7, worker test "an error in one book is reported and the queue keeps draining".
- The same new book requested many times at once (a grid of duplicates, StrictMode double effects) must produce one book row and one queue entry. → Task 7, service test "a new book answers pending and repeat requests reuse the same row", and worker test "enqueueing a queued book does not duplicate it".

---

## File map

**Shared (`packages/shared/src/library/`)**
- Create `coverResolver.ts` — client cover cache: TTL, polling, in-flight de-duplication, thumb/full selection. Test: `coverResolver.test.ts`.
- Modify `index.ts` — export it.

**Backend (`backend/src/modules/books/`, moved from `covers/`)**
- `domain/normalize.ts` — title/author normalization, lookup identity, search tokens.
- `domain/constants.ts` — `MIN_GOOD_WIDTH`.
- `domain/types.ts` — row and status types (legacy types removed in Task 10).
- `domain/ports.ts` — `BooksRepository`, `CoverBlobStore`, `CoverSource`, `BookCatalog` (legacy ports removed in Task 10).
- `domain/errors.ts` — `SourceUnavailableError`, `BookNotFoundError`, `FileTooLargeError`, `InvalidImageError`.
- `domain/images.ts` — encode full + thumbnail, acceptance rules.
- `adapters/sqlite/books.sql`, `adapters/sqlite/connection.ts`, `adapters/sqlite/sqliteBooksRepository.ts`.
- `adapters/fs/fsCoverBlobStore.ts` — unchanged.
- `adapters/http/http.ts` — `fetchJson`, `fetchBytes`, `createThrottle`.
- `adapters/sources/isbndb.ts`, `adapters/sources/apple.ts`, `adapters/sources/openLibrary.ts` — cover sources.
- `adapters/openlibrary/openLibraryCatalog.ts` — details + Add Book search.
- `coverResolver.ts` — the source chain for one book.
- `worker.ts` — in-process queue.
- `booksService.ts` — resolve, process, files, details, search, admin.
- `routes.ts`, `plugin.ts`, `publicCoverLookup.ts`, `index.ts`.
- Deleted in Task 10: `service.ts`, `adapters/google/`, `adapters/hardcover/`, `adapters/kobo/`, `adapters/openlibrary/openLibraryCoverLookup.ts`, `adapters/sqlite/schema.sql`, `adapters/sqlite/sqliteCoverCacheRepository.ts`.

**Backend elsewhere:** `src/app.ts`, `src/config/env.ts`, `src/modules/library/publicResolver.ts`, `.env.example`, `scripts/three-users.mjs`, `package.json`, `README.md`.

**Web (`frontend/src/`):** `api/covers.ts`, `api/books.ts` (new), `components/BookCard.tsx`, `components/BookDetailSheet.tsx`, `lib/arenaSeed.ts`, `lib/bookMetadata.ts`, `lib/bookSearch.ts`, `scripts/test-book-metadata.mts`, `README.md`.

**Mobile (`mobile/src/features/`):** `library/api/covers.ts`, `library/api/bookMetadata.ts`, `library/api/search.ts`, `library/components/CoverImage.tsx`, `library/components/BookDetail.tsx`, `library/hooks/useGenreEnrichment.ts`.

---

### Task 1: Shared cover resolver

**Files:**
- Create: `packages/shared/src/library/coverResolver.ts`
- Create: `packages/shared/src/library/coverResolver.test.ts`
- Modify: `packages/shared/src/library/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (exported from `@scripta/shared`):
  - `interface CoverLookupParams { isbn?: string; imageId?: string; title?: string; author?: string }`
  - `interface ResolvedCoverResponse { url: string | null; fullUrl: string | null; pending: boolean }`
  - `interface CoverCacheEntry { url: string | null; fullUrl: string | null; at: number }`
  - `type CoverSize = "thumb" | "full"`
  - `COVER_CACHE_TTL_MS`, `COVER_POLL_MAX_ATTEMPTS`, `coverPollDelayMs(attempt: number): number`, `coverQueryKey(params: CoverLookupParams): string`
  - `createCoverResolver(deps: CoverResolverDeps): CoverResolver` with `hydrate(saved)`, `peek(params, size?)`, `resolve(params, { size?, poll? })`, `forget(params)`, `remember(params, cover)`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/library/coverResolver.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COVER_CACHE_TTL_MS,
  COVER_POLL_MAX_ATTEMPTS,
  coverPollDelayMs,
  coverQueryKey,
  createCoverResolver,
  type CoverCacheEntry,
  type ResolvedCoverResponse
} from "./coverResolver.js";

const found: ResolvedCoverResponse = { url: "https://api.test/covers/cached/a/thumb", fullUrl: "https://api.test/covers/cached/a/file", pending: false };
const pending: ResolvedCoverResponse = { url: null, fullUrl: null, pending: true };
const params = { isbn: "9780141184272", title: "Orlando", author: "Virginia Woolf" };

function setup(answers: ResolvedCoverResponse[]) {
  let clock = 1_000_000;
  const queries: string[] = [];
  const sleeps: number[] = [];
  const persisted: Array<Record<string, CoverCacheEntry>> = [];
  const resolver = createCoverResolver({
    fetchResolve: async (query) => {
      queries.push(query);
      const next = answers.shift();
      if (!next) throw new Error("no more answers");
      return next;
    },
    persist: (entries) => persisted.push(entries),
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    }
  });
  return { resolver, queries, sleeps, persisted, advance: (ms: number) => { clock += ms; } };
}

test("the query key drops imageId", () => {
  assert.equal(coverQueryKey({ ...params, imageId: "file____mnt_onboard_x" }), "isbn=9780141184272&title=Orlando&author=Virginia+Woolf");
});

test("poll delays double from 5s and cap at 5 minutes", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map(coverPollDelayMs), [5000, 10000, 20000, 40000, 80000, 160000, 300000, 300000]);
});

test("a found cover is cached and served as thumb or full without refetching", async () => {
  const { resolver, queries } = setup([found]);
  assert.equal(resolver.peek(params), undefined);
  assert.equal(await resolver.resolve(params), found.url);
  assert.equal(await resolver.resolve(params, { size: "full" }), found.fullUrl);
  assert.equal(resolver.peek(params), found.url);
  assert.equal(resolver.peek(params, "full"), found.fullUrl);
  assert.equal(queries.length, 1);
});

test("a pending answer is polled with growing delays until it settles", async () => {
  const { resolver, queries, sleeps } = setup([pending, pending, found]);
  assert.equal(await resolver.resolve(params), found.url);
  assert.equal(queries.length, 3);
  assert.deepEqual(sleeps, [5000, 10000]);
});

test("poll: false returns null on a pending answer and caches nothing", async () => {
  const { resolver, sleeps } = setup([pending, found]);
  assert.equal(await resolver.resolve(params, { poll: false }), null);
  assert.deepEqual(sleeps, []);
  assert.equal(resolver.peek(params), undefined);
  assert.equal(await resolver.resolve(params), found.url);
});

test("polling gives up after the maximum number of attempts", async () => {
  const { resolver, queries } = setup(Array.from({ length: COVER_POLL_MAX_ATTEMPTS }, () => pending));
  assert.equal(await resolver.resolve(params), null);
  assert.equal(queries.length, COVER_POLL_MAX_ATTEMPTS);
  assert.equal(resolver.peek(params), undefined);
});

test("concurrent resolves for the same book share one request", async () => {
  const { resolver, queries } = setup([found]);
  const [a, b] = await Promise.all([resolver.resolve(params), resolver.resolve(params)]);
  assert.equal(a, found.url);
  assert.equal(b, found.url);
  assert.equal(queries.length, 1);
});

test("entries expire after the TTL", async () => {
  const { resolver, queries, advance } = setup([found, found]);
  await resolver.resolve(params);
  advance(COVER_CACHE_TTL_MS);
  assert.equal(resolver.peek(params), undefined);
  await resolver.resolve(params);
  assert.equal(queries.length, 2);
});

test("misses stay in memory; only found covers are persisted", async () => {
  const miss: ResolvedCoverResponse = { url: null, fullUrl: null, pending: false };
  const { resolver, persisted } = setup([miss, found]);
  assert.equal(await resolver.resolve({ title: "Unknown" }), null);
  assert.equal(resolver.peek({ title: "Unknown" }), null);
  await resolver.resolve(params);
  const last = persisted.at(-1)!;
  assert.deepEqual(Object.keys(last), [coverQueryKey(params)]);
});

test("hydrate keeps fresh found entries and ignores stale or empty ones", () => {
  const { resolver } = setup([]);
  resolver.hydrate({
    [coverQueryKey(params)]: { url: found.url, fullUrl: found.fullUrl, at: 1_000_000 },
    [coverQueryKey({ title: "Old" })]: { url: "https://x/old", fullUrl: null, at: 1_000_000 - COVER_CACHE_TTL_MS },
    [coverQueryKey({ title: "Empty" })]: { url: null, fullUrl: null, at: 1_000_000 }
  });
  assert.equal(resolver.peek(params), found.url);
  assert.equal(resolver.peek({ title: "Old" }), undefined);
  assert.equal(resolver.peek({ title: "Empty" }), undefined);
});

test("full falls back to the thumbnail when no full URL exists", () => {
  const { resolver } = setup([]);
  resolver.remember(params, { url: "https://x/thumb", fullUrl: null });
  assert.equal(resolver.peek(params, "full"), "https://x/thumb");
});

test("forget drops the entry", async () => {
  const { resolver } = setup([found]);
  await resolver.resolve(params);
  resolver.forget(params);
  assert.equal(resolver.peek(params), undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared && node --import tsx --test src/library/coverResolver.test.ts`
Expected: FAIL — `Cannot find module './coverResolver.js'`.

- [ ] **Step 3: Write the implementation**

Create `packages/shared/src/library/coverResolver.ts`:

```ts
export interface CoverLookupParams {
  isbn?: string;
  imageId?: string;
  title?: string;
  author?: string;
}

export interface ResolvedCoverResponse {
  url: string | null;
  fullUrl: string | null;
  pending: boolean;
}

export interface CoverCacheEntry {
  url: string | null;
  fullUrl: string | null;
  at: number;
}

export type CoverSize = "thumb" | "full";

export const COVER_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const COVER_POLL_MAX_ATTEMPTS = 10;
const COVER_POLL_BASE_MS = 5_000;
const COVER_POLL_CAP_MS = 300_000;

export function coverPollDelayMs(attempt: number): number {
  return Math.min(COVER_POLL_BASE_MS * 2 ** attempt, COVER_POLL_CAP_MS);
}

export function coverQueryKey(params: CoverLookupParams): string {
  const query = new URLSearchParams();
  if (params.isbn) query.set("isbn", params.isbn);
  if (params.title) query.set("title", params.title);
  if (params.author) query.set("author", params.author);
  return query.toString();
}

export interface CoverResolverDeps {
  fetchResolve(query: string): Promise<ResolvedCoverResponse>;
  persist(entries: Record<string, CoverCacheEntry>): void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface CoverResolver {
  hydrate(saved: Record<string, CoverCacheEntry>): void;
  peek(params: CoverLookupParams, size?: CoverSize): string | null | undefined;
  resolve(params: CoverLookupParams, options?: { size?: CoverSize; poll?: boolean }): Promise<string | null>;
  forget(params: CoverLookupParams): void;
  remember(params: CoverLookupParams, cover: { url: string | null; fullUrl: string | null }): void;
}

export function createCoverResolver(deps: CoverResolverDeps): CoverResolver {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const entries = new Map<string, CoverCacheEntry>();
  const inFlight = new Map<string, Promise<CoverCacheEntry | null>>();

  const fresh = (entry: CoverCacheEntry | undefined) => (entry && now() - entry.at < COVER_CACHE_TTL_MS ? entry : undefined);
  const pick = (entry: CoverCacheEntry, size: CoverSize) => (size === "full" ? entry.fullUrl ?? entry.url : entry.url);

  function persist() {
    deps.persist(Object.fromEntries([...entries].filter(([, entry]) => entry.url !== null)));
  }

  function store(key: string, cover: { url: string | null; fullUrl: string | null }): CoverCacheEntry {
    const entry = { url: cover.url, fullUrl: cover.fullUrl, at: now() };
    entries.set(key, entry);
    persist();
    return entry;
  }

  return {
    hydrate(saved) {
      for (const [key, entry] of Object.entries(saved)) {
        if (!entries.has(key) && typeof entry?.url === "string" && fresh(entry)) entries.set(key, entry);
      }
    },

    peek(params, size = "thumb") {
      const entry = fresh(entries.get(coverQueryKey(params)));
      return entry ? pick(entry, size) : undefined;
    },

    async resolve(params, { size = "thumb", poll = true } = {}) {
      const key = coverQueryKey(params);
      const cached = fresh(entries.get(key));
      if (cached) return pick(cached, size);

      const flightKey = poll ? key : `${key}#once`;
      let request = inFlight.get(flightKey);
      if (!request) {
        request = (async () => {
          try {
            for (let attempt = 0; ; attempt++) {
              const body = await deps.fetchResolve(key);
              if (!body.pending) return store(key, body);
              if (!poll || attempt + 1 >= COVER_POLL_MAX_ATTEMPTS) return null;
              await sleep(coverPollDelayMs(attempt));
            }
          } finally {
            inFlight.delete(flightKey);
          }
        })();
        inFlight.set(flightKey, request);
      }
      const entry = await request;
      return entry ? pick(entry, size) : null;
    },

    forget(params) {
      entries.delete(coverQueryKey(params));
      persist();
    },

    remember(params, cover) {
      store(coverQueryKey(params), cover);
    }
  };
}
```

Add to `packages/shared/src/library/index.ts`, next to the existing `export * from "./covers.js";` line:

```ts
export * from "./coverResolver.js";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/shared && node --import tsx --test src/library/coverResolver.test.ts`
Expected: PASS (12 tests).
Then run: `npm test --workspace @scripta/shared && npm run build --workspace @scripta/shared`
Expected: all pass; build succeeds.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add packages/shared/src/library/coverResolver.ts packages/shared/src/library/coverResolver.test.ts packages/shared/src/library/index.ts && /usr/bin/git commit -m "Shared cover resolver: TTL cache, pending polling, thumb/full

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Move `covers` to `books`; normalization and lookup identity

**Files:**
- Move: `backend/src/modules/covers/` → `backend/src/modules/books/`
- Modify: `backend/src/modules/books/index.ts`, `backend/src/app.ts:30,126`, `backend/src/modules/library/publicResolver.ts:39`
- Create: `backend/src/modules/books/domain/normalize.ts`
- Create: `backend/src/modules/books/domain/normalize.test.ts`
- Modify: `backend/package.json` (test list)

**Interfaces:**
- Consumes: `normalizeIsbn` from `@scripta/shared`.
- Produces:
  - `normalizeWords(value: string): string`
  - `normalizeTitle(value: string): string`
  - `titleMatches(wanted: string, candidate: string): boolean`
  - `authorMatches(wantedAttribution: string, candidateAuthors: string[]): boolean`
  - `searchTokens(query: string): string[]`
  - `interface BookLookup { isbn?: string | null; title?: string | null; author?: string | null }`
  - `interface BookIdentity { key: string; isbn: string | null; title: string; author: string }`
  - `lookupIdentity(lookup: BookLookup): BookIdentity | null`
  - `registerBooksModule` (renamed export of the plugin) from `modules/books/index.ts`

- [ ] **Step 1: Move the module and fix imports**

```bash
cd /Users/andreribeiro/Documents/scripta/.claude/worktrees/vigorous-bun-af81d9 && /usr/bin/git mv backend/src/modules/covers backend/src/modules/books
```

In `backend/src/modules/books/index.ts` change the plugin export line to:

```ts
export { coversPlugin as registerBooksModule } from "./plugin.js";
```

In `backend/src/app.ts` change `import { registerCoversModule } from "./modules/covers/index.js";` to `import { registerBooksModule } from "./modules/books/index.js";` and `app.register(registerCoversModule);` to `app.register(registerBooksModule);`.

In `backend/src/modules/library/publicResolver.ts` change `from "../covers/index.js"` to `from "../books/index.js"`.

Run: `grep -rn "modules/covers\|\.\./covers/" backend/src` — Expected: no output.

- [ ] **Step 2: Write the failing test**

Create `backend/src/modules/books/domain/normalize.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { authorMatches, lookupIdentity, normalizeTitle, searchTokens, titleMatches } from "./normalize.js";

test("titles drop series brackets, subtitles and diacritics", () => {
  assert.equal(normalizeTitle("Red Rising (Red Rising Saga, #1)"), "red rising");
  assert.equal(normalizeTitle("The Dispossessed: An Ambiguous Utopia"), "the dispossessed");
  assert.equal(normalizeTitle("Antídoto"), "antidoto");
  assert.equal(normalizeTitle("Orlando (Penguin Modern Classics)"), "orlando");
  assert.equal(normalizeTitle("Wool Omnibus [Silo #1]"), "wool omnibus");
});

test("title matching is strict equality after normalization", () => {
  assert.equal(titleMatches("Orlando (Penguin Modern Classics)", "Orlando"), true);
  assert.equal(titleMatches("ECOTOPIA", "Ecotopia"), true);
  assert.equal(titleMatches("Illness as Metaphor", "Illness as Metaphor and AIDS and Its Metaphors"), false);
  assert.equal(titleMatches("?!", "?!"), false);
});

test("author matching accepts any listed name, including translator-first records", () => {
  assert.equal(authorMatches("Paulo Faria, George Orwell", ["George Orwell"]), true);
  assert.equal(authorMatches("Stanisław Lem", ["Stanisław Lem"]), true);
  assert.equal(authorMatches("Ursula K. Le Guin", ["Ursula K. Le Guin"]), true);
  assert.equal(authorMatches("Virginia Woolf", ["Susan Sontag"]), false);
  assert.equal(authorMatches("", ["Anyone"]), false);
});

test("lookup identity prefers a valid ISBN and falls back to title + author", () => {
  assert.deepEqual(lookupIdentity({ isbn: "978-0-14-118427-2", title: "Orlando", author: "Virginia Woolf" }), {
    key: "isbn:9780141184272",
    isbn: "9780141184272",
    title: "Orlando",
    author: "Virginia Woolf"
  });
  assert.deepEqual(lookupIdentity({ isbn: "urn:uuid:ac11a7ae-d21e-42bb-8cfe-b85022867ac4", title: " The Stranger ", author: "Albert Camus" }), {
    key: "ta:the stranger|albert camus",
    isbn: null,
    title: "The Stranger",
    author: "Albert Camus"
  });
  assert.equal(lookupIdentity({ title: "?!", author: "Someone" }), null);
  assert.equal(lookupIdentity({}), null);
});

test("search tokens are plain words, safe for FTS", () => {
  assert.deepEqual(searchTokens('"Dune" -messiah* (Herbert)'), ["dune", "messiah", "herbert"]);
  assert.deepEqual(searchTokens("***"), []);
  assert.equal(searchTokens("a b c d e f g h i j").length, 8);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && npx tsx --test src/modules/books/domain/normalize.test.ts`
Expected: FAIL — `Cannot find module './normalize.js'`.

- [ ] **Step 4: Write the implementation**

Create `backend/src/modules/books/domain/normalize.ts`:

```ts
import { normalizeIsbn } from "@scripta/shared";

const MAX_SEARCH_TOKENS = 8;

export interface BookLookup {
  isbn?: string | null;
  title?: string | null;
  author?: string | null;
}

export interface BookIdentity {
  key: string;
  isbn: string | null;
  title: string;
  author: string;
}

export function normalizeWords(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function normalizeTitle(value: string): string {
  const withoutBrackets = value.replace(/\([^)]*\)|\[[^\]]*\]/g, " ");
  return normalizeWords(withoutBrackets.split(":")[0] ?? "");
}

export function titleMatches(wanted: string, candidate: string): boolean {
  const normalized = normalizeTitle(wanted);
  return normalized !== "" && normalized === normalizeTitle(candidate);
}

export function authorMatches(wantedAttribution: string, candidateAuthors: string[]): boolean {
  const candidateWords = new Set(candidateAuthors.flatMap((name) => normalizeWords(name).split(" ").filter(Boolean)));
  return wantedAttribution.split(",").some((name) => {
    const last = normalizeWords(name).split(" ").filter(Boolean).at(-1);
    return last !== undefined && candidateWords.has(last);
  });
}

export function searchTokens(query: string): string[] {
  return normalizeWords(query).split(" ").filter(Boolean).slice(0, MAX_SEARCH_TOKENS);
}

export function lookupIdentity(lookup: BookLookup): BookIdentity | null {
  const isbn = normalizeIsbn(lookup.isbn ?? "") || null;
  const title = (lookup.title ?? "").trim();
  const author = (lookup.author ?? "").trim();
  if (isbn) return { key: `isbn:${isbn}`, isbn, title, author };
  const normalized = normalizeTitle(title);
  return normalized ? { key: `ta:${normalized}|${normalizeWords(author)}`, isbn: null, title, author } : null;
}
```

Add `src/modules/books/domain/normalize.test.ts` to the end of the file list in `backend/package.json`'s `"test"` script.

- [ ] **Step 5: Run tests and typecheck**

Run: `cd backend && npx tsx --test src/modules/books/domain/normalize.test.ts`
Expected: PASS (5 tests).
Run from the repo root: `npm run build --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend`
Expected: typecheck clean; all tests pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/andreribeiro/Documents/scripta/.claude/worktrees/vigorous-bun-af81d9 && /usr/bin/git add -A backend/src/modules/books backend/src/modules/covers backend/src/app.ts backend/src/modules/library/publicResolver.ts backend/package.json && /usr/bin/git commit -m "Move covers module to books; add title/author normalization

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Book storage — schema, legacy migration, repository

**Files:**
- Create: `backend/src/modules/books/domain/constants.ts`
- Modify: `backend/src/modules/books/domain/types.ts` (append)
- Modify: `backend/src/modules/books/domain/ports.ts` (append)
- Create: `backend/src/modules/books/adapters/sqlite/books.sql`
- Modify: `backend/src/modules/books/adapters/sqlite/connection.ts` (add functions; keep `openCoversDb` until Task 10)
- Create: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Create: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`
- Modify: `backend/package.json` (test list)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `MIN_GOOD_WIDTH = 400` (`domain/constants.ts`)
  - Types (`domain/types.ts`): `CoverStatus = "good" | "low_res" | "missing" | "manual"`, `DetailsStatus = "found" | "missing"`, `CoverSourceName = "isbndb" | "apple" | "openlibrary" | "upload"`, `BookRow`, `CoverImageRow`, `NewBook`
  - `BooksRepository` (`domain/ports.ts`) — methods listed in Step 3
  - `applyBooksMigrations(db: DatabaseSync): void`, `openBooksDb(): DatabaseSync` (`adapters/sqlite/connection.ts`)
  - `createSqliteBooksRepository(db: DatabaseSync): BooksRepository`

- [ ] **Step 1: Write the failing test**

Create `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "books-repo-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.GALLERY_STORAGE_PATH = join(scratch, "gallery-files");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.COVERS_STORAGE_PATH = join(scratch, "covers-files");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("./connection.js");
const { createSqliteBooksRepository } = await import("./sqliteBooksRepository.js");

const NOW = "2026-10-01T00:00:00.000Z";

function freshRepo() {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  return { db, repo: createSqliteBooksRepository(db) };
}

function legacyDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE cover_cache (
    id TEXT PRIMARY KEY, cache_key TEXT NOT NULL UNIQUE, source TEXT NOT NULL, mime_type TEXT NOT NULL,
    extension TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, byte_size INTEGER NOT NULL, created_at TEXT NOT NULL
  )`);
  const insert = db.prepare(`INSERT INTO cover_cache VALUES (?, ?, 'openlibrary', 'image/webp', 'webp', ?, ?, 1000, '2026-01-01T00:00:00.000Z')`);
  insert.run("11111111-1111-4111-8111-111111111111", "isbn:9780141184272", 300, 460);
  insert.run("22222222-2222-4222-8222-222222222222", "isbn:9780374520731", 800, 1200);
  insert.run("33333333-3333-4333-8333-333333333333", "kobo:c6a6a5e2-0000-4000-8000-000000000000", 600, 900);
  return db;
}

test("migration turns legacy ISBN cache rows into books and drops cover_cache", () => {
  const db = legacyDb();
  applyBooksMigrations(db);
  const repo = createSqliteBooksRepository(db);

  const low = repo.findBookByKey("isbn:9780141184272")!;
  assert.equal(low.isbn, "9780141184272");
  assert.equal(low.title, "");
  assert.equal(low.cover_image_id, "11111111-1111-4111-8111-111111111111");
  assert.equal(low.cover_status, "low_res");
  assert.equal(low.cover_checked_at, "1970-01-01T00:00:00.000Z");
  assert.equal(repo.getImage(low.cover_image_id!)!.source_url, null);

  assert.equal(repo.findBookByKey("isbn:9780374520731")!.cover_status, "good");
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM books`).get() as { n: number }).n, 2);
  assert.equal(db.prepare(`SELECT name FROM sqlite_master WHERE name = 'cover_cache'`).get(), undefined);

  applyBooksMigrations(db);
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM books`).get() as { n: number }).n, 2);
});

test("createBook returns the existing row for a key that is already taken", () => {
  const { repo } = freshRepo();
  const first = repo.createBook({ title: "Orlando", author: "Virginia Woolf", isbn: "9780141184272" }, "isbn:9780141184272", NOW);
  const second = repo.createBook({ title: "Other", author: "Other", isbn: "9780141184272" }, "isbn:9780141184272", NOW);
  assert.equal(second.id, first.id);
  assert.equal(second.title, "Orlando");
  assert.equal(repo.getBook(first.id)!.genres, "[]");
});

test("fillIdentity only fills an empty title and makes the book searchable", () => {
  const { repo } = freshRepo();
  const book = repo.createBook({ title: "", author: "", isbn: "9780141184272" }, "isbn:9780141184272", NOW);
  assert.deepEqual(repo.searchBooks(["orlando"], 12), []);
  repo.fillIdentity(book.id, "Orlando", "Virginia Woolf");
  repo.fillIdentity(book.id, "Changed", "Nobody");
  assert.equal(repo.getBook(book.id)!.title, "Orlando");
  assert.equal(repo.searchBooks(["orlando"], 12).length, 1);
});

test("search is diacritic-insensitive, requires every token and ignores an empty token list", () => {
  const { repo } = freshRepo();
  repo.createBook({ title: "Antídoto", author: "José Luís Peixoto", isbn: null }, "ta:antidoto|jose luis peixoto", NOW);
  repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593" }, "isbn:9780441013593", NOW);
  assert.equal(repo.searchBooks(["antidoto"], 12)[0]!.title, "Antídoto");
  assert.equal(repo.searchBooks(["dune", "herbert"], 12).length, 1);
  assert.equal(repo.searchBooks(["dune", "messiah"], 12).length, 0);
  assert.deepEqual(repo.searchBooks([], 12), []);
});

test("covers, rejections and details round-trip", () => {
  const { repo } = freshRepo();
  const book = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: null }, "ta:dune|frank herbert", NOW);
  repo.insertImage({ id: "img-1", book_id: book.id, source: "apple", source_url: "https://img.test/1", width: 900, height: 1400, byte_size: 10, created_at: NOW });
  repo.setCover(book.id, { imageId: "img-1", status: "good", checkedAt: NOW });
  assert.equal(repo.getBook(book.id)!.cover_image_id, "img-1");
  assert.equal(repo.getImage("img-1")!.width, 900);

  repo.addRejection(book.id, "https://img.test/1", NOW);
  repo.addRejection(book.id, "https://img.test/1", NOW);
  assert.deepEqual([...repo.listRejectedUrls(book.id)], ["https://img.test/1"]);

  repo.saveDetails(book.id, { summary: "Spice.", rating: 4.2, ratingCount: 10, sourceUrl: "https://openlibrary.org/works/OL1W", genres: ["Science Fiction"] }, NOW);
  const saved = repo.getBook(book.id)!;
  assert.equal(saved.details_status, "found");
  assert.equal(saved.summary, "Spice.");
  assert.equal(saved.genres, '["Science Fiction"]');

  repo.markDetailsMissing(book.id, NOW);
  assert.equal(repo.getBook(book.id)!.details_status, "missing");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx tsx --test src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`
Expected: FAIL — `applyBooksMigrations` is not exported.

- [ ] **Step 3: Write the implementation**

Create `backend/src/modules/books/domain/constants.ts`:

```ts
export const MIN_GOOD_WIDTH = 400;
```

Append to `backend/src/modules/books/domain/types.ts`:

```ts
export type CoverStatus = "good" | "low_res" | "missing" | "manual";
export type DetailsStatus = "found" | "missing";
export type CoverSourceName = "isbndb" | "apple" | "openlibrary" | "upload";

export interface BookRow {
  id: string;
  title: string;
  author: string;
  year: number | null;
  publisher: string | null;
  isbn: string | null;
  ol_cover_id: number | null;
  summary: string | null;
  rating: number | null;
  rating_count: number;
  genres: string;
  source_url: string | null;
  details_status: DetailsStatus | null;
  details_checked_at: string | null;
  cover_image_id: string | null;
  cover_status: CoverStatus | null;
  cover_checked_at: string | null;
  created_at: string;
}

export interface CoverImageRow {
  id: string;
  book_id: string;
  source: CoverSourceName;
  source_url: string | null;
  width: number;
  height: number;
  byte_size: number;
  created_at: string;
}

export interface NewBook {
  title: string;
  author: string;
  isbn: string | null;
  year?: number | null;
  publisher?: string | null;
  olCoverId?: number | null;
  genres?: string[];
}
```

Append to `backend/src/modules/books/domain/ports.ts` (and add `BookRow, CoverImageRow, CoverStatus, NewBook` to its type import from `./types.js`, plus `import type { BookMetadata } from "@scripta/shared";`):

```ts
export interface BooksRepository {
  findBookByKey(key: string): BookRow | undefined;
  getBook(id: string): BookRow | undefined;
  createBook(input: NewBook, key: string, createdAt: string): BookRow;
  fillIdentity(id: string, title: string, author: string): void;
  getImage(id: string): CoverImageRow | undefined;
  insertImage(row: CoverImageRow): void;
  setCover(bookId: string, cover: { imageId: string | null; status: CoverStatus | null; checkedAt: string | null }): void;
  addRejection(bookId: string, sourceUrl: string, createdAt: string): void;
  listRejectedUrls(bookId: string): Set<string>;
  saveDetails(bookId: string, details: BookMetadata, checkedAt: string): void;
  markDetailsMissing(bookId: string, checkedAt: string): void;
  searchBooks(tokens: string[], limit: number): BookRow[];
}
```

Create `backend/src/modules/books/adapters/sqlite/books.sql`:

```sql
CREATE TABLE IF NOT EXISTS books (
  id                  TEXT PRIMARY KEY,
  title               TEXT NOT NULL,
  author              TEXT NOT NULL,
  year                INTEGER,
  publisher           TEXT,
  isbn                TEXT,
  ol_cover_id         INTEGER,
  summary             TEXT,
  rating              REAL,
  rating_count        INTEGER NOT NULL DEFAULT 0,
  genres              TEXT NOT NULL DEFAULT '[]',
  source_url          TEXT,
  details_status      TEXT,
  details_checked_at  TEXT,
  cover_image_id      TEXT,
  cover_status        TEXT,
  cover_checked_at    TEXT,
  created_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS book_keys (
  key      TEXT PRIMARY KEY,
  book_id  TEXT NOT NULL REFERENCES books(id)
);

CREATE TABLE IF NOT EXISTS cover_images (
  id          TEXT PRIMARY KEY,
  book_id     TEXT NOT NULL REFERENCES books(id),
  source      TEXT NOT NULL,
  source_url  TEXT,
  width       INTEGER NOT NULL,
  height      INTEGER NOT NULL,
  byte_size   INTEGER NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cover_rejections (
  book_id     TEXT NOT NULL REFERENCES books(id),
  source_url  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (book_id, source_url)
);

CREATE VIRTUAL TABLE IF NOT EXISTS books_fts USING fts5(
  book_id UNINDEXED,
  title,
  author,
  tokenize = 'unicode61 remove_diacritics 2'
);
```

In `backend/src/modules/books/adapters/sqlite/connection.ts`, keep `openCoversDb` as it is and add (with `import { randomUUID } from "node:crypto";` and `import { MIN_GOOD_WIDTH } from "../../domain/constants.js";`):

```ts
const LEGACY_CHECKED_AT = "1970-01-01T00:00:00.000Z";

interface LegacyCoverRow {
  id: string;
  cache_key: string;
  source: string;
  width: number;
  height: number;
  byte_size: number;
  created_at: string;
}

export function applyBooksMigrations(db: DatabaseSync): void {
  db.exec(readFileSync(`${adapterDir}/books.sql`, "utf8"));
  const legacy = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'cover_cache'`).get();
  if (!legacy) return;

  const rows = db.prepare(`SELECT id, cache_key, source, width, height, byte_size, created_at FROM cover_cache`).all() as unknown as LegacyCoverRow[];
  const insertBook = db.prepare(`
    INSERT INTO books (id, title, author, isbn, cover_image_id, cover_status, cover_checked_at, created_at)
    VALUES (?, '', '', ?, ?, ?, ?, ?)
  `);
  const insertKey = db.prepare(`INSERT OR IGNORE INTO book_keys (key, book_id) VALUES (?, ?)`);
  const insertImage = db.prepare(`
    INSERT OR IGNORE INTO cover_images (id, book_id, source, source_url, width, height, byte_size, created_at)
    VALUES (?, ?, ?, NULL, ?, ?, ?, ?)
  `);

  db.exec("BEGIN");
  try {
    for (const row of rows) {
      if (!row.cache_key.startsWith("isbn:")) continue;
      const bookId = randomUUID();
      const status = row.width >= MIN_GOOD_WIDTH ? "good" : "low_res";
      insertBook.run(bookId, row.cache_key.slice("isbn:".length), row.id, status, LEGACY_CHECKED_AT, row.created_at);
      insertKey.run(row.cache_key, bookId);
      insertImage.run(row.id, bookId, row.source, row.width, row.height, row.byte_size, row.created_at);
    }
    db.exec("DROP TABLE cover_cache");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function openBooksDb(): DatabaseSync {
  mkdirSync(dirname(env.COVERS_DB_PATH), { recursive: true });
  const db = new DatabaseSync(env.COVERS_DB_PATH);
  db.exec("PRAGMA journal_mode = WAL");
  applyBooksMigrations(db);
  return db;
}
```

Legacy `kobo:` rows are skipped on purpose: their files keep serving by id, and nothing can look them up any more.

Create `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`:

```ts
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { BooksRepository } from "../../domain/ports.js";
import type { BookRow, CoverImageRow } from "../../domain/types.js";

export function createSqliteBooksRepository(db: DatabaseSync): BooksRepository {
  const byKeyStmt = db.prepare(`SELECT books.* FROM book_keys JOIN books ON books.id = book_keys.book_id WHERE book_keys.key = ?`);
  const byIdStmt = db.prepare(`SELECT * FROM books WHERE id = ?`);
  const insertBookStmt = db.prepare(`
    INSERT INTO books (id, title, author, year, publisher, isbn, ol_cover_id, genres, created_at)
    VALUES ($id, $title, $author, $year, $publisher, $isbn, $ol_cover_id, $genres, $created_at)
  `);
  const insertKeyStmt = db.prepare(`INSERT INTO book_keys (key, book_id) VALUES (?, ?)`);
  const insertFtsStmt = db.prepare(`INSERT INTO books_fts (book_id, title, author) VALUES (?, ?, ?)`);
  const fillIdentityStmt = db.prepare(`UPDATE books SET title = ?, author = ? WHERE id = ? AND title = ''`);
  const imageStmt = db.prepare(`SELECT * FROM cover_images WHERE id = ?`);
  const insertImageStmt = db.prepare(`
    INSERT INTO cover_images (id, book_id, source, source_url, width, height, byte_size, created_at)
    VALUES ($id, $book_id, $source, $source_url, $width, $height, $byte_size, $created_at)
  `);
  const setCoverStmt = db.prepare(`UPDATE books SET cover_image_id = ?, cover_status = ?, cover_checked_at = ? WHERE id = ?`);
  const addRejectionStmt = db.prepare(`INSERT OR IGNORE INTO cover_rejections (book_id, source_url, created_at) VALUES (?, ?, ?)`);
  const rejectionsStmt = db.prepare(`SELECT source_url FROM cover_rejections WHERE book_id = ?`);
  const saveDetailsStmt = db.prepare(`
    UPDATE books
    SET summary = ?, rating = ?, rating_count = ?, genres = ?, source_url = ?, details_status = 'found', details_checked_at = ?
    WHERE id = ?
  `);
  const detailsMissingStmt = db.prepare(`UPDATE books SET details_status = 'missing', details_checked_at = ? WHERE id = ?`);
  const searchStmt = db.prepare(`
    SELECT books.* FROM books_fts JOIN books ON books.id = books_fts.book_id
    WHERE books_fts MATCH ? ORDER BY bm25(books_fts) LIMIT ?
  `);

  return {
    findBookByKey: (key) => byKeyStmt.get(key) as BookRow | undefined,

    getBook: (id) => byIdStmt.get(id) as BookRow | undefined,

    createBook(input, key, createdAt) {
      const existing = byKeyStmt.get(key) as BookRow | undefined;
      if (existing) return existing;
      const id = randomUUID();
      db.exec("BEGIN");
      try {
        insertBookStmt.run({
          $id: id,
          $title: input.title,
          $author: input.author,
          $year: input.year ?? null,
          $publisher: input.publisher ?? null,
          $isbn: input.isbn,
          $ol_cover_id: input.olCoverId ?? null,
          $genres: JSON.stringify(input.genres ?? []),
          $created_at: createdAt
        });
        insertKeyStmt.run(key, id);
        if (input.title) insertFtsStmt.run(id, input.title, input.author);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return byIdStmt.get(id) as BookRow;
    },

    fillIdentity(id, title, author) {
      if (fillIdentityStmt.run(title, author, id).changes > 0) insertFtsStmt.run(id, title, author);
    },

    getImage: (id) => imageStmt.get(id) as CoverImageRow | undefined,

    insertImage(row) {
      insertImageStmt.run({
        $id: row.id,
        $book_id: row.book_id,
        $source: row.source,
        $source_url: row.source_url,
        $width: row.width,
        $height: row.height,
        $byte_size: row.byte_size,
        $created_at: row.created_at
      });
    },

    setCover(bookId, cover) {
      setCoverStmt.run(cover.imageId, cover.status, cover.checkedAt, bookId);
    },

    addRejection(bookId, sourceUrl, createdAt) {
      addRejectionStmt.run(bookId, sourceUrl, createdAt);
    },

    listRejectedUrls(bookId) {
      return new Set((rejectionsStmt.all(bookId) as Array<{ source_url: string }>).map((row) => row.source_url));
    },

    saveDetails(bookId, details, checkedAt) {
      saveDetailsStmt.run(details.summary, details.rating, details.ratingCount, JSON.stringify(details.genres), details.sourceUrl, checkedAt, bookId);
    },

    markDetailsMissing(bookId, checkedAt) {
      detailsMissingStmt.run(checkedAt, bookId);
    },

    searchBooks(tokens, limit) {
      if (tokens.length === 0) return [];
      return searchStmt.all(tokens.map((token) => `"${token}"`).join(" "), limit) as unknown as BookRow[];
    }
  };
}
```

`searchBooks` quotes each token; tokens come from `searchTokens` (Task 2) and contain only letters and digits, so no FTS syntax can reach SQLite.

Add `src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts` to the `backend/package.json` test list.

- [ ] **Step 4: Run tests and typecheck**

Run: `cd backend && npx tsx --test src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`
Expected: PASS (5 tests).
Run from the repo root: `npm run typecheck --workspace backend && npm test --workspace backend`
Expected: clean; all pass.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add backend/src/modules/books backend/package.json && /usr/bin/git commit -m "Book storage: schema, legacy cover_cache migration, repository with FTS

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Cover image pipeline and acceptance rules

**Files:**
- Create: `backend/src/modules/books/domain/images.ts`
- Create: `backend/src/modules/books/domain/images.test.ts`
- Modify: `backend/package.json` (test list)

**Interfaces:**
- Consumes: `sharp` (already a backend dependency).
- Produces:
  - `interface EncodedCover { full: Buffer; thumb: Buffer; width: number; height: number }` — `width`/`height` are the full image's encoded dimensions
  - `encodeCover(input: Buffer): Promise<EncodedCover | null>` — `null` for anything that isn't a decodable image or exceeds 8000px on a side
  - `isAcceptableCover(source: string, width: number, height: number): boolean`

- [ ] **Step 1: Write the failing test**

Create `backend/src/modules/books/domain/images.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { encodeCover, isAcceptableCover } from "./images.js";

function jpeg(width: number, height: number) {
  return sharp({ create: { width, height, channels: 3, background: "#886644" } }).jpeg().toBuffer();
}

test("a large cover is encoded as a 1600px full image and a 600x900 thumbnail", async () => {
  const encoded = await encodeCover(await jpeg(2000, 3000));
  assert.ok(encoded);
  assert.equal(encoded.width, 1067);
  assert.equal(encoded.height, 1600);
  const full = await sharp(encoded.full).metadata();
  const thumb = await sharp(encoded.thumb).metadata();
  assert.equal(full.format, "webp");
  assert.equal(thumb.format, "webp");
  assert.equal(thumb.width, 600);
  assert.equal(thumb.height, 900);
});

test("a small cover is never enlarged", async () => {
  const encoded = await encodeCover(await jpeg(300, 460));
  assert.ok(encoded);
  assert.equal(encoded.width, 300);
  assert.equal(encoded.height, 460);
  assert.equal((await sharp(encoded.thumb).metadata()).width, 300);
});

test("non-images and oversized images are refused", async () => {
  assert.equal(await encodeCover(Buffer.from("<html>not an image</html>")), null);
  assert.equal(await encodeCover(await jpeg(8001, 10)), null);
});

test("only portrait covers are acceptable", () => {
  assert.equal(isAcceptableCover("apple", 900, 1400), true);
  assert.equal(isAcceptableCover("apple", 500, 500), false);
  assert.equal(isAcceptableCover("isbndb", 1030, 773), false);
  assert.equal(isAcceptableCover("openlibrary", 100, 400), false);
});

test("ISBNdb's 200x248 placeholder is refused, the same size elsewhere is not", () => {
  assert.equal(isAcceptableCover("isbndb", 200, 248), false);
  assert.equal(isAcceptableCover("openlibrary", 200, 248), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx tsx --test src/modules/books/domain/images.test.ts`
Expected: FAIL — `Cannot find module './images.js'`.

- [ ] **Step 3: Write the implementation**

Create `backend/src/modules/books/domain/images.ts`:

```ts
import sharp from "sharp";

const MAX_INPUT_DIMENSION = 8000;
const FULL_MAX_DIMENSION = 1600;
const FULL_QUALITY = 85;
const THUMB_MAX_WIDTH = 600;
const THUMB_MAX_HEIGHT = 900;
const THUMB_QUALITY = 80;
const MIN_ASPECT_RATIO = 1.2;
const MAX_ASPECT_RATIO = 1.9;
const ISBNDB_PLACEHOLDER = { width: 200, height: 248 };

export interface EncodedCover {
  full: Buffer;
  thumb: Buffer;
  width: number;
  height: number;
}

async function decodedSize(input: Buffer): Promise<{ width: number; height: number } | null> {
  try {
    const metadata = await sharp(input).metadata();
    return metadata.width && metadata.height && metadata.format ? { width: metadata.width, height: metadata.height } : null;
  } catch {
    return null;
  }
}

export async function encodeCover(input: Buffer): Promise<EncodedCover | null> {
  const size = await decodedSize(input);
  if (!size || size.width > MAX_INPUT_DIMENSION || size.height > MAX_INPUT_DIMENSION) return null;
  const full = await sharp(input)
    .rotate()
    .resize({ width: FULL_MAX_DIMENSION, height: FULL_MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
    .webp({ quality: FULL_QUALITY })
    .toBuffer({ resolveWithObject: true });
  const thumb = await sharp(input)
    .rotate()
    .resize({ width: THUMB_MAX_WIDTH, height: THUMB_MAX_HEIGHT, fit: "inside", withoutEnlargement: true })
    .webp({ quality: THUMB_QUALITY })
    .toBuffer();
  return { full: full.data, thumb, width: full.info.width, height: full.info.height };
}

export function isAcceptableCover(source: string, width: number, height: number): boolean {
  const ratio = height / width;
  if (ratio < MIN_ASPECT_RATIO || ratio > MAX_ASPECT_RATIO) return false;
  return !(source === "isbndb" && width === ISBNDB_PLACEHOLDER.width && height === ISBNDB_PLACEHOLDER.height);
}
```

`decodedSize` catches everything `sharp(...).metadata()` throws because that call's only failure mode is "these bytes are not an image sharp can read" — the same contract the existing covers and gallery pipelines use.

Add `src/modules/books/domain/images.test.ts` to the `backend/package.json` test list.

- [ ] **Step 4: Run tests**

Run: `cd backend && npx tsx --test src/modules/books/domain/images.test.ts`
Expected: PASS (5 tests).
Run from the repo root: `npm run typecheck --workspace backend`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add backend/src/modules/books/domain/images.ts backend/src/modules/books/domain/images.test.ts backend/package.json && /usr/bin/git commit -m "Cover encoding: full + 600x900 thumbnail, portrait and placeholder rules

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: HTTP helpers, cover sources, Open Library catalog

**Files:**
- Create: `backend/src/modules/books/domain/errors.ts`
- Modify: `backend/src/modules/books/domain/ports.ts` (append source and catalog ports)
- Create: `backend/src/modules/books/adapters/http/http.ts`
- Create: `backend/src/modules/books/adapters/http/http.test.ts`
- Create: `backend/src/modules/books/adapters/sources/isbndb.ts`
- Create: `backend/src/modules/books/adapters/sources/apple.ts`
- Create: `backend/src/modules/books/adapters/sources/openLibrary.ts`
- Create: `backend/src/modules/books/adapters/sources/sources.test.ts`
- Create: `backend/src/modules/books/adapters/openlibrary/openLibraryCatalog.ts`
- Create: `backend/src/modules/books/adapters/openlibrary/openLibraryCatalog.test.ts`
- Modify: `backend/package.json` (test list)

**Interfaces:**
- Consumes: `CoverSourceName` (Task 3); `findOpenLibraryMatch`, `buildBookMetadata`, `mapOpenLibraryDoc`, `BookMetadata`, `BookSearchResult` from `@scripta/shared`.
- Produces:
  - `class SourceUnavailableError extends Error { readonly source: string }` (`domain/errors.ts`)
  - Ports: `CoverCandidate { source: Exclude<CoverSourceName, "upload">; url: string }`, `TitledCandidate extends CoverCandidate { title: string; authors: string[] }`, `CoverSource { byIsbn(isbn): Promise<CoverCandidate[]>; byTitle(title, author, accept: (c: TitledCandidate) => boolean): Promise<CoverCandidate[]> }`, `CatalogSearchHit { result: BookSearchResult; olCoverId: number | null }`, `BookCatalog { fetchDetails(lookup: { isbn: string | null; title: string; author: string }): Promise<BookMetadata | null>; search(query: { isbn: string } | { text: string }): Promise<CatalogSearchHit[]> }`
  - `type Throttle = <T>(task: () => Promise<T>) => Promise<T>`; `createThrottle(minGapMs, now?, sleep?)`; `fetchJson(source, url, headers?)`; `fetchBytes(source, url)`
  - `createIsbndbSource(apiKey: string, throttle: Throttle): CoverSource`; `parseIsbndbBooks(json: unknown): TitledCandidate[]`
  - `createAppleSource(throttle: Throttle): CoverSource`; `parseAppleResults(json: unknown): TitledCandidate[]`; `appleArtworkUrl(artworkUrl100: string): string`
  - `createOpenLibraryCoverSource(throttle: Throttle): CoverSource`
  - `createOpenLibraryCatalog(throttle: Throttle): BookCatalog`

- [ ] **Step 1: Write the failing tests**

Create `backend/src/modules/books/adapters/http/http.test.ts`:

```ts
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { SourceUnavailableError } from "../../domain/errors.js";
import { createThrottle, fetchBytes, fetchJson } from "./http.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function stub(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => handler(String(input), init)) as typeof fetch;
}

test("fetchJson parses a body, maps 404 to null and sends headers", async () => {
  let seen: Headers | undefined;
  stub((_url, init) => {
    seen = new Headers(init?.headers);
    return Response.json({ ok: true });
  });
  assert.deepEqual(await fetchJson("isbndb", "https://api.test/a", { Authorization: "k" }), { ok: true });
  assert.equal(seen?.get("Authorization"), "k");
  stub(() => new Response("", { status: 404 }));
  assert.equal(await fetchJson("isbndb", "https://api.test/a"), null);
});

test("fetchJson reports rate limits, server errors, auth errors and network failures as unavailable", async () => {
  for (const status of [429, 500, 403]) {
    stub(() => new Response("", { status }));
    await assert.rejects(fetchJson("apple", "https://api.test/a"), SourceUnavailableError);
  }
  stub(() => {
    throw new TypeError("fetch failed");
  });
  await assert.rejects(fetchJson("apple", "https://api.test/a"), SourceUnavailableError);
});

test("fetchBytes skips a missing or forbidden image but reports a server error", async () => {
  stub(() => new Response(new Uint8Array([1, 2, 3])));
  assert.deepEqual([...(await fetchBytes("apple", "https://img.test/a"))!], [1, 2, 3]);
  for (const status of [404, 403]) {
    stub(() => new Response("", { status }));
    assert.equal(await fetchBytes("apple", "https://img.test/a"), null);
  }
  stub(() => new Response("", { status: 503 }));
  await assert.rejects(fetchBytes("apple", "https://img.test/a"), SourceUnavailableError);
});

test("the throttle spaces task starts and survives a failing task", async () => {
  let clock = 0;
  const throttle = createThrottle(1000, () => clock, async (ms) => {
    clock += ms;
  });
  const starts: number[] = [];
  await Promise.all([1, 2, 3].map(() => throttle(async () => { starts.push(clock); })));
  assert.deepEqual(starts, [0, 1000, 2000]);
  await assert.rejects(throttle(async () => { throw new Error("boom"); }), /boom/);
  assert.equal(await throttle(async () => "after"), "after");
});
```

Create `backend/src/modules/books/adapters/sources/sources.test.ts`:

```ts
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { Throttle } from "../http/http.js";
import { appleArtworkUrl, createAppleSource, parseAppleResults } from "./apple.js";
import { createIsbndbSource, parseIsbndbBooks } from "./isbndb.js";
import { createOpenLibraryCoverSource } from "./openLibrary.js";

const direct: Throttle = (task) => task();
const acceptAll = () => true;
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function stub(handler: (url: string, init?: RequestInit) => Response) {
  const urls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    urls.push(String(input));
    return handler(String(input), init);
  }) as typeof fetch;
  return urls;
}

test("ISBNdb books prefer image_original and skip entries without an image", () => {
  assert.deepEqual(parseIsbndbBooks({ book: { title: "Antídoto", authors: ["José Luís Peixoto"], image: "https://i/s.jpg", image_original: "https://i/o.jpg" } }), [
    { source: "isbndb", url: "https://i/o.jpg", title: "Antídoto", authors: ["José Luís Peixoto"] }
  ]);
  assert.equal(parseIsbndbBooks({ books: [{ title: "No image" }, { title: "Small", image: "https://i/s.jpg" }] }).length, 1);
  assert.deepEqual(parseIsbndbBooks("nonsense"), []);
});

test("ISBNdb lookups send the key and treat 404 as no candidates", async () => {
  let auth: string | null = null;
  const urls = stub((_url, init) => {
    auth = new Headers(init?.headers).get("Authorization");
    return Response.json({ book: { title: "Dune", authors: ["Frank Herbert"], image_original: "https://i/o.jpg" } });
  });
  const source = createIsbndbSource("secret", direct);
  assert.deepEqual(await source.byIsbn("9780441013593"), [{ source: "isbndb", url: "https://i/o.jpg" }]);
  assert.equal(urls[0], "https://api2.isbndb.com/book/9780441013593");
  assert.equal(auth, "secret");
  stub(() => new Response("", { status: 404 }));
  assert.deepEqual(await source.byIsbn("9780441013593"), []);
});

test("ISBNdb title search keeps only accepted books", async () => {
  const urls = stub(() => Response.json({ books: [
    { title: "Dune", authors: ["Frank Herbert"], image: "https://i/1.jpg" },
    { title: "Dune Messiah", authors: ["Frank Herbert"], image: "https://i/2.jpg" }
  ] }));
  const found = await createIsbndbSource("k", direct).byTitle("Dune", "Frank Herbert", (c) => c.title === "Dune");
  assert.deepEqual(found, [{ source: "isbndb", url: "https://i/1.jpg" }]);
  assert.equal(urls[0], "https://api2.isbndb.com/books/Dune?page=1&pageSize=20&column=title");
});

test("Apple artwork is requested at 1400px", () => {
  assert.equal(appleArtworkUrl("https://is1.mzstatic.com/image/thumb/a/b.jpg/100x100bb.jpg"), "https://is1.mzstatic.com/image/thumb/a/b.jpg/1400x1400bb.jpg");
  assert.deepEqual(parseAppleResults({ results: [{ trackName: "Solaris", artistName: "Stanisław Lem", artworkUrl100: "https://x/100x100bb.png" }, { trackName: "No art" }] }), [
    { source: "apple", url: "https://x/1400x1400bb.png", title: "Solaris", authors: ["Stanisław Lem"] }
  ]);
});

test("Apple ISBN lookup walks the storefronts until one answers", async () => {
  const urls = stub((url) => Response.json(url.includes("country=pt") ? { results: [] } : { results: [{ trackName: "Orlando", artistName: "Virginia Woolf", artworkUrl100: "https://x/100x100bb.jpg" }] }));
  const found = await createAppleSource(direct).byIsbn("9780141184272");
  assert.deepEqual(found, [{ source: "apple", url: "https://x/1400x1400bb.jpg" }]);
  assert.deepEqual(urls.map((url) => new URL(url).searchParams.get("country")), ["pt", "us"]);
});

test("Apple title search sends the title alone and moves on when nothing is accepted", async () => {
  const urls = stub((url) => Response.json(url.includes("country=us")
    ? { results: [{ trackName: "A Quinta dos Animais", artistName: "George Orwell", artworkUrl100: "https://x/100x100bb.jpg" }] }
    : { results: [{ trackName: "Something else", artistName: "Nobody", artworkUrl100: "https://y/100x100bb.jpg" }] }));
  const found = await createAppleSource(direct).byTitle("A Quinta dos Animais", "Paulo Faria, George Orwell", (c) => c.title === "A Quinta dos Animais");
  assert.deepEqual(found, [{ source: "apple", url: "https://x/1400x1400bb.jpg" }]);
  const first = new URL(urls[0]!);
  assert.equal(first.searchParams.get("term"), "A Quinta dos Animais");
  assert.equal(first.searchParams.get("media"), "ebook");
});

test("Open Library ISBN covers need no API call; title search maps cover ids", async () => {
  const urls = stub(() => Response.json({ docs: [
    { title: "Dune", author_name: ["Frank Herbert"], cover_i: 42 },
    { title: "Dune", author_name: ["Frank Herbert"] }
  ] }));
  const source = createOpenLibraryCoverSource(direct);
  assert.deepEqual(await source.byIsbn("9780441013593"), [{ source: "openlibrary", url: "https://covers.openlibrary.org/b/isbn/9780441013593-L.jpg?default=false" }]);
  assert.equal(urls.length, 0);
  assert.deepEqual(await source.byTitle("Dune", "Frank Herbert", acceptAll), [{ source: "openlibrary", url: "https://covers.openlibrary.org/b/id/42-L.jpg" }]);
  assert.equal(new URL(urls[0]!).searchParams.get("author"), null);
});
```

Create `backend/src/modules/books/adapters/openlibrary/openLibraryCatalog.test.ts` (these cases move here from `frontend/scripts/test-book-metadata.mts`, which Task 11 trims):

```ts
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { SourceUnavailableError } from "../../domain/errors.js";
import type { Throttle } from "../http/http.js";
import { createOpenLibraryCatalog } from "./openLibraryCatalog.js";

const direct: Throttle = (task) => task();
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function respond(bodies: unknown[]) {
  const requests: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    requests.push(String(input));
    const body = bodies.shift();
    if (body instanceof Error) throw body;
    return Response.json(body);
  }) as typeof fetch;
  return requests;
}

const doc = { key: "/works/OL123W", title: "Ecotopia", author_name: ["Ernest Callenbach"], ratings_average: 3.8, ratings_count: 42 };

test("details come from the matching work", async () => {
  const catalog = createOpenLibraryCatalog(direct);
  const requests = respond([{ docs: [doc] }, { description: { value: "A book summary." }, subjects: ["Science fiction", "Ecology"] }]);
  assert.deepEqual(await catalog.fetchDetails({ isbn: "9780553348477", title: "Ecotopia", author: "Ernest Callenbach" }), {
    summary: "A book summary.",
    rating: 3.8,
    ratingCount: 42,
    sourceUrl: "https://openlibrary.org/works/OL123W",
    genres: ["Science Fiction"]
  });
  assert.equal(new URL(requests[0]!).searchParams.get("isbn"), "9780553348477");

  respond([{ docs: [doc] }, { description: "**Plain summary.** Source: [Wikipedia](https://en.wikipedia.org/wiki/Ecotopia)" }]);
  assert.equal((await catalog.fetchDetails({ isbn: null, title: "ECOTOPIA", author: "Ernest Callenbach" }))?.summary, "Plain summary. Source: Wikipedia");
});

test("details reject mismatches and untrusted keys", async () => {
  const catalog = createOpenLibraryCatalog(direct);
  respond([{ docs: [doc] }]);
  assert.equal(await catalog.fetchDetails({ isbn: null, title: "Different title", author: "Ernest Callenbach" }), null);
  respond([{ docs: [doc] }]);
  assert.equal(await catalog.fetchDetails({ isbn: null, title: "Ecotopia", author: "Different author" }), null);
  respond([{ docs: [{ ...doc, key: "//untrusted.test/work" }] }]);
  assert.equal(await catalog.fetchDetails({ isbn: "9780553348477", title: "", author: "" }), null);
  respond([{ docs: [] }]);
  assert.equal(await catalog.fetchDetails({ isbn: "9780553348477", title: "", author: "" }), null);
  assert.equal(await catalog.fetchDetails({ isbn: null, title: "Ecotopia", author: "" }), null);
});

test("details tolerate invalid ratings and an empty work", async () => {
  respond([{ docs: [{ ...doc, ratings_average: 8, ratings_count: -2 }] }, {}]);
  const missing = await createOpenLibraryCatalog(direct).fetchDetails({ isbn: "9780553348477", title: "", author: "" });
  assert.equal(missing?.summary, null);
  assert.equal(missing?.rating, null);
  assert.equal(missing?.ratingCount, 0);
  assert.deepEqual(missing?.genres, []);
});

test("a network failure is reported as unavailable", async () => {
  respond([new TypeError("fetch failed")]);
  await assert.rejects(createOpenLibraryCatalog(direct).fetchDetails({ isbn: "9780553348477", title: "", author: "" }), SourceUnavailableError);
});

test("search maps docs and keeps the Open Library cover id", async () => {
  const requests = respond([{ docs: [
    { key: "/works/OL1W", title: "Dune", author_name: ["Frank Herbert"], first_publish_year: 1965, isbn: ["0441013597", "9780441013593"], publisher: ["Ace"], cover_i: 7, subject: [] },
    { key: "/works/OL2W", title: "" }
  ] }]);
  const hits = await createOpenLibraryCatalog(direct).search({ text: "dune" });
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.result.isbn, "9780441013593");
  assert.equal(hits[0]!.olCoverId, 7);
  assert.equal(new URL(requests[0]!).searchParams.get("q"), "dune");

  const isbnRequests = respond([{ docs: [] }]);
  assert.deepEqual(await createOpenLibraryCatalog(direct).search({ isbn: "9780441013593" }), []);
  assert.equal(new URL(isbnRequests[0]!).searchParams.get("isbn"), "9780441013593");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx tsx --test src/modules/books/adapters/http/http.test.ts src/modules/books/adapters/sources/sources.test.ts src/modules/books/adapters/openlibrary/openLibraryCatalog.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementation**

Create `backend/src/modules/books/domain/errors.ts`:

```ts
export class SourceUnavailableError extends Error {
  constructor(readonly source: string, detail: string) {
    super(`${source} unavailable: ${detail}`);
    this.name = "SourceUnavailableError";
  }
}
```

Append to `backend/src/modules/books/domain/ports.ts` (add `CoverSourceName` to the `./types.js` import and `BookSearchResult` to the `@scripta/shared` type import):

```ts
export interface CoverCandidate {
  source: Exclude<CoverSourceName, "upload">;
  url: string;
}

export interface TitledCandidate extends CoverCandidate {
  title: string;
  authors: string[];
}

export interface CoverSource {
  byIsbn(isbn: string): Promise<CoverCandidate[]>;
  byTitle(title: string, author: string, accept: (candidate: TitledCandidate) => boolean): Promise<CoverCandidate[]>;
}

export interface CatalogSearchHit {
  result: BookSearchResult;
  olCoverId: number | null;
}

export interface BookCatalog {
  fetchDetails(lookup: { isbn: string | null; title: string; author: string }): Promise<BookMetadata | null>;
  search(query: { isbn: string } | { text: string }): Promise<CatalogSearchHit[]>;
}
```

Create `backend/src/modules/books/adapters/http/http.ts`:

```ts
import { SourceUnavailableError } from "../../domain/errors.js";

const TIMEOUT_MS = 10_000;
const USER_AGENT = "Atmyshelf/1.0 (book covers)";

export type Throttle = <T>(task: () => Promise<T>) => Promise<T>;

async function request(source: string, url: string, headers: Record<string, string> = {}): Promise<Response> {
  try {
    return await fetch(url, { headers: { "User-Agent": USER_AGENT, ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    if (error instanceof TypeError || (error instanceof Error && error.name === "TimeoutError")) {
      throw new SourceUnavailableError(source, error.message);
    }
    throw error;
  }
}

export async function fetchJson(source: string, url: string, headers?: Record<string, string>): Promise<unknown> {
  const res = await request(source, url, headers);
  if (res.status === 404) return null;
  if (!res.ok) throw new SourceUnavailableError(source, `HTTP ${res.status}`);
  try {
    return await res.json();
  } catch (error) {
    if (error instanceof SyntaxError) throw new SourceUnavailableError(source, "invalid JSON");
    throw error;
  }
}

export async function fetchBytes(source: string, url: string): Promise<Buffer | null> {
  const res = await request(source, url);
  if (res.status === 429 || res.status >= 500) throw new SourceUnavailableError(source, `HTTP ${res.status}`);
  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
}

export function createThrottle(
  minGapMs: number,
  now: () => number = Date.now,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
): Throttle {
  let tail: Promise<unknown> = Promise.resolve();
  let lastStart = Number.NEGATIVE_INFINITY;
  return <T>(task: () => Promise<T>) => {
    const run = tail.then(async () => {
      const wait = lastStart + minGapMs - now();
      if (wait > 0) await sleep(wait);
      lastStart = now();
      return task();
    });
    tail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };
}
```

Create `backend/src/modules/books/adapters/sources/isbndb.ts`:

```ts
import type { CoverCandidate, CoverSource, TitledCandidate } from "../../domain/ports.js";
import { fetchJson, type Throttle } from "../http/http.js";

const strip = ({ source, url }: TitledCandidate): CoverCandidate => ({ source, url });

export function parseIsbndbBooks(json: unknown): TitledCandidate[] {
  if (!json || typeof json !== "object") return [];
  const record = json as { book?: unknown; books?: unknown };
  const list: unknown[] = Array.isArray(record.books) ? record.books : record.book ? [record.book] : [];
  return list.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const book = item as Record<string, unknown>;
    const url = typeof book.image_original === "string" ? book.image_original : typeof book.image === "string" ? book.image : null;
    if (!url) return [];
    const authors = Array.isArray(book.authors) ? book.authors.filter((name): name is string => typeof name === "string") : [];
    return [{ source: "isbndb" as const, url, title: typeof book.title === "string" ? book.title : "", authors }];
  });
}

export function createIsbndbSource(apiKey: string, throttle: Throttle): CoverSource {
  const get = (url: string) => throttle(() => fetchJson("isbndb", url, { Authorization: apiKey }));
  return {
    async byIsbn(isbn) {
      return parseIsbndbBooks(await get(`https://api2.isbndb.com/book/${encodeURIComponent(isbn)}`)).map(strip);
    },
    async byTitle(title, _author, accept) {
      const url = `https://api2.isbndb.com/books/${encodeURIComponent(title)}?page=1&pageSize=20&column=title`;
      return parseIsbndbBooks(await get(url)).filter(accept).map(strip);
    }
  };
}
```

Create `backend/src/modules/books/adapters/sources/apple.ts`:

```ts
import type { CoverCandidate, CoverSource, TitledCandidate } from "../../domain/ports.js";
import { fetchJson, type Throttle } from "../http/http.js";

const STOREFRONTS = ["pt", "us", "br"] as const;
const SEARCH_LIMIT = "25";

const strip = ({ source, url }: TitledCandidate): CoverCandidate => ({ source, url });

export function appleArtworkUrl(artworkUrl100: string): string {
  return artworkUrl100.replace(/\/\d+x\d+bb\.(jpg|png)$/, "/1400x1400bb.$1");
}

export function parseAppleResults(json: unknown): TitledCandidate[] {
  const results = json && typeof json === "object" ? (json as { results?: unknown }).results : undefined;
  if (!Array.isArray(results)) return [];
  return results.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const result = item as Record<string, unknown>;
    if (typeof result.artworkUrl100 !== "string") return [];
    return [{
      source: "apple" as const,
      url: appleArtworkUrl(result.artworkUrl100),
      title: typeof result.trackName === "string" ? result.trackName : "",
      authors: typeof result.artistName === "string" ? [result.artistName] : []
    }];
  });
}

export function createAppleSource(throttle: Throttle): CoverSource {
  const get = (url: string) => throttle(() => fetchJson("apple", url));
  return {
    async byIsbn(isbn) {
      for (const country of STOREFRONTS) {
        const hits = parseAppleResults(await get(`https://itunes.apple.com/lookup?isbn=${encodeURIComponent(isbn)}&country=${country}`));
        if (hits.length) return hits.map(strip);
      }
      return [];
    },
    async byTitle(title, _author, accept) {
      for (const country of STOREFRONTS) {
        const params = new URLSearchParams({ term: title, media: "ebook", limit: SEARCH_LIMIT, country });
        const hits = parseAppleResults(await get(`https://itunes.apple.com/search?${params}`)).filter(accept);
        if (hits.length) return hits.map(strip);
      }
      return [];
    }
  };
}
```

Create `backend/src/modules/books/adapters/sources/openLibrary.ts`:

```ts
import type { CoverSource } from "../../domain/ports.js";
import { fetchJson, type Throttle } from "../http/http.js";

export function createOpenLibraryCoverSource(throttle: Throttle): CoverSource {
  return {
    async byIsbn(isbn) {
      return [{ source: "openlibrary", url: `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(isbn)}-L.jpg?default=false` }];
    },
    async byTitle(title, _author, accept) {
      const params = new URLSearchParams({ title, fields: "title,author_name,cover_i", limit: "20" });
      const data = await throttle(() => fetchJson("openlibrary", `https://openlibrary.org/search.json?${params}`));
      const docs = data && typeof data === "object" ? (data as { docs?: unknown }).docs : undefined;
      if (!Array.isArray(docs)) return [];
      return docs.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const doc = item as Record<string, unknown>;
        if (typeof doc.cover_i !== "number") return [];
        const candidate = {
          source: "openlibrary" as const,
          url: `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`,
          title: typeof doc.title === "string" ? doc.title : "",
          authors: Array.isArray(doc.author_name) ? doc.author_name.filter((name): name is string => typeof name === "string") : []
        };
        return accept(candidate) ? [{ source: candidate.source, url: candidate.url }] : [];
      });
    }
  };
}
```

Create `backend/src/modules/books/adapters/openlibrary/openLibraryCatalog.ts`:

```ts
import { buildBookMetadata, findOpenLibraryMatch, mapOpenLibraryDoc } from "@scripta/shared";
import type { BookCatalog } from "../../domain/ports.js";
import { fetchJson, type Throttle } from "../http/http.js";

export function createOpenLibraryCatalog(throttle: Throttle): BookCatalog {
  const get = (url: string) => throttle(() => fetchJson("openlibrary", url));
  return {
    async fetchDetails({ isbn, title, author }) {
      if (!isbn && (!title || !author)) return null;
      const query = new URLSearchParams({ fields: "key,title,author_name,ratings_average,ratings_count,subject", limit: "5" });
      if (isbn) query.set("isbn", isbn);
      else {
        query.set("title", title);
        query.set("author", author);
      }
      const match = findOpenLibraryMatch(await get(`https://openlibrary.org/search.json?${query}`), isbn ?? "", title, author);
      if (!match) return null;
      return buildBookMetadata(match, await get(`https://openlibrary.org${String(match.key)}.json`));
    },

    async search(query) {
      const params = new URLSearchParams({ fields: "key,title,author_name,first_publish_year,isbn,publisher,cover_i,subject", limit: "12" });
      if ("isbn" in query) params.set("isbn", query.isbn);
      else params.set("q", query.text);
      const data = await get(`https://openlibrary.org/search.json?${params}`);
      const docs = data && typeof data === "object" ? (data as { docs?: unknown }).docs : undefined;
      if (!Array.isArray(docs)) return [];
      return docs.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const doc = item as Record<string, unknown>;
        const result = mapOpenLibraryDoc(doc);
        return result ? [{ result, olCoverId: typeof doc.cover_i === "number" ? doc.cover_i : null }] : [];
      });
    }
  };
}
```

Add the three new test files to the `backend/package.json` test list.

- [ ] **Step 4: Run tests and typecheck**

Run: `cd backend && npx tsx --test src/modules/books/adapters/http/http.test.ts src/modules/books/adapters/sources/sources.test.ts src/modules/books/adapters/openlibrary/openLibraryCatalog.test.ts`
Expected: PASS.
Run from the repo root: `npm run typecheck --workspace backend`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add backend/src/modules/books backend/package.json && /usr/bin/git commit -m "Cover sources (ISBNdb, Apple, Open Library), OL catalog, throttled HTTP

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Cover chain resolver

**Files:**
- Create: `backend/src/modules/books/coverResolver.ts`
- Create: `backend/src/modules/books/coverResolver.test.ts`
- Modify: `backend/package.json` (test list)

**Interfaces:**
- Consumes: `CoverSource`, `CoverCandidate`, `TitledCandidate` (Task 5); `SourceUnavailableError` (Task 5); `EncodedCover`, `isAcceptableCover` (Task 4); `MIN_GOOD_WIDTH` (Task 3); `titleMatches`, `authorMatches`, `normalizeTitle` (Task 2).
- Produces:
  - `interface CoverSources { isbndb: CoverSource | null; apple: CoverSource; openlibrary: CoverSource }`
  - `type FetchCoverImage = (candidate: CoverCandidate) => Promise<EncodedCover | null>`
  - `interface FoundCover { candidate: CoverCandidate; image: EncodedCover }`
  - `interface CoverOutcome { found: FoundCover | null; complete: boolean }`
  - `findBestCover(book: { isbn: string | null; title: string; author: string }, rejected: Set<string>, sources: CoverSources, fetchImage: FetchCoverImage): Promise<CoverOutcome>`

- [ ] **Step 1: Write the failing test**

Create `backend/src/modules/books/coverResolver.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { findBestCover, type CoverSources, type FetchCoverImage } from "./coverResolver.js";
import { SourceUnavailableError } from "./domain/errors.js";
import type { CoverCandidate, CoverSource, TitledCandidate } from "./domain/ports.js";

const orlando = { isbn: "9780141184272", title: "Orlando (Penguin Modern Classics)", author: "Virginia Woolf" };

function source(options: { isbn?: CoverCandidate[] | Error; titled?: TitledCandidate[] | Error } = {}): CoverSource & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async byIsbn(isbn) {
      calls.push(`isbn:${isbn}`);
      if (options.isbn instanceof Error) throw options.isbn;
      return options.isbn ?? [];
    },
    async byTitle(title, _author, accept) {
      calls.push(`title:${title}`);
      if (options.titled instanceof Error) throw options.titled;
      return (options.titled ?? []).filter(accept).map(({ source, url }) => ({ source, url }));
    }
  };
}

function images(sizes: Record<string, [number, number]>): FetchCoverImage {
  return async (candidate) => {
    const size = sizes[candidate.url];
    return size ? { full: Buffer.alloc(8), thumb: Buffer.alloc(4), width: size[0], height: size[1] } : null;
  };
}

function sources(partial: Partial<CoverSources>): CoverSources {
  return { isbndb: null, apple: source(), openlibrary: source(), ...partial };
}

test("the first good cover in chain order wins and later sources are not asked", async () => {
  const isbndb = source({ isbn: [{ source: "isbndb", url: "https://i/1" }] });
  const apple = source({ isbn: [{ source: "apple", url: "https://a/1" }] });
  const outcome = await findBestCover(orlando, new Set(), sources({ isbndb, apple }), images({ "https://i/1": [900, 1400], "https://a/1": [900, 1400] }));
  assert.equal(outcome.found?.candidate.url, "https://i/1");
  assert.equal(outcome.complete, true);
  assert.deepEqual(apple.calls, []);
});

test("a later good cover beats earlier small ones", async () => {
  const outcome = await findBestCover(orlando, new Set(), sources({
    openlibrary: source({ isbn: [{ source: "openlibrary", url: "https://o/1" }] }),
    apple: source({ titled: [{ source: "apple", url: "https://a/2", title: "Orlando", authors: ["Virginia Woolf"] }] })
  }), images({ "https://o/1": [300, 460], "https://a/2": [900, 1400] }));
  assert.equal(outcome.found?.candidate.url, "https://a/2");
});

test("when nothing reaches 400px the largest acceptable image is kept", async () => {
  const outcome = await findBestCover(orlando, new Set(), sources({
    isbndb: source({ isbn: [{ source: "isbndb", url: "https://i/1" }] }),
    openlibrary: source({ isbn: [{ source: "openlibrary", url: "https://o/1" }] })
  }), images({ "https://i/1": [250, 390], "https://o/1": [320, 480] }));
  assert.equal(outcome.found?.candidate.url, "https://o/1");
  assert.equal(outcome.complete, true);
});

test("rejected URLs, non-portrait images and the ISBNdb placeholder are skipped", async () => {
  const outcome = await findBestCover(orlando, new Set(["https://i/rejected"]), sources({
    isbndb: source({ isbn: [{ source: "isbndb", url: "https://i/rejected" }, { source: "isbndb", url: "https://i/placeholder" }, { source: "isbndb", url: "https://i/landscape" }] }),
    openlibrary: source({ isbn: [{ source: "openlibrary", url: "https://o/1" }] })
  }), images({ "https://i/rejected": [900, 1400], "https://i/placeholder": [200, 248], "https://i/landscape": [1030, 773], "https://o/1": [320, 480] }));
  assert.equal(outcome.found?.candidate.url, "https://o/1");
});

test("title candidates must match title and any listed author", async () => {
  const book = { isbn: null, title: "A Quinta dos Animais", author: "Paulo Faria, George Orwell" };
  const outcome = await findBestCover(book, new Set(), sources({
    apple: source({ titled: [
      { source: "apple", url: "https://a/near", title: "A Quinta dos Animais e Outros", authors: ["George Orwell"] },
      { source: "apple", url: "https://a/right", title: "A Quinta dos Animais", authors: ["George Orwell"] }
    ] })
  }), images({ "https://a/near": [900, 1400], "https://a/right": [900, 1400] }));
  assert.equal(outcome.found?.candidate.url, "https://a/right");
});

test("an unavailable source marks the outcome incomplete and the chain continues", async () => {
  const outcome = await findBestCover(orlando, new Set(), sources({
    isbndb: source({ isbn: new SourceUnavailableError("isbndb", "HTTP 429") }),
    openlibrary: source({ isbn: [{ source: "openlibrary", url: "https://o/1" }] })
  }), images({ "https://o/1": [320, 480] }));
  assert.equal(outcome.found?.candidate.url, "https://o/1");
  assert.equal(outcome.complete, false);
});

test("an image download that is unavailable also marks the outcome incomplete", async () => {
  const fetchImage: FetchCoverImage = async () => {
    throw new SourceUnavailableError("apple", "HTTP 503");
  };
  const outcome = await findBestCover(orlando, new Set(), sources({ apple: source({ isbn: [{ source: "apple", url: "https://a/1" }] }) }), fetchImage);
  assert.deepEqual(outcome, { found: null, complete: false });
});

test("unexpected errors propagate", async () => {
  await assert.rejects(findBestCover(orlando, new Set(), sources({ apple: source({ isbn: new Error("bug") }) }), images({})), /bug/);
});

test("without an ISBN only title steps run; an empty title runs nothing", async () => {
  const apple = source();
  await findBestCover({ isbn: null, title: "Solaris", author: "Stanisław Lem" }, new Set(), sources({ apple }), images({}));
  assert.deepEqual(apple.calls, ["title:Solaris"]);
  const idle = source();
  assert.deepEqual(await findBestCover({ isbn: null, title: "?!", author: "" }, new Set(), sources({ apple: idle }), images({})), { found: null, complete: true });
  assert.deepEqual(idle.calls, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx tsx --test src/modules/books/coverResolver.test.ts`
Expected: FAIL — `Cannot find module './coverResolver.js'`.

- [ ] **Step 3: Write the implementation**

Create `backend/src/modules/books/coverResolver.ts`:

```ts
import { MIN_GOOD_WIDTH } from "./domain/constants.js";
import { SourceUnavailableError } from "./domain/errors.js";
import { isAcceptableCover, type EncodedCover } from "./domain/images.js";
import { authorMatches, normalizeTitle, titleMatches } from "./domain/normalize.js";
import type { CoverCandidate, CoverSource, TitledCandidate } from "./domain/ports.js";

const CANDIDATES_PER_STEP = 3;

export interface CoverSources {
  isbndb: CoverSource | null;
  apple: CoverSource;
  openlibrary: CoverSource;
}

export type FetchCoverImage = (candidate: CoverCandidate) => Promise<EncodedCover | null>;

export interface FoundCover {
  candidate: CoverCandidate;
  image: EncodedCover;
}

export interface CoverOutcome {
  found: FoundCover | null;
  complete: boolean;
}

async function attempt<T>(step: () => Promise<T>): Promise<T | SourceUnavailableError> {
  try {
    return await step();
  } catch (error) {
    if (error instanceof SourceUnavailableError) return error;
    throw error;
  }
}

export async function findBestCover(
  book: { isbn: string | null; title: string; author: string },
  rejected: Set<string>,
  sources: CoverSources,
  fetchImage: FetchCoverImage
): Promise<CoverOutcome> {
  const accept = (candidate: TitledCandidate) => titleMatches(book.title, candidate.title) && authorMatches(book.author, candidate.authors);
  const exactOrder = [sources.isbndb, sources.apple, sources.openlibrary].filter((source): source is CoverSource => source !== null);
  const titleOrder = [sources.apple, sources.isbndb, sources.openlibrary].filter((source): source is CoverSource => source !== null);
  const steps: Array<() => Promise<CoverCandidate[]>> = [];
  const isbn = book.isbn;
  if (isbn) steps.push(...exactOrder.map((source) => () => source.byIsbn(isbn)));
  if (normalizeTitle(book.title)) steps.push(...titleOrder.map((source) => () => source.byTitle(book.title, book.author, accept)));

  let best: FoundCover | null = null;
  let complete = true;
  for (const step of steps) {
    const candidates = await attempt(step);
    if (candidates instanceof SourceUnavailableError) {
      complete = false;
      continue;
    }
    for (const candidate of candidates.filter((c) => !rejected.has(c.url)).slice(0, CANDIDATES_PER_STEP)) {
      const image = await attempt(() => fetchImage(candidate));
      if (image instanceof SourceUnavailableError) {
        complete = false;
        continue;
      }
      if (!image || !isAcceptableCover(candidate.source, image.width, image.height)) continue;
      if (image.width >= MIN_GOOD_WIDTH) return { found: { candidate, image }, complete: true };
      if (!best || image.width > best.image.width) best = { candidate, image };
    }
  }
  return { found: best, complete };
}
```

Add `src/modules/books/coverResolver.test.ts` to the `backend/package.json` test list.

- [ ] **Step 4: Run tests**

Run: `cd backend && npx tsx --test src/modules/books/coverResolver.test.ts`
Expected: PASS (9 tests).
Run from the repo root: `npm run typecheck --workspace backend`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add backend/src/modules/books/coverResolver.ts backend/src/modules/books/coverResolver.test.ts backend/package.json && /usr/bin/git commit -m "Cover chain: exact edition then same book, first >=400px wins

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Worker queue and the service's cover flow

**Files:**
- Create: `backend/src/modules/books/worker.ts`
- Create: `backend/src/modules/books/worker.test.ts`
- Create: `backend/src/modules/books/booksService.ts`
- Create: `backend/src/modules/books/booksService.test.ts`
- Modify: `backend/package.json` (test list)

**Interfaces:**
- Consumes: `BooksRepository`, `CoverBlobStore` (existing port), `BookCatalog` (Tasks 3, 5); `findBestCover`, `CoverSources`, `FetchCoverImage` (Task 6); `lookupIdentity`, `BookLookup` (Task 2); `MIN_GOOD_WIDTH`; `EncodedCover` (Task 4).
- Produces:
  - `createCoverWorker(processBook: (bookId: string) => Promise<void>, onError: (error: unknown, bookId: string) => void): CoverWorker` with `enqueue(bookId, front?)`, `idle(): Promise<void>`, `stop()`
  - `type CoverFileSize = "file" | "thumb"`
  - `interface ResolvedCover { url: string | null; fullUrl: string | null; pending: boolean }`
  - `interface BooksServiceDeps { repo; blobs; sources; catalog; fetchImage; enqueue: (bookId: string, front?: boolean) => void; publicUrlFor: (imageId: string, size: CoverFileSize) => string; adminUserId: string; now?: () => Date }`
  - `createBooksService(deps): BooksService` with (this task) `resolveCover(lookup: BookLookup): ResolvedCover`, `processBook(bookId: string): Promise<void>`, `getCoverFile(id: string, size: CoverFileSize): { buffer: Buffer; mimeType: string } | null`

- [ ] **Step 1: Write the failing worker test**

Create `backend/src/modules/books/worker.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { createCoverWorker } from "./worker.js";

test("books are processed in order, a front entry jumps the queue, and duplicates are dropped", async () => {
  const seen: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const worker = createCoverWorker(async (id) => {
    if (id === "a") await gate;
    seen.push(id);
  }, () => {});
  worker.enqueue("a");
  worker.enqueue("b");
  worker.enqueue("c");
  worker.enqueue("b");
  worker.enqueue("c", true);
  release();
  await worker.idle();
  assert.deepEqual(seen, ["a", "c", "b"]);
});

test("enqueueing a queued book does not duplicate it", async () => {
  const seen: string[] = [];
  const worker = createCoverWorker(async (id) => { seen.push(id); }, () => {});
  for (let i = 0; i < 5; i++) worker.enqueue("same");
  await worker.idle();
  assert.deepEqual(seen, ["same"]);
});

test("an error in one book is reported and the queue keeps draining", async () => {
  const seen: string[] = [];
  const errors: Array<[unknown, string]> = [];
  const worker = createCoverWorker(async (id) => {
    if (id === "bad") throw new Error("disk full");
    seen.push(id);
  }, (error, id) => errors.push([error, id]));
  worker.enqueue("bad");
  worker.enqueue("good");
  await worker.idle();
  assert.deepEqual(seen, ["good"]);
  assert.equal(errors[0]![1], "bad");
});

test("a book re-enqueued while it is being processed runs once more afterwards", async () => {
  let runs = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const worker = createCoverWorker(async () => {
    runs++;
    if (runs === 1) await gate;
  }, () => {});
  worker.enqueue("x");
  worker.enqueue("x", true);
  release();
  await worker.idle();
  assert.equal(runs, 2);
});

test("stop clears the queue and ignores new work", async () => {
  const seen: string[] = [];
  const worker = createCoverWorker(async (id) => { seen.push(id); }, () => {});
  worker.stop();
  worker.enqueue("a");
  await worker.idle();
  assert.deepEqual(seen, []);
});
```

- [ ] **Step 2: Write the failing service test**

Create `backend/src/modules/books/booksService.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "books-service-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.GALLERY_STORAGE_PATH = join(scratch, "gallery-files");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.COVERS_STORAGE_PATH = join(scratch, "covers-files");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("./adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("./adapters/sqlite/sqliteBooksRepository.js");
const { createBooksService } = await import("./booksService.js");
const { SourceUnavailableError } = await import("./domain/errors.js");

type Deps = Parameters<typeof createBooksService>[0];
type CoverSource = Deps["sources"]["apple"];

const DAY = 24 * 60 * 60 * 1000;
const orlando = { isbn: "9780141184272", title: "Orlando", author: "Virginia Woolf" };
const emptySource: CoverSource = { byIsbn: async () => [], byTitle: async () => [] };

function isbnSource(url: string, calls?: string[]): CoverSource {
  return {
    byIsbn: async (isbn) => {
      calls?.push(isbn);
      return [{ source: "apple", url }];
    },
    byTitle: async () => []
  };
}

function harness(overrides: Partial<Deps> = {}) {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  const repo = createSqliteBooksRepository(db);
  const files = new Map<string, Buffer>();
  const blobs = {
    save: (id: string, extension: string, bytes: Buffer) => { files.set(`${id}.${extension}`, bytes); },
    read: (id: string, extension: string) => files.get(`${id}.${extension}`) ?? null
  };
  const enqueued: Array<{ bookId: string; front: boolean }> = [];
  let clock = Date.parse("2026-10-01T00:00:00.000Z");
  const sizes = new Map<string, [number, number]>();
  const service = createBooksService({
    repo,
    blobs,
    sources: { isbndb: null, apple: emptySource, openlibrary: emptySource },
    catalog: {
      fetchDetails: async () => { throw new Error("catalog not expected"); },
      search: async () => { throw new Error("catalog not expected"); }
    },
    fetchImage: async (candidate) => {
      const size = sizes.get(candidate.url);
      return size ? { full: Buffer.from(`full:${candidate.url}`), thumb: Buffer.from(`thumb:${candidate.url}`), width: size[0], height: size[1] } : null;
    },
    enqueue: (bookId, front = false) => { enqueued.push({ bookId, front }); },
    publicUrlFor: (id, size) => `https://api.test/covers/cached/${id}/${size}`,
    adminUserId: "",
    now: () => new Date(clock),
    ...overrides
  });
  const bookId = (key: string) => repo.findBookByKey(key)!.id;
  return { db, repo, files, sizes, enqueued, service, bookId, advance: (ms: number) => { clock += ms; } };
}

test("a new book answers pending and repeat requests reuse the same row", () => {
  const { service, enqueued, db } = harness();
  assert.deepEqual(service.resolveCover(orlando), { url: null, fullUrl: null, pending: true });
  assert.deepEqual(service.resolveCover(orlando), { url: null, fullUrl: null, pending: true });
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM books`).get() as { n: number }).n, 1);
  assert.equal(enqueued.length, 2);
  assert.equal(enqueued[0]!.bookId, enqueued[1]!.bookId);
});

test("processing stores the first good cover; resolve serves thumb and full URLs", async () => {
  const h = harness({ sources: { isbndb: null, apple: isbnSource("https://a/1"), openlibrary: emptySource } });
  h.sizes.set("https://a/1", [900, 1400]);
  h.service.resolveCover(orlando);
  await h.service.processBook(h.bookId("isbn:9780141184272"));
  const cover = h.service.resolveCover(orlando);
  assert.equal(cover.pending, false);
  const imageId = h.repo.findBookByKey("isbn:9780141184272")!.cover_image_id!;
  assert.equal(cover.url, `https://api.test/covers/cached/${imageId}/thumb`);
  assert.equal(cover.fullUrl, `https://api.test/covers/cached/${imageId}/file`);
  assert.equal(h.repo.findBookByKey("isbn:9780141184272")!.cover_status, "good");
  assert.ok(h.files.has(`${imageId}.webp`));
  assert.ok(h.files.has(`${imageId}-thumb.webp`));
  assert.equal(h.repo.getImage(imageId)!.source_url, "https://a/1");
});

test("a complete miss is remembered for 30 days", async () => {
  const h = harness();
  h.service.resolveCover(orlando);
  await h.service.processBook(h.bookId("isbn:9780141184272"));
  assert.equal(h.repo.findBookByKey("isbn:9780141184272")!.cover_status, "missing");
  h.enqueued.length = 0;
  assert.deepEqual(h.service.resolveCover(orlando), { url: null, fullUrl: null, pending: false });
  assert.equal(h.enqueued.length, 0);
  h.advance(30 * DAY);
  assert.equal(h.service.resolveCover(orlando).pending, true);
  assert.equal(h.enqueued.length, 1);
});

test("a low-res cover is served and upgraded only after 30 days", async () => {
  const h = harness({ sources: { isbndb: null, apple: isbnSource("https://a/small"), openlibrary: emptySource } });
  h.sizes.set("https://a/small", [300, 460]);
  h.service.resolveCover(orlando);
  await h.service.processBook(h.bookId("isbn:9780141184272"));
  assert.equal(h.repo.findBookByKey("isbn:9780141184272")!.cover_status, "low_res");
  h.enqueued.length = 0;
  assert.notEqual(h.service.resolveCover(orlando).url, null);
  assert.equal(h.enqueued.length, 0);
  h.advance(30 * DAY);
  assert.notEqual(h.service.resolveCover(orlando).url, null);
  assert.equal(h.enqueued.length, 1);
});

test("a better image replaces the pointer and keeps the old file", async () => {
  const h = harness({ sources: { isbndb: null, apple: isbnSource("https://a/small"), openlibrary: emptySource } });
  h.sizes.set("https://a/small", [300, 460]);
  h.service.resolveCover(orlando);
  const id = h.bookId("isbn:9780141184272");
  await h.service.processBook(id);
  const oldImage = h.repo.getBook(id)!.cover_image_id!;
  h.sizes.set("https://a/small", [900, 1400]);
  await h.service.processBook(id);
  const newImage = h.repo.getBook(id)!.cover_image_id!;
  assert.notEqual(newImage, oldImage);
  assert.ok(h.files.has(`${oldImage}.webp`));
  assert.equal(h.repo.getBook(id)!.cover_status, "good");
});

test("an unavailable source records no miss and backs off for 10 minutes", async () => {
  const failing: CoverSource = { byIsbn: async () => { throw new SourceUnavailableError("apple", "HTTP 429"); }, byTitle: async () => [] };
  const h = harness({ sources: { isbndb: null, apple: failing, openlibrary: emptySource } });
  h.service.resolveCover(orlando);
  await h.service.processBook(h.bookId("isbn:9780141184272"));
  const book = h.repo.findBookByKey("isbn:9780141184272")!;
  assert.equal(book.cover_status, null);
  assert.equal(book.cover_checked_at, null);
  h.enqueued.length = 0;
  assert.equal(h.service.resolveCover(orlando).pending, false);
  assert.equal(h.enqueued.length, 0);
  h.advance(10 * 60 * 1000);
  assert.equal(h.service.resolveCover(orlando).pending, true);
});

test("a low-res image found while a source was down is stored without advancing the check time", async () => {
  const failing: CoverSource = { byIsbn: async () => { throw new SourceUnavailableError("apple", "HTTP 429"); }, byTitle: async () => [] };
  const h = harness({ sources: { isbndb: null, apple: failing, openlibrary: isbnSource("https://o/1") } });
  h.sizes.set("https://o/1", [320, 480]);
  h.service.resolveCover(orlando);
  await h.service.processBook(h.bookId("isbn:9780141184272"));
  const book = h.repo.findBookByKey("isbn:9780141184272")!;
  assert.notEqual(book.cover_image_id, null);
  assert.equal(book.cover_status, "low_res");
  assert.equal(book.cover_checked_at, null);
});

test("manual covers are never processed", async () => {
  const calls: string[] = [];
  const h = harness({ sources: { isbndb: null, apple: isbnSource("https://a/1", calls), openlibrary: emptySource } });
  h.service.resolveCover(orlando);
  const id = h.bookId("isbn:9780141184272");
  h.repo.setCover(id, { imageId: "uploaded", status: "manual", checkedAt: "2026-10-01T00:00:00.000Z" });
  await h.service.processBook(id);
  assert.deepEqual(calls, []);
  assert.equal(h.repo.getBook(id)!.cover_image_id, "uploaded");
});

test("an EPUB urn:uuid ISBN falls back to the title key", () => {
  const h = harness();
  h.service.resolveCover({ isbn: "urn:uuid:ac11a7ae-d21e-42bb-8cfe-b85022867ac4", title: "The Stranger", author: "Albert Camus" });
  const book = h.repo.findBookByKey("ta:the stranger|albert camus");
  assert.ok(book);
  assert.equal(book.isbn, null);
});

test("a title that normalizes to nothing creates no book", () => {
  const h = harness();
  assert.deepEqual(h.service.resolveCover({ title: "?!" }), { url: null, fullUrl: null, pending: false });
  assert.equal((h.db.prepare(`SELECT COUNT(*) AS n FROM books`).get() as { n: number }).n, 0);
  assert.equal(h.enqueued.length, 0);
});

test("a migrated book with no title gets its title from the first lookup that has one", () => {
  const h = harness();
  h.repo.createBook({ title: "", author: "", isbn: "9780141184272" }, "isbn:9780141184272", "2026-01-01T00:00:00.000Z");
  h.service.resolveCover(orlando);
  assert.equal(h.repo.findBookByKey("isbn:9780141184272")!.title, "Orlando");
});

test("getCoverFile serves the thumbnail and falls back to the full file", () => {
  const h = harness();
  h.files.set("legacy.webp", Buffer.from("legacy"));
  assert.equal(h.service.getCoverFile("legacy", "thumb")!.buffer.toString(), "legacy");
  assert.equal(h.service.getCoverFile("legacy", "file")!.mimeType, "image/webp");
  assert.equal(h.service.getCoverFile("unknown", "file"), null);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend && npx tsx --test src/modules/books/worker.test.ts src/modules/books/booksService.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Write the implementation**

Create `backend/src/modules/books/worker.ts`:

```ts
export interface CoverWorker {
  enqueue(bookId: string, front?: boolean): void;
  idle(): Promise<void>;
  stop(): void;
}

export function createCoverWorker(
  processBook: (bookId: string) => Promise<void>,
  onError: (error: unknown, bookId: string) => void
): CoverWorker {
  const queue: string[] = [];
  const queued = new Set<string>();
  const requeue = new Set<string>();
  let current: string | null = null;
  let draining: Promise<void> | null = null;
  let stopped = false;

  async function drain() {
    while (queue.length > 0 && !stopped) {
      const bookId = queue.shift()!;
      queued.delete(bookId);
      current = bookId;
      try {
        await processBook(bookId);
      } catch (error) {
        onError(error, bookId);
      } finally {
        current = null;
      }
      if (requeue.delete(bookId) && !queued.has(bookId)) {
        queued.add(bookId);
        queue.unshift(bookId);
      }
    }
    draining = null;
  }

  return {
    enqueue(bookId, front = false) {
      if (stopped) return;
      if (bookId === current) {
        requeue.add(bookId);
        return;
      }
      if (queued.has(bookId)) {
        if (!front) return;
        queue.splice(queue.indexOf(bookId), 1);
      } else {
        queued.add(bookId);
      }
      if (front) queue.unshift(bookId);
      else queue.push(bookId);
      draining ??= drain();
    },

    idle() {
      return draining ?? Promise.resolve();
    },

    stop() {
      stopped = true;
      queue.length = 0;
      queued.clear();
      requeue.clear();
    }
  };
}
```

The `catch` in `drain` deliberately catches everything: the worker is a background loop, so any failure for one book is handed to `onError` (the plugin logs it) and the next book still runs.

Create `backend/src/modules/books/booksService.ts`:

```ts
import { randomUUID } from "node:crypto";
import { findBestCover, type CoverSources, type FetchCoverImage } from "./coverResolver.js";
import { MIN_GOOD_WIDTH } from "./domain/constants.js";
import type { EncodedCover } from "./domain/images.js";
import { lookupIdentity, type BookLookup } from "./domain/normalize.js";
import type { BookCatalog, BooksRepository, CoverBlobStore } from "./domain/ports.js";
import type { BookRow, CoverSourceName, CoverStatus } from "./domain/types.js";

const RETRY_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
const UNAVAILABLE_BACKOFF_MS = 10 * 60 * 1000;
const COVER_EXTENSION = "webp";
const COVER_MIME_TYPE = "image/webp";
const NO_COVER: ResolvedCover = { url: null, fullUrl: null, pending: false };

export type CoverFileSize = "file" | "thumb";

export interface ResolvedCover {
  url: string | null;
  fullUrl: string | null;
  pending: boolean;
}

export interface BooksServiceDeps {
  repo: BooksRepository;
  blobs: CoverBlobStore;
  sources: CoverSources;
  catalog: BookCatalog;
  fetchImage: FetchCoverImage;
  enqueue: (bookId: string, front?: boolean) => void;
  publicUrlFor: (imageId: string, size: CoverFileSize) => string;
  adminUserId: string;
  now?: () => Date;
}

export interface BooksService {
  resolveCover(lookup: BookLookup): ResolvedCover;
  processBook(bookId: string): Promise<void>;
  getCoverFile(id: string, size: CoverFileSize): { buffer: Buffer; mimeType: string } | null;
}

export function createBooksService(deps: BooksServiceDeps): BooksService {
  const now = deps.now ?? (() => new Date());
  const backoffUntil = new Map<string, number>();

  const olderThan = (iso: string | null, ms: number) => iso === null || now().getTime() - Date.parse(iso) >= ms;

  function findOrCreate(lookup: BookLookup): BookRow | null {
    const identity = lookupIdentity(lookup);
    if (!identity) return null;
    const existing = deps.repo.findBookByKey(identity.key);
    if (!existing) {
      return deps.repo.createBook({ title: identity.title, author: identity.author, isbn: identity.isbn }, identity.key, now().toISOString());
    }
    if (!existing.title && identity.title) {
      deps.repo.fillIdentity(existing.id, identity.title, identity.author);
      return deps.repo.getBook(existing.id) ?? existing;
    }
    return existing;
  }

  function coverOf(book: BookRow): ResolvedCover {
    if (!book.cover_image_id) return NO_COVER;
    return {
      url: deps.publicUrlFor(book.cover_image_id, "thumb"),
      fullUrl: deps.publicUrlFor(book.cover_image_id, "file"),
      pending: false
    };
  }

  function schedule(bookId: string): boolean {
    if ((backoffUntil.get(bookId) ?? 0) > now().getTime()) return false;
    deps.enqueue(bookId);
    return true;
  }

  function storeImage(bookId: string, source: CoverSourceName, sourceUrl: string | null, image: EncodedCover, at: string): string {
    const id = randomUUID();
    deps.blobs.save(id, COVER_EXTENSION, image.full);
    deps.blobs.save(`${id}-thumb`, COVER_EXTENSION, image.thumb);
    deps.repo.insertImage({ id, book_id: bookId, source, source_url: sourceUrl, width: image.width, height: image.height, byte_size: image.full.byteLength, created_at: at });
    return id;
  }

  return {
    resolveCover(lookup) {
      const book = findOrCreate(lookup);
      if (!book) return NO_COVER;
      if (book.cover_image_id) {
        if (book.cover_status === "low_res" && olderThan(book.cover_checked_at, RETRY_AFTER_MS)) schedule(book.id);
        return coverOf(book);
      }
      if (book.cover_status === "missing" && !olderThan(book.cover_checked_at, RETRY_AFTER_MS)) return NO_COVER;
      return { url: null, fullUrl: null, pending: schedule(book.id) };
    },

    async processBook(bookId) {
      const book = deps.repo.getBook(bookId);
      if (!book || book.cover_status === "manual") return;
      const outcome = await findBestCover({ isbn: book.isbn, title: book.title, author: book.author }, deps.repo.listRejectedUrls(bookId), deps.sources, deps.fetchImage);

      const latest = deps.repo.getBook(bookId);
      if (!latest || latest.cover_status === "manual") return;
      const current = latest.cover_image_id ? deps.repo.getImage(latest.cover_image_id) : undefined;
      const at = now().toISOString();
      let imageId = latest.cover_image_id;
      let width = current?.width ?? 0;
      if (outcome.found && outcome.found.image.width > width) {
        imageId = storeImage(bookId, outcome.found.candidate.source, outcome.found.candidate.url, outcome.found.image, at);
        width = outcome.found.image.width;
      }
      const status: CoverStatus = imageId === null ? "missing" : width >= MIN_GOOD_WIDTH ? "good" : "low_res";

      if (outcome.complete) {
        backoffUntil.delete(bookId);
        deps.repo.setCover(bookId, { imageId, status, checkedAt: at });
        return;
      }
      backoffUntil.set(bookId, now().getTime() + UNAVAILABLE_BACKOFF_MS);
      if (imageId !== latest.cover_image_id) deps.repo.setCover(bookId, { imageId, status, checkedAt: latest.cover_checked_at });
    },

    getCoverFile(id, size) {
      const buffer = size === "thumb"
        ? deps.blobs.read(`${id}-thumb`, COVER_EXTENSION) ?? deps.blobs.read(id, COVER_EXTENSION)
        : deps.blobs.read(id, COVER_EXTENSION);
      return buffer ? { buffer, mimeType: COVER_MIME_TYPE } : null;
    }
  };
}
```

Add `src/modules/books/worker.test.ts` and `src/modules/books/booksService.test.ts` to the `backend/package.json` test list.

- [ ] **Step 5: Run tests and typecheck**

Run: `cd backend && npx tsx --test src/modules/books/worker.test.ts src/modules/books/booksService.test.ts`
Expected: PASS (5 + 12 tests).
Run from the repo root: `npm run typecheck --workspace backend`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add backend/src/modules/books backend/package.json && /usr/bin/git commit -m "Background cover worker and the books service's resolve/process flow

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Service — details and local-first search

**Files:**
- Modify: `backend/src/modules/books/booksService.ts`
- Modify: `backend/src/modules/books/booksService.test.ts` (append)

**Interfaces:**
- Consumes: `BookCatalog`, `CatalogSearchHit` (Task 5); `searchTokens`, `lookupIdentity` (Task 2); `looksLikeIsbnQuery`, `normalizeIsbn`, `BookMetadata`, `BookSearchResult`, `BookGenre` from `@scripta/shared`.
- Produces (added to `BooksService`):
  - `getDetails(lookup: BookLookup): Promise<BookMetadata | null>` — throws `SourceUnavailableError` from the catalog
  - `search(query: string): Promise<BookSearchResult[]>` — throws `SourceUnavailableError` from the catalog

- [ ] **Step 1: Write the failing tests**

Append to `backend/src/modules/books/booksService.test.ts`:

```ts
type Catalog = Deps["catalog"];

function recordingCatalog(overrides: Partial<Catalog> = {}) {
  const calls: string[] = [];
  const catalog: Catalog = {
    fetchDetails: async (lookup) => {
      calls.push(`details:${lookup.isbn ?? lookup.title}`);
      return { summary: "Spice.", rating: 4.2, ratingCount: 10, sourceUrl: "https://openlibrary.org/works/OL1W", genres: ["Science Fiction"] };
    },
    search: async (query) => {
      calls.push("isbn" in query ? `search-isbn:${query.isbn}` : `search:${query.text}`);
      return [
        { result: { title: "Dune", authors: ["Frank Herbert"], year: 1965, isbn: "9780441013593", publisher: "Ace", coverUrl: "https://covers.openlibrary.org/b/id/7-M.jpg", genres: [] }, olCoverId: 7 },
        { result: { title: "Dune Encyclopedia", authors: ["Willis E. McNelly"], year: 1984, isbn: null, publisher: null, coverUrl: null, genres: [] }, olCoverId: null }
      ];
    },
    ...overrides
  };
  return { calls, catalog };
}

const dune = { isbn: "9780441013593", title: "Dune", author: "Frank Herbert" };

test("details are fetched once and then served from the database", async () => {
  const { calls, catalog } = recordingCatalog();
  const h = harness({ catalog });
  assert.equal((await h.service.getDetails(dune))?.summary, "Spice.");
  assert.deepEqual(await h.service.getDetails(dune), { summary: "Spice.", rating: 4.2, ratingCount: 10, sourceUrl: "https://openlibrary.org/works/OL1W", genres: ["Science Fiction"] });
  assert.deepEqual(calls, ["details:9780441013593"]);
});

test("a details miss is remembered for 30 days", async () => {
  const { calls, catalog } = recordingCatalog({ fetchDetails: async () => { calls.push("details"); return null; } });
  const h = harness({ catalog });
  assert.equal(await h.service.getDetails(dune), null);
  assert.equal(await h.service.getDetails(dune), null);
  assert.equal(calls.length, 1);
  h.advance(30 * DAY);
  await h.service.getDetails(dune);
  assert.equal(calls.length, 2);
});

test("a details failure propagates and records nothing", async () => {
  const h = harness({ catalog: recordingCatalog({ fetchDetails: async () => { throw new SourceUnavailableError("openlibrary", "HTTP 503"); } }).catalog });
  await assert.rejects(h.service.getDetails(dune), SourceUnavailableError);
  assert.equal(h.repo.findBookByKey("isbn:9780441013593")!.details_status, null);
});

test("an ISBN search is answered from a saved book without calling Open Library", async () => {
  const { calls, catalog } = recordingCatalog();
  const h = harness({ catalog });
  h.service.resolveCover(dune);
  const results = await h.service.search("978-0-441-01359-3");
  assert.equal(results[0]!.title, "Dune");
  assert.deepEqual(calls, []);
});

test("an unknown ISBN goes to Open Library and the results are saved", async () => {
  const { calls, catalog } = recordingCatalog();
  const h = harness({ catalog });
  await h.service.search("9780441013593");
  assert.deepEqual(calls, ["search-isbn:9780441013593"]);
  assert.ok(h.repo.findBookByKey("isbn:9780441013593"));
  await h.service.search("9780441013593");
  assert.equal(calls.length, 1);
});

test("free text returns saved matches first and falls back to Open Library, saving every result", async () => {
  const { calls, catalog } = recordingCatalog();
  const h = harness({ catalog });
  const fromOpenLibrary = await h.service.search("dune");
  assert.deepEqual(calls, ["search:dune"]);
  assert.equal(fromOpenLibrary.length, 2);
  assert.equal(fromOpenLibrary[0]!.coverUrl, "https://covers.openlibrary.org/b/id/7-M.jpg");
  assert.ok(h.repo.findBookByKey("ta:dune encyclopedia|willis e mcnelly"));

  const saved = await h.service.search("Dune");
  assert.equal(calls.length, 1);
  assert.deepEqual(saved.map((result) => result.title).sort(), ["Dune", "Dune Encyclopedia"]);
  const book = saved.find((result) => result.title === "Dune")!;
  assert.deepEqual(book.authors, ["Frank Herbert"]);
  assert.equal(book.year, 1965);
  assert.equal(book.coverUrl, "https://covers.openlibrary.org/b/id/7-M.jpg");
});

test("a saved book's own cover is used in search results", async () => {
  const { catalog } = recordingCatalog();
  const h = harness({ catalog, sources: { isbndb: null, apple: isbnSource("https://a/1"), openlibrary: emptySource } });
  h.sizes.set("https://a/1", [900, 1400]);
  h.service.resolveCover(dune);
  await h.service.processBook(h.bookId("isbn:9780441013593"));
  const [result] = await h.service.search("dune herbert");
  assert.match(result!.coverUrl!, /\/covers\/cached\/.+\/thumb$/);
});

test("search strips FTS syntax and ignores punctuation-only queries", async () => {
  const { calls, catalog } = recordingCatalog();
  const h = harness({ catalog });
  await h.service.search("dune");
  assert.equal((await h.service.search('"Dune" -herbert* (')).length, 1);
  assert.deepEqual(await h.service.search("***"), []);
  assert.deepEqual(await h.service.search("   "), []);
  assert.equal(calls.length, 1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx tsx --test src/modules/books/booksService.test.ts`
Expected: FAIL — `h.service.getDetails is not a function`.

- [ ] **Step 3: Write the implementation**

In `backend/src/modules/books/booksService.ts`:

Add imports:

```ts
import { looksLikeIsbnQuery, normalizeIsbn, type BookGenre, type BookMetadata, type BookSearchResult } from "@scripta/shared";
import { lookupIdentity, searchTokens, type BookLookup } from "./domain/normalize.js";
import type { BookCatalog, BooksRepository, CatalogSearchHit, CoverBlobStore } from "./domain/ports.js";
```

(replace the existing `normalize.js` and `ports.js` import lines with these.)

Add the constant `const SEARCH_LIMIT = 12;` next to the other constants.

Add to the `BooksService` interface:

```ts
  getDetails(lookup: BookLookup): Promise<BookMetadata | null>;
  search(query: string): Promise<BookSearchResult[]>;
```

Add these helpers inside `createBooksService`, after `storeImage`:

```ts
  function openLibraryThumb(coverId: number | null): string | null {
    return coverId === null ? null : `https://covers.openlibrary.org/b/id/${coverId}-M.jpg`;
  }

  function detailsOf(book: BookRow): BookMetadata {
    return {
      summary: book.summary,
      rating: book.rating,
      ratingCount: book.rating_count,
      sourceUrl: book.source_url ?? "",
      genres: JSON.parse(book.genres) as BookGenre[]
    };
  }

  function toSearchResult(book: BookRow): BookSearchResult {
    return {
      title: book.title,
      authors: book.author ? book.author.split(", ") : [],
      year: book.year,
      isbn: book.isbn,
      publisher: book.publisher,
      coverUrl: book.cover_image_id ? deps.publicUrlFor(book.cover_image_id, "thumb") : openLibraryThumb(book.ol_cover_id),
      genres: JSON.parse(book.genres) as BookGenre[]
    };
  }

  function saveHits(hits: CatalogSearchHit[]): BookSearchResult[] {
    return hits.map(({ result, olCoverId }) => {
      const author = result.authors.join(", ");
      const identity = lookupIdentity({ isbn: result.isbn, title: result.title, author });
      if (!identity) return result;
      const book = deps.repo.findBookByKey(identity.key) ?? deps.repo.createBook(
        { title: result.title, author, isbn: identity.isbn, year: result.year, publisher: result.publisher, olCoverId, genres: result.genres },
        identity.key,
        now().toISOString()
      );
      if (!book.title) deps.repo.fillIdentity(book.id, result.title, author);
      return book.cover_image_id ? { ...result, coverUrl: deps.publicUrlFor(book.cover_image_id, "thumb") } : result;
    });
  }
```

Add these methods to the returned object:

```ts
    async getDetails(lookup) {
      const book = findOrCreate(lookup);
      if (!book) return null;
      if (book.details_status === "found") return detailsOf(book);
      if (book.details_status === "missing" && !olderThan(book.details_checked_at, RETRY_AFTER_MS)) return null;
      const metadata = await deps.catalog.fetchDetails({ isbn: book.isbn, title: book.title, author: book.author });
      const at = now().toISOString();
      if (metadata) deps.repo.saveDetails(book.id, metadata, at);
      else deps.repo.markDetailsMissing(book.id, at);
      return metadata;
    },

    async search(query) {
      const trimmed = query.trim();
      if (!trimmed) return [];
      if (looksLikeIsbnQuery(trimmed)) {
        const isbn = normalizeIsbn(trimmed);
        const saved = isbn ? deps.repo.findBookByKey(`isbn:${isbn}`) : undefined;
        if (saved) return [toSearchResult(saved)];
        return saveHits(await deps.catalog.search({ isbn: isbn || trimmed.replace(/[\s-]/g, "") }));
      }
      const tokens = searchTokens(trimmed);
      if (tokens.length === 0) return [];
      const saved = deps.repo.searchBooks(tokens, SEARCH_LIMIT);
      if (saved.length > 0) return saved.map(toSearchResult);
      return saveHits(await deps.catalog.search({ text: trimmed }));
    },
```

- [ ] **Step 4: Run tests and typecheck**

Run: `cd backend && npx tsx --test src/modules/books/booksService.test.ts`
Expected: PASS (20 tests).
Run from the repo root: `npm run typecheck --workspace backend`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add backend/src/modules/books/booksService.ts backend/src/modules/books/booksService.test.ts && /usr/bin/git commit -m "Books service: stored details and local-first search

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: Service — admin reject and upload

**Files:**
- Modify: `backend/src/modules/books/domain/errors.ts` (append)
- Modify: `backend/src/modules/books/booksService.ts`
- Modify: `backend/src/modules/books/booksService.test.ts` (append)

**Interfaces:**
- Consumes: `encodeCover` (Task 4).
- Produces:
  - Errors: `BookNotFoundError`, `FileTooLargeError` (with `readonly maxBytes`), `InvalidImageError`
  - `MAX_UPLOAD_BYTES = 20 * 1024 * 1024` exported from `booksService.ts`
  - Added to `BooksService`: `isAdmin(userId: string): boolean`, `rejectCover(lookup: BookLookup): ResolvedCover` (throws `BookNotFoundError`), `uploadCover(lookup: BookLookup, bytes: Buffer): Promise<ResolvedCover>` (throws `FileTooLargeError`, `InvalidImageError`, `BookNotFoundError`)

- [ ] **Step 1: Write the failing tests**

Append to `backend/src/modules/books/booksService.test.ts`:

```ts
const { default: sharp } = await import("sharp");
const { BookNotFoundError, FileTooLargeError, InvalidImageError } = await import("./domain/errors.js");

test("nobody is admin when ADMIN_USER_ID is blank", () => {
  assert.equal(harness().service.isAdmin(""), false);
  assert.equal(harness().service.isAdmin("u1"), false);
  const h = harness({ adminUserId: "u1" });
  assert.equal(h.service.isAdmin("u1"), true);
  assert.equal(h.service.isAdmin("u2"), false);
});

test("rejecting a cover blocks its URL, clears the pointer and queues the book first", async () => {
  const h = harness({ sources: { isbndb: null, apple: isbnSource("https://a/1"), openlibrary: emptySource } });
  h.sizes.set("https://a/1", [900, 1400]);
  h.service.resolveCover(orlando);
  const id = h.bookId("isbn:9780141184272");
  await h.service.processBook(id);
  h.enqueued.length = 0;

  assert.deepEqual(h.service.rejectCover(orlando), { url: null, fullUrl: null, pending: true });
  assert.deepEqual(h.enqueued, [{ bookId: id, front: true }]);
  assert.equal(h.repo.getBook(id)!.cover_image_id, null);
  assert.deepEqual([...h.repo.listRejectedUrls(id)], ["https://a/1"]);

  await h.service.processBook(id);
  assert.equal(h.repo.getBook(id)!.cover_status, "missing");
});

test("rejecting a migrated cover with no recorded URL just clears it", () => {
  const h = harness();
  const book = h.repo.createBook({ title: "", author: "", isbn: "9780141184272" }, "isbn:9780141184272", "2026-01-01T00:00:00.000Z");
  h.repo.insertImage({ id: "legacy", book_id: book.id, source: "openlibrary", source_url: null, width: 300, height: 460, byte_size: 1, created_at: "2026-01-01T00:00:00.000Z" });
  h.repo.setCover(book.id, { imageId: "legacy", status: "low_res", checkedAt: "1970-01-01T00:00:00.000Z" });
  h.service.rejectCover(orlando);
  assert.equal(h.repo.getBook(book.id)!.cover_image_id, null);
  assert.equal(h.repo.listRejectedUrls(book.id).size, 0);
});

test("rejecting an unknown book fails", () => {
  assert.throws(() => harness().service.rejectCover(orlando), BookNotFoundError);
});

test("an uploaded cover becomes manual and the worker leaves it alone", async () => {
  const calls: string[] = [];
  const h = harness({ sources: { isbndb: null, apple: isbnSource("https://a/1", calls), openlibrary: emptySource } });
  const photo = await sharp({ create: { width: 600, height: 900, channels: 3, background: "#224466" } }).jpeg().toBuffer();
  const cover = await h.service.uploadCover(orlando, photo);
  const id = h.bookId("isbn:9780141184272");
  const book = h.repo.getBook(id)!;
  assert.equal(book.cover_status, "manual");
  assert.equal(cover.url, `https://api.test/covers/cached/${book.cover_image_id}/thumb`);
  assert.equal(h.repo.getImage(book.cover_image_id!)!.source, "upload");
  await h.service.processBook(id);
  assert.deepEqual(calls, []);
});

test("uploads that are too large or not images are refused", async () => {
  const h = harness();
  await assert.rejects(h.service.uploadCover(orlando, Buffer.alloc(20 * 1024 * 1024 + 1)), FileTooLargeError);
  await assert.rejects(h.service.uploadCover(orlando, Buffer.from("not an image")), InvalidImageError);
  await assert.rejects(h.service.uploadCover({ title: "?!" }, Buffer.from("x")), BookNotFoundError);
});

test("a lookup running while the admin uploads does not overwrite the upload", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const slow: CoverSource = { byIsbn: async () => { await gate; return [{ source: "apple", url: "https://a/1" }]; }, byTitle: async () => [] };
  const h = harness({ sources: { isbndb: null, apple: slow, openlibrary: emptySource } });
  h.sizes.set("https://a/1", [900, 1400]);
  h.service.resolveCover(orlando);
  const id = h.bookId("isbn:9780141184272");
  const running = h.service.processBook(id);
  const photo = await sharp({ create: { width: 600, height: 900, channels: 3, background: "#224466" } }).jpeg().toBuffer();
  await h.service.uploadCover(orlando, photo);
  release();
  await running;
  assert.equal(h.repo.getBook(id)!.cover_status, "manual");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx tsx --test src/modules/books/booksService.test.ts`
Expected: FAIL — errors not exported / `isAdmin` is not a function.

- [ ] **Step 3: Write the implementation**

Append to `backend/src/modules/books/domain/errors.ts`:

```ts
export class BookNotFoundError extends Error {
  constructor() {
    super("No such book.");
    this.name = "BookNotFoundError";
  }
}

export class FileTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Image is larger than ${Math.round(maxBytes / (1024 * 1024))} MB.`);
    this.name = "FileTooLargeError";
  }
}

export class InvalidImageError extends Error {
  constructor() {
    super("That file isn't an image we can use.");
    this.name = "InvalidImageError";
  }
}
```

In `backend/src/modules/books/booksService.ts`:

Add imports:

```ts
import { BookNotFoundError, FileTooLargeError, InvalidImageError } from "./domain/errors.js";
import { encodeCover, type EncodedCover } from "./domain/images.js";
```

(replace the existing `images.js` type import with this line.)

Add the exported constant:

```ts
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
```

Add to the `BooksService` interface:

```ts
  isAdmin(userId: string): boolean;
  rejectCover(lookup: BookLookup): ResolvedCover;
  uploadCover(lookup: BookLookup, bytes: Buffer): Promise<ResolvedCover>;
```

Add these methods to the returned object:

```ts
    isAdmin(userId) {
      return deps.adminUserId !== "" && userId === deps.adminUserId;
    },

    rejectCover(lookup) {
      const identity = lookupIdentity(lookup);
      const book = identity ? deps.repo.findBookByKey(identity.key) : undefined;
      if (!book) throw new BookNotFoundError();
      const image = book.cover_image_id ? deps.repo.getImage(book.cover_image_id) : undefined;
      if (image?.source_url) deps.repo.addRejection(book.id, image.source_url, now().toISOString());
      deps.repo.setCover(book.id, { imageId: null, status: null, checkedAt: null });
      backoffUntil.delete(book.id);
      deps.enqueue(book.id, true);
      return { url: null, fullUrl: null, pending: true };
    },

    async uploadCover(lookup, bytes) {
      if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new FileTooLargeError(MAX_UPLOAD_BYTES);
      if (!lookupIdentity(lookup)) throw new BookNotFoundError();
      const image = await encodeCover(bytes);
      if (!image) throw new InvalidImageError();
      const book = findOrCreate(lookup);
      if (!book) throw new BookNotFoundError();
      const at = now().toISOString();
      const imageId = storeImage(book.id, "upload", null, image, at);
      deps.repo.setCover(book.id, { imageId, status: "manual", checkedAt: at });
      backoffUntil.delete(book.id);
      return coverOf(deps.repo.getBook(book.id) ?? book);
    },
```

Note the ordering in `uploadCover`: the size check first (cheapest), then identity (so `{title: "?!"}` fails as `BookNotFoundError` before any decoding), then decoding.

- [ ] **Step 4: Run tests and typecheck**

Run: `cd backend && npx tsx --test src/modules/books/booksService.test.ts`
Expected: PASS (27 tests).
Run from the repo root: `npm run typecheck --workspace backend`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add backend/src/modules/books && /usr/bin/git commit -m "Books service: admin reject and manual upload of shared covers

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: Routes, plugin wiring, env, public peek, legacy removal

**Files:**
- Rewrite: `backend/src/modules/books/routes.ts`
- Rewrite: `backend/src/modules/books/plugin.ts`
- Rewrite: `backend/src/modules/books/publicCoverLookup.ts`
- Modify: `backend/src/modules/books/index.ts`
- Modify: `backend/src/modules/books/domain/types.ts`, `domain/ports.ts` (remove legacy types/ports)
- Modify: `backend/src/modules/books/adapters/sqlite/connection.ts` (remove `openCoversDb`)
- Create: `backend/src/modules/books/routes.test.ts`
- Delete: `backend/src/modules/books/service.ts`, `adapters/google/`, `adapters/hardcover/`, `adapters/kobo/`, `adapters/openlibrary/openLibraryCoverLookup.ts`, `adapters/sqlite/schema.sql`, `adapters/sqlite/sqliteCoverCacheRepository.ts`
- Modify: `backend/src/config/env.ts`, `backend/.env.example`, `backend/scripts/three-users.mjs:68`, `backend/src/modules/library/publicResolver.ts`, `backend/package.json`

**Interfaces:**
- Consumes: everything from Tasks 2–9.
- Produces:
  - Route builders: `buildResolveRoutes(service)`, `buildCoverFileRoutes(service)`, `buildCatalogRoutes(service)`, `buildAdminRoutes(service)`
  - `registerBooksModule` (the plugin), `peekCachedCoverUrl(params: { isbn?: string | null; title?: string | null; author?: string | null }): string | null` from `modules/books/index.ts`
  - Env: `ISBNDB_API_KEY`, `ADMIN_USER_ID`, `isbndbConfigured`

HTTP contract:

| Route | Auth | Response |
|---|---|---|
| `GET /covers/resolve?isbn=&title=&author=` | ✓ | `{url, fullUrl, pending}`; 400 without isbn and title |
| `GET /covers/cached/:id/file`, `/thumb` | — | WebP bytes, `Cache-Control: public, max-age=31536000, immutable`; 404 unknown; 400 non-UUID |
| `GET /books/details?isbn=&title=&author=` | ✓ | `{metadata}`; 502 `{error: "Book information is unavailable."}` |
| `GET /books/search?q=` | ✓ | `{results}`; 502 `{error: "Search is unavailable right now — try again."}` |
| `GET /books/admin` | ✓ | `{isAdmin}` |
| `POST /books/cover/reject` body `{isbn?, title?, author?}` | ✓ admin | `{url, fullUrl, pending}`; 403; 404 |
| `PUT /books/cover?isbn=&title=&author=` multipart `image` | ✓ admin | `{url, fullUrl, pending}`; 403; 404; 413; 422 |

- [ ] **Step 1: Write the failing route test**

Create `backend/src/modules/books/routes.test.ts`:

```ts
import assert from "node:assert/strict";
import fastifyMultipart from "@fastify/multipart";
import Fastify, { type InjectOptions } from "fastify";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import sharp from "sharp";

const scratch = mkdtempSync(join(tmpdir(), "books-routes-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.GALLERY_STORAGE_PATH = join(scratch, "gallery-files");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.COVERS_STORAGE_PATH = join(scratch, "covers-files");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("./adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("./adapters/sqlite/sqliteBooksRepository.js");
const { createBooksService, MAX_UPLOAD_BYTES } = await import("./booksService.js");
const { SourceUnavailableError } = await import("./domain/errors.js");
const { buildAdminRoutes, buildCatalogRoutes, buildCoverFileRoutes, buildResolveRoutes } = await import("./routes.js");

type Deps = Parameters<typeof createBooksService>[0];
const empty = { byIsbn: async () => [], byTitle: async () => [] };

function makeService(overrides: Partial<Deps> = {}) {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  const files = new Map<string, Buffer>();
  const service = createBooksService({
    repo: createSqliteBooksRepository(db),
    blobs: { save: (id, ext, bytes) => { files.set(`${id}.${ext}`, bytes); }, read: (id, ext) => files.get(`${id}.${ext}`) ?? null },
    sources: { isbndb: null, apple: empty, openlibrary: empty },
    catalog: { fetchDetails: async () => null, search: async () => [] },
    fetchImage: async () => null,
    enqueue: () => {},
    publicUrlFor: (id, size) => `https://api.test/covers/cached/${id}/${size}`,
    adminUserId: "admin",
    ...overrides
  });
  return { service, files };
}

async function call(service: ReturnType<typeof createBooksService>, options: InjectOptions, signedInAs?: string) {
  const app = Fastify();
  app.decorate("authenticateAccessToken", (token: string) => (token === signedInAs ? { id: token, email: `${token}@example.test`, username: token, avatarId: null } : null));
  await app.register(fastifyMultipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });
  await app.register(buildResolveRoutes(service));
  await app.register(buildCoverFileRoutes(service));
  await app.register(buildCatalogRoutes(service));
  await app.register(buildAdminRoutes(service));
  const res = await app.inject(signedInAs ? { ...options, headers: { ...options.headers, authorization: `Bearer ${signedInAs}` } } : options);
  await app.close();
  return res;
}

function multipart(bytes: Buffer) {
  const boundary = "----bookcover";
  return {
    payload: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="cover.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` }
  };
}

test("resolve needs auth, needs an ISBN or title, and ignores imageId", async () => {
  const { service } = makeService();
  assert.equal((await call(service, { method: "GET", url: "/covers/resolve?title=Dune" })).statusCode, 401);
  assert.equal((await call(service, { method: "GET", url: "/covers/resolve?imageId=abc" }, "u1")).statusCode, 400);
  const res = await call(service, { method: "GET", url: "/covers/resolve?title=Dune&author=Frank%20Herbert&imageId=abc" }, "u1");
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { url: null, fullUrl: null, pending: true });
});

test("cover files serve WebP with immutable caching; thumb falls back to the full file", async () => {
  const { service, files } = makeService();
  const id = "11111111-1111-4111-8111-111111111111";
  files.set(`${id}.webp`, Buffer.from("full"));
  const res = await call(service, { method: "GET", url: `/covers/cached/${id}/thumb` });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["content-type"], "image/webp");
  assert.equal(res.headers["cache-control"], "public, max-age=31536000, immutable");
  assert.equal(res.body, "full");
  assert.equal((await call(service, { method: "GET", url: "/covers/cached/22222222-2222-4222-8222-222222222222/file" })).statusCode, 404);
  assert.equal((await call(service, { method: "GET", url: "/covers/cached/not-a-uuid/file" })).statusCode, 400);
});

test("details and search wrap their payloads and map an unavailable catalog to 502", async () => {
  const { service } = makeService();
  assert.deepEqual((await call(service, { method: "GET", url: "/books/details?isbn=9780441013593" }, "u1")).json(), { metadata: null });
  assert.deepEqual((await call(service, { method: "GET", url: "/books/search?q=dune" }, "u1")).json(), { results: [] });

  const down = makeService({ catalog: {
    fetchDetails: async () => { throw new SourceUnavailableError("openlibrary", "HTTP 503"); },
    search: async () => { throw new SourceUnavailableError("openlibrary", "HTTP 503"); }
  } }).service;
  const details = await call(down, { method: "GET", url: "/books/details?isbn=9780441013593" }, "u1");
  assert.equal(details.statusCode, 502);
  assert.equal(details.json().error, "Book information is unavailable.");
  const search = await call(down, { method: "GET", url: "/books/search?q=dune" }, "u1");
  assert.equal(search.statusCode, 502);
  assert.equal(search.json().error, "Search is unavailable right now — try again.");
});

test("admin routes report the flag and refuse everyone else", async () => {
  const { service } = makeService();
  assert.deepEqual((await call(service, { method: "GET", url: "/books/admin" }, "u1")).json(), { isAdmin: false });
  assert.deepEqual((await call(service, { method: "GET", url: "/books/admin" }, "admin")).json(), { isAdmin: true });
  assert.equal((await call(service, { method: "POST", url: "/books/cover/reject", payload: { title: "Dune" } }, "u1")).statusCode, 403);
  assert.equal((await call(service, { method: "POST", url: "/books/cover/reject", payload: { title: "Dune" } }, "admin")).statusCode, 404);
  const upload = multipart(Buffer.from("x"));
  assert.equal((await call(service, { method: "PUT", url: "/books/cover?title=Dune", ...upload }, "u1")).statusCode, 403);
});

test("the admin can upload a cover and non-images are refused", async () => {
  const { service } = makeService();
  const photo = await sharp({ create: { width: 600, height: 900, channels: 3, background: "#224466" } }).jpeg().toBuffer();
  const ok = await call(service, { method: "PUT", url: "/books/cover?title=Dune&author=Frank%20Herbert", ...multipart(photo) }, "admin");
  assert.equal(ok.statusCode, 200);
  assert.match(ok.json().url, /\/thumb$/);
  const bad = await call(service, { method: "PUT", url: "/books/cover?title=Dune&author=Frank%20Herbert", ...multipart(Buffer.from("nope")) }, "admin");
  assert.equal(bad.statusCode, 422);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx tsx --test src/modules/books/routes.test.ts`
Expected: FAIL — `buildResolveRoutes` is not exported.

- [ ] **Step 3: Rewrite routes**

Replace `backend/src/modules/books/routes.ts` entirely:

```ts
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authGuard } from "../auth/index.js";
import { MAX_UPLOAD_BYTES, type BooksService, type CoverFileSize } from "./booksService.js";
import { BookNotFoundError, FileTooLargeError, InvalidImageError, SourceUnavailableError } from "./domain/errors.js";

const lookupSchema = z.object({
  isbn: z.string().max(64).optional(),
  title: z.string().max(500).optional(),
  author: z.string().max(500).optional()
});
const searchSchema = z.object({ q: z.string().max(200) });
const fileParamsSchema = z.object({ id: z.string().uuid(), size: z.enum(["file", "thumb"]) });

const FORBIDDEN = { error: "Only the admin can change shared covers." };
const NOT_FOUND = { error: "No such book." };

export function buildResolveRoutes(service: BooksService) {
  return async function resolveRoutes(app: FastifyInstance) {
    app.get("/covers/resolve", { preHandler: authGuard }, async (request, reply) => {
      const parsed = lookupSchema.safeParse(request.query);
      if (!parsed.success || (!parsed.data.isbn && !parsed.data.title)) {
        return reply.code(400).send({ error: "Send an isbn or a title (author optional)." });
      }
      return reply.send(service.resolveCover(parsed.data));
    });
  };
}

export function buildCoverFileRoutes(service: BooksService) {
  return async function coverFileRoutes(app: FastifyInstance) {
    app.get("/covers/cached/:id/:size", async (request, reply) => {
      const parsed = fileParamsSchema.safeParse(request.params);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid cover id." });
      const file = service.getCoverFile(parsed.data.id, parsed.data.size as CoverFileSize);
      if (!file) return reply.code(404).send({ error: "No such cached cover." });
      reply.header("Cache-Control", "public, max-age=31536000, immutable");
      return reply.type(file.mimeType).send(file.buffer);
    });
  };
}

export function buildCatalogRoutes(service: BooksService) {
  return async function catalogRoutes(app: FastifyInstance) {
    app.get("/books/details", { preHandler: authGuard }, async (request, reply) => {
      const parsed = lookupSchema.safeParse(request.query);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid query." });
      try {
        return reply.send({ metadata: await service.getDetails(parsed.data) });
      } catch (error) {
        if (error instanceof SourceUnavailableError) return reply.code(502).send({ error: "Book information is unavailable." });
        throw error;
      }
    });

    app.get("/books/search", { preHandler: authGuard }, async (request, reply) => {
      const parsed = searchSchema.safeParse(request.query);
      if (!parsed.success) return reply.code(400).send({ error: "Send a search query as q." });
      try {
        return reply.send({ results: await service.search(parsed.data.q) });
      } catch (error) {
        if (error instanceof SourceUnavailableError) return reply.code(502).send({ error: "Search is unavailable right now — try again." });
        throw error;
      }
    });
  };
}

export function buildAdminRoutes(service: BooksService) {
  return async function adminRoutes(app: FastifyInstance) {
    app.get("/books/admin", { preHandler: authGuard }, async (request, reply) => {
      return reply.send({ isAdmin: service.isAdmin(request.user.id) });
    });

    app.post("/books/cover/reject", { preHandler: authGuard }, async (request, reply) => {
      if (!service.isAdmin(request.user.id)) return reply.code(403).send(FORBIDDEN);
      const parsed = lookupSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid book." });
      try {
        return reply.send(service.rejectCover(parsed.data));
      } catch (error) {
        if (error instanceof BookNotFoundError) return reply.code(404).send(NOT_FOUND);
        throw error;
      }
    });

    app.put("/books/cover", { preHandler: authGuard, bodyLimit: MAX_UPLOAD_BYTES + 1024 }, async (request, reply) => {
      if (!service.isAdmin(request.user.id)) return reply.code(403).send(FORBIDDEN);
      const parsed = lookupSchema.safeParse(request.query);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid book." });
      const upload = await request.file();
      if (!upload) return reply.code(400).send({ error: "Send the image as a multipart \"image\" field." });
      const buffer = await upload.toBuffer();
      try {
        return reply.send(await service.uploadCover(parsed.data, buffer));
      } catch (error) {
        if (error instanceof FileTooLargeError) return reply.code(413).send({ error: error.message });
        if (error instanceof InvalidImageError) return reply.code(422).send({ error: error.message });
        if (error instanceof BookNotFoundError) return reply.code(404).send(NOT_FOUND);
        throw error;
      }
    });
  };
}
```

If `request.user` is not typed on `FastifyRequest` in this module's context, copy the type augmentation import the old `routes.ts` or `gallery/routes.ts` relies on (gallery's upload route uses `request.user.id` with the same `authGuard`).

- [ ] **Step 4: Rewrite the plugin, peek and index**

Replace `backend/src/modules/books/plugin.ts` entirely:

```ts
import fastifyMultipart from "@fastify/multipart";
import fastifyRateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import { env, isbndbConfigured } from "../../config/env.js";
import { createFsCoverBlobStore } from "./adapters/fs/fsCoverBlobStore.js";
import { createThrottle, fetchBytes } from "./adapters/http/http.js";
import { createOpenLibraryCatalog } from "./adapters/openlibrary/openLibraryCatalog.js";
import { createAppleSource } from "./adapters/sources/apple.js";
import { createIsbndbSource } from "./adapters/sources/isbndb.js";
import { createOpenLibraryCoverSource } from "./adapters/sources/openLibrary.js";
import { openBooksDb } from "./adapters/sqlite/connection.js";
import { createSqliteBooksRepository } from "./adapters/sqlite/sqliteBooksRepository.js";
import { createBooksService, MAX_UPLOAD_BYTES } from "./booksService.js";
import type { FetchCoverImage } from "./coverResolver.js";
import { encodeCover } from "./domain/images.js";
import { buildAdminRoutes, buildCatalogRoutes, buildCoverFileRoutes, buildResolveRoutes } from "./routes.js";
import { createCoverWorker } from "./worker.js";

const ISBNDB_GAP_MS = 1100;
const APPLE_GAP_MS = 3200;
const OPEN_LIBRARY_GAP_MS = 1000;

export async function booksPlugin(app: FastifyInstance) {
  const repo = createSqliteBooksRepository(openBooksDb());
  const openLibraryThrottle = createThrottle(OPEN_LIBRARY_GAP_MS);
  const fetchImage: FetchCoverImage = async (candidate) => {
    const bytes = await fetchBytes(candidate.source, candidate.url);
    return bytes ? encodeCover(bytes) : null;
  };
  const service = createBooksService({
    repo,
    blobs: createFsCoverBlobStore(env.COVERS_STORAGE_PATH),
    sources: {
      isbndb: isbndbConfigured ? createIsbndbSource(env.ISBNDB_API_KEY, createThrottle(ISBNDB_GAP_MS)) : null,
      apple: createAppleSource(createThrottle(APPLE_GAP_MS)),
      openlibrary: createOpenLibraryCoverSource(openLibraryThrottle)
    },
    catalog: createOpenLibraryCatalog(openLibraryThrottle),
    fetchImage,
    enqueue: (bookId, front) => worker.enqueue(bookId, front),
    publicUrlFor: (id, size) => `${env.PUBLIC_API_URL}/covers/cached/${id}/${size}`,
    adminUserId: env.ADMIN_USER_ID
  });
  const worker = createCoverWorker(
    (bookId) => service.processBook(bookId),
    (error, bookId) => app.log.error({ err: error, bookId }, "cover lookup failed")
  );
  app.addHook("onClose", async () => worker.stop());

  await app.register(async (scoped) => {
    await scoped.register(fastifyRateLimit, { max: 1200, timeWindow: "1 minute" });
    await scoped.register(buildResolveRoutes(service));
  });
  await app.register(async (scoped) => {
    await scoped.register(fastifyRateLimit, { max: 300, timeWindow: "1 minute" });
    await scoped.register(buildCatalogRoutes(service));
  });
  await app.register(async (scoped) => {
    await scoped.register(fastifyRateLimit, { max: 30, timeWindow: "1 minute" });
    await scoped.register(fastifyMultipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });
    await scoped.register(buildAdminRoutes(service));
  });
  await app.register(buildCoverFileRoutes(service));
}
```

Replace `backend/src/modules/books/publicCoverLookup.ts` entirely:

```ts
import { env } from "../../config/env.js";
import { openBooksDb } from "./adapters/sqlite/connection.js";
import { createSqliteBooksRepository } from "./adapters/sqlite/sqliteBooksRepository.js";
import { lookupIdentity } from "./domain/normalize.js";
import type { BooksRepository } from "./domain/ports.js";

export interface PeekCachedCoverParams {
  isbn?: string | null;
  title?: string | null;
  author?: string | null;
}

let repo: BooksRepository | null = null;

export function peekCachedCoverUrl(params: PeekCachedCoverParams): string | null {
  const identity = lookupIdentity(params);
  if (!identity) return null;
  repo ??= createSqliteBooksRepository(openBooksDb());
  const imageId = repo.findBookByKey(identity.key)?.cover_image_id;
  return imageId ? `${env.PUBLIC_API_URL}/covers/cached/${imageId}/thumb` : null;
}
```

In `backend/src/modules/books/index.ts`, change the plugin export to `export { booksPlugin as registerBooksModule } from "./plugin.js";` (keep the `peekCachedCoverUrl` and `PeekCachedCoverParams` exports).

- [ ] **Step 5: Update the public resolver**

In `backend/src/modules/library/publicResolver.ts`, both `peekCachedCoverUrl({ isbn, imageId })` calls (in `toPublicBookData` and `toPublicLibraryBook`) become:

```ts
peekCachedCoverUrl({ isbn, title: typeof book.Title === "string" ? book.Title : null, author: typeof book.Attribution === "string" ? book.Attribution : null })
```

Leave the `imageId` variables in place: they are still used for the returned `imageId`/`ImageId` fields.

- [ ] **Step 6: Env, example env and fixture script**

In `backend/src/config/env.ts`:
- Delete the comment block directly above `COVERS_DB_PATH` (it describes Hardcover and Kobo, which are gone).
- Replace the Hardcover comment and `HARDCOVER_API_KEY: z.string().optional().default(""),` with:

```ts
  ISBNDB_API_KEY: z.string().optional().default(""),
  ADMIN_USER_ID: z.string().optional().default(""),
```

- Replace `export const hardcoverConfigured = env.HARDCOVER_API_KEY !== "";` with `export const isbndbConfigured = env.ISBNDB_API_KEY !== "";`.

In `backend/.env.example`, replace the `HARDCOVER_API_KEY=` line and its comment with:

```
# Optional — ISBNdb (https://isbndb.com) key for high-quality exact-edition covers; blank skips ISBNdb.
ISBNDB_API_KEY=
# Optional — the account id allowed to reject or replace shared covers; blank means nobody.
ADMIN_USER_ID=
```

In `backend/scripts/three-users.mjs:68`, replace `HARDCOVER_API_KEY: ""` with `ISBNDB_API_KEY: ""`.

- [ ] **Step 7: Delete legacy code**

```bash
cd /Users/andreribeiro/Documents/scripta/.claude/worktrees/vigorous-bun-af81d9/backend/src/modules/books && /usr/bin/git rm -q -r service.ts adapters/google adapters/hardcover adapters/kobo adapters/openlibrary/openLibraryCoverLookup.ts adapters/sqlite/schema.sql adapters/sqlite/sqliteCoverCacheRepository.ts
```

Then:
- In `adapters/sqlite/connection.ts`, delete `openCoversDb`.
- In `domain/types.ts`, delete `CachedCoverRow` and `CachedCover`.
- In `domain/ports.ts`, delete `CoverLookupPort` and `CoverCacheRepository` and their comments; keep `CoverBlobStore` (without its comment).

Run: `grep -rn "hardcover\|Hardcover\|openCoversDb\|CoverCacheRepository\|createCoversService\|koboCoverUrl" /Users/andreribeiro/Documents/scripta/.claude/worktrees/vigorous-bun-af81d9/backend/src`
Expected: no output.

Add `src/modules/books/routes.test.ts` to the `backend/package.json` test list.

- [ ] **Step 8: Run everything**

Run from the repo root: `npm run build --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend`
Expected: typecheck clean; all backend tests pass, including the 5 new route tests.

- [ ] **Step 9: Commit**

```bash
cd /Users/andreribeiro/Documents/scripta/.claude/worktrees/vigorous-bun-af81d9 && /usr/bin/git add -A backend && /usr/bin/git commit -m "Wire the books module: routes, worker, env, public peek; drop legacy chain

Google Books, Kobo CDN and Hardcover leave the cover chain; ISBNDB_API_KEY
and ADMIN_USER_ID replace HARDCOVER_API_KEY.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 11: Web client — covers, details and search through the backend

**Files:**
- Rewrite: `frontend/src/api/covers.ts`
- Modify: `frontend/src/components/BookCard.tsx` (`CoverImage`, `coverParamsFor`)
- Modify: `frontend/src/components/BookDetailSheet.tsx:65`
- Modify: `frontend/src/lib/arenaSeed.ts:26`
- Modify: `frontend/src/lib/bookMetadata.ts`
- Modify: `frontend/src/lib/bookSearch.ts`
- Modify: `frontend/scripts/test-book-metadata.mts`

**Interfaces:**
- Consumes: `createCoverResolver`, `CoverCacheEntry`, `CoverLookupParams`, `CoverSize`, `ResolvedCoverResponse` (Task 1); routes from Task 10.
- Produces (`frontend/src/api/covers.ts`): `type ResolveCoverParams`, `peekResolvedCover(params, size?)`, `resolveCover(params, options?)`, `forgetResolvedCover(params)`, `rememberResolvedCover(params, cover)`. `CoverImage` gains `size?: "thumb" | "full"`. `coverParamsFor(book)` is exported from `BookCard.tsx`.

- [ ] **Step 1: Rewrite the cover cache**

Replace `frontend/src/api/covers.ts` entirely:

```ts
import { createCoverResolver, type CoverCacheEntry, type CoverLookupParams, type CoverSize, type ResolvedCoverResponse } from "@scripta/shared";
import { apiFetch } from "./client";

export type ResolveCoverParams = CoverLookupParams;

const STORAGE_KEY = "scripta.covers.resolved.v2";

function loadPersisted(): Record<string, CoverCacheEntry> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, CoverCacheEntry>) : {};
  } catch {
    return {};
  }
}

const resolver = createCoverResolver({
  fetchResolve: async (query) => (await apiFetch(`/covers/resolve?${query}`)) as ResolvedCoverResponse,
  persist(entries) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch {
      return;
    }
  }
});
resolver.hydrate(loadPersisted());

export function peekResolvedCover(params: ResolveCoverParams, size: CoverSize = "thumb"): string | null | undefined {
  return resolver.peek(params, size);
}

export function resolveCover(params: ResolveCoverParams, options?: { size?: CoverSize; poll?: boolean }): Promise<string | null> {
  return resolver.resolve(params, options);
}

export function forgetResolvedCover(params: ResolveCoverParams): void {
  resolver.forget(params);
}

export function rememberResolvedCover(params: ResolveCoverParams, cover: { url: string | null; fullUrl: string | null }): void {
  resolver.remember(params, cover);
}
```

The two `catch` blocks keep the previous file's behavior: `localStorage` can throw (private mode, quota), and the in-memory cache still works when it does.

- [ ] **Step 2: Thumb/full in `CoverImage`**

In `frontend/src/components/BookCard.tsx`:
- Change `function coverParamsFor(` to `export function coverParamsFor(`.
- Add a `size = "thumb"` prop to `CoverImage` (type `size?: "thumb" | "full";`).
- Pass `size` to every `peekResolvedCover(...)` call as the second argument, change `resolveCover(params)` to `resolveCover(params, { size })`, and add `size` to the dependency arrays of the two effects that call them.

In `frontend/src/components/BookDetailSheet.tsx:65`, change `<CoverImage book={book} />` to `<CoverImage book={book} size="full" />`.

In `frontend/src/lib/arenaSeed.ts:26`, change `return await resolveCover(params);` to `return await resolveCover(params, { poll: false });`.

- [ ] **Step 3: Details and search through the backend**

In `frontend/src/lib/bookMetadata.ts`, replace `fetchBookMetadata` and its now-unused imports (`findOpenLibraryMatch`, `buildBookMetadata`) with:

```ts
export async function fetchBookMetadata(isbn: string, title: string, author: string, signal?: AbortSignal): Promise<BookMetadata | null> {
  if (!isbn && (!title || !author)) return null;
  const query = new URLSearchParams();
  if (isbn) query.set("isbn", isbn);
  if (title) query.set("title", title);
  if (author) query.set("author", author);
  const body = (await apiFetch(`/books/details?${query}`, { signal })) as { metadata: BookMetadata | null };
  return body.metadata;
}
```

and add `import { apiFetch } from "../api/client";`. Keep `bookMetadataOptions` unchanged. Delete the file's top comment block, which describes the removed Open Library fetch.

In `frontend/src/lib/bookSearch.ts`, replace `searchBooks` (and drop the now-unused `looksLikeIsbnQuery`/`mapOpenLibraryDoc` imports if nothing else in the file uses them — the re-export line stays) with:

```ts
export async function searchBooks(query: string): Promise<BookSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const body = (await apiFetch(`/books/search?${new URLSearchParams({ q: trimmed })}`)) as { results: BookSearchResult[] };
  return body.results;
}
```

and add `import { apiFetch } from "../api/client";`. Delete the file's top comment block.

In `frontend/scripts/test-book-metadata.mts`, delete the whole `test("metadata lookup validates matching and handles unavailable data", …)` block (its cases now live in `backend/src/modules/books/adapters/openlibrary/openLibraryCatalog.test.ts`) and remove `fetchBookMetadata` from the import on line 3.

- [ ] **Step 4: Verify**

Run from the repo root: `npm run build --workspace @scripta/shared && npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend && npm run build --workspace frontend`
Expected: all clean; all tests pass; build succeeds.

Run: `grep -rn "openlibrary.org/search" frontend/src` — Expected: no output.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add frontend && /usr/bin/git commit -m "Web: shared cover cache with thumbnails; details and search via backend

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 12: Web admin cover actions

**Files:**
- Create: `frontend/src/api/books.ts`
- Modify: `frontend/src/components/BookDetailSheet.tsx`

**Interfaces:**
- Consumes: `/books/admin`, `/books/cover/reject`, `/books/cover` (Task 10); `coverParamsFor` (Task 11); `forgetResolvedCover`, `rememberResolvedCover`, `ResolveCoverParams` (Task 11); `useConfirm` (existing, `confirm({ title, body, confirmLabel })`).
- Produces: `fetchIsAdmin(): Promise<boolean>`, `rejectSharedCover(params): Promise<void>`, `uploadSharedCover(params, file: File): Promise<{ url: string | null; fullUrl: string | null }>`.

- [ ] **Step 1: API helpers**

Create `frontend/src/api/books.ts`:

```ts
import { apiFetch } from "./client";
import type { ResolveCoverParams } from "./covers";

function lookupQuery(params: ResolveCoverParams): URLSearchParams {
  const query = new URLSearchParams();
  if (params.isbn) query.set("isbn", params.isbn);
  if (params.title) query.set("title", params.title);
  if (params.author) query.set("author", params.author);
  return query;
}

export async function fetchIsAdmin(): Promise<boolean> {
  return ((await apiFetch("/books/admin")) as { isAdmin: boolean }).isAdmin;
}

export async function rejectSharedCover(params: ResolveCoverParams): Promise<void> {
  await apiFetch("/books/cover/reject", {
    method: "POST",
    body: JSON.stringify({ isbn: params.isbn, title: params.title, author: params.author })
  });
}

export async function uploadSharedCover(params: ResolveCoverParams, file: File): Promise<{ url: string | null; fullUrl: string | null }> {
  const form = new FormData();
  form.append("image", file);
  return (await apiFetch(`/books/cover?${lookupQuery(params)}`, { method: "PUT", body: form })) as { url: string | null; fullUrl: string | null };
}
```

- [ ] **Step 2: Buttons in the detail sheet**

In `frontend/src/components/BookDetailSheet.tsx`:

Add imports:

```ts
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { fetchIsAdmin, rejectSharedCover, uploadSharedCover } from "../api/books";
import { forgetResolvedCover, rememberResolvedCover } from "../api/covers";
import { coverParamsFor, CoverImage } from "./BookCard";
```

(merge with the existing `react` and `./BookCard` imports rather than duplicating them.)

Inside the component, next to the existing `const confirm = useConfirm();`:

```ts
  const { data: isAdmin = false } = useQuery({ queryKey: ["books-admin"], queryFn: fetchIsAdmin, staleTime: Infinity });
  const [coverVersion, setCoverVersion] = useState(0);
  const [coverError, setCoverError] = useState<string | null>(null);
  const coverFile = useRef<HTMLInputElement>(null);

  async function rejectCover() {
    if (!(await confirm({ title: "Reject this cover?", body: "Every account stops seeing it, and the next best cover is looked up.", confirmLabel: "Reject" }))) return;
    const params = coverParamsFor(book);
    try {
      await rejectSharedCover(params);
      forgetResolvedCover(params);
      setCoverError(null);
      setCoverVersion((v) => v + 1);
    } catch (error) {
      setCoverError(error instanceof Error ? error.message : "Couldn't reject the cover.");
    }
  }

  async function replaceCover(file: File) {
    const params = coverParamsFor(book);
    try {
      rememberResolvedCover(params, await uploadSharedCover(params, file));
      setCoverError(null);
      setCoverVersion((v) => v + 1);
    } catch (error) {
      setCoverError(error instanceof Error ? error.message : "Couldn't upload the cover.");
    }
  }
```

Change the detail cover to remount after a change:

```tsx
            <CoverImage key={coverVersion} book={book} size="full" />
```

Inside the existing actions row (`<div className="mt-4 flex flex-wrap gap-2">`, after the `Cover` button), add:

```tsx
              {isAdmin && (
                <>
                  <button onClick={() => void rejectCover()} className={actionClass}>
                    Wrong cover
                  </button>
                  <button onClick={() => coverFile.current?.click()} className={actionClass}>
                    Replace cover
                  </button>
                  <input
                    ref={coverFile}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (file) void replaceCover(file);
                    }}
                  />
                </>
              )}
```

Directly after that actions `div`, add:

```tsx
            {coverError && (
              <p role="alert" className="mt-2 text-sm text-(--color-danger)">
                {coverError}
              </p>
            )}
```

- [ ] **Step 3: Verify**

Run from the repo root: `npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend && npm run build --workspace frontend`
Expected: all clean.

- [ ] **Step 4: Commit**

```bash
/usr/bin/git add frontend && /usr/bin/git commit -m "Web: admin Wrong cover / Replace cover on the book detail sheet

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 13: Mobile client — covers, details and search through the backend

**Files:**
- Rewrite: `mobile/src/features/library/api/covers.ts`
- Modify: `mobile/src/features/library/components/CoverImage.tsx`
- Modify: `mobile/src/features/library/components/BookDetail.tsx:56`
- Rewrite: `mobile/src/features/library/api/bookMetadata.ts`
- Rewrite: `mobile/src/features/library/api/search.ts`
- Modify: `mobile/src/features/library/hooks/useGenreEnrichment.ts:22`

**Interfaces:**
- Consumes: `createCoverResolver` and types (Task 1); routes (Task 10); `apiClient.request<T>(path, { auth: true })` (existing, `mobile/src/core/api.ts`).
- Produces: the same exports `mobile/src/features/library/api/covers.ts` has today (`ResolveCoverParams`, `ensureCoversHydrated`, `peekResolvedCover`, `forgetResolvedCover`, `resolveCover`), with an optional size argument; `CoverImage` gains `size?: "thumb" | "full"`; `fetchBookMetadata(book)` (no signal parameter).

- [ ] **Step 1: Rewrite the cover cache**

Replace `mobile/src/features/library/api/covers.ts` entirely:

```ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createCoverResolver, type CoverCacheEntry, type CoverLookupParams, type CoverSize, type ResolvedCoverResponse } from "@scripta/shared";
import { apiClient } from "../../../core/api";

export type ResolveCoverParams = CoverLookupParams;

const STORAGE_KEY = "scripta.covers.resolved.v2";

const resolver = createCoverResolver({
  fetchResolve: (query) => apiClient.request<ResolvedCoverResponse>(`/covers/resolve?${query}`, { auth: true }),
  persist(entries) {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries)).catch(() => undefined);
  }
});

let hydratePromise: Promise<void> | null = null;

export function ensureCoversHydrated(): Promise<void> {
  hydratePromise ??= AsyncStorage.getItem(STORAGE_KEY)
    .then((raw) => {
      if (raw) resolver.hydrate(JSON.parse(raw) as Record<string, CoverCacheEntry>);
    })
    .catch(() => undefined);
  return hydratePromise;
}
void ensureCoversHydrated();

export function peekResolvedCover(params: ResolveCoverParams, size: CoverSize = "thumb"): string | null | undefined {
  return resolver.peek(params, size);
}

export function resolveCover(params: ResolveCoverParams, options?: { size?: CoverSize; poll?: boolean }): Promise<string | null> {
  return resolver.resolve(params, options);
}

export function forgetResolvedCover(params: ResolveCoverParams): void {
  resolver.forget(params);
}
```

The two `.catch(() => undefined)` calls keep today's behavior: unreadable or full storage (or corrupt JSON) leaves the in-memory cache working.

- [ ] **Step 2: Thumb/full in `CoverImage`**

In `mobile/src/features/library/components/CoverImage.tsx`:
- Add `size = "thumb"` to the props (type `size?: "thumb" | "full";`).
- Pass `size` as the second argument to all three `peekResolvedCover(...)` calls, change `resolveCover(params)` to `resolveCover(params, { size })`, and add `size` to the dependency arrays of the effects that call them.

In `mobile/src/features/library/components/BookDetail.tsx:56`, change `<CoverImage book={book} />` to `<CoverImage book={book} size="full" />`.

- [ ] **Step 3: Details and search through the backend**

Replace `mobile/src/features/library/api/bookMetadata.ts` entirely:

```ts
import { normalizeIsbn, type BookMetadata } from "@scripta/shared";
import { apiClient } from "../../../core/api";

export async function fetchBookMetadata(book: Record<string, unknown>): Promise<BookMetadata | null> {
  const isbn = normalizeIsbn(book.ISBN);
  const title = String(book.Title ?? "");
  const author = String(book.Attribution ?? "");
  if (!isbn && (!title || !author)) return null;
  const query = new URLSearchParams();
  if (isbn) query.set("isbn", isbn);
  if (title) query.set("title", title);
  if (author) query.set("author", author);
  return (await apiClient.request<{ metadata: BookMetadata | null }>(`/books/details?${query}`, { auth: true })).metadata;
}
```

Replace `mobile/src/features/library/api/search.ts` entirely:

```ts
import type { BookSearchResult } from "@scripta/shared";
import { apiClient } from "../../../core/api";

export type { BookSearchResult } from "@scripta/shared";

export async function searchBooks(query: string): Promise<BookSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  return (await apiClient.request<{ results: BookSearchResult[] }>(`/books/search?${new URLSearchParams({ q: trimmed })}`, { auth: true })).results;
}
```

In `mobile/src/features/library/hooks/useGenreEnrichment.ts:22`, change `fetchBookMetadata(book, controller.signal)` to `fetchBookMetadata(book)`. Keep the `controller` — the hook still uses `controller.signal.aborted` to ignore results after unmount.

- [ ] **Step 4: Verify**

Run from the repo root: `npm run build --workspace @scripta/shared && npm run typecheck --workspace mobile && npm test --workspace mobile`
Expected: clean; all tests pass.

Run: `grep -rn "openlibrary.org" mobile/src` — Expected: no output.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add mobile && /usr/bin/git commit -m "Mobile: shared cover cache with thumbnails; details and search via backend

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 14: Documentation and full verification

**Files:**
- Modify: `backend/README.md` (the `covers` module row and section)
- Modify: `frontend/README.md` (mentions of the covers module / Hardcover)

**Interfaces:**
- Consumes: the finished feature.
- Produces: accurate docs.

- [ ] **Step 1: Backend README**

In `backend/README.md`:
- Replace the `covers` row of "Modules at a glance" with a `books` row: "The book catalog — covers (ISBNdb → Apple Books → Open Library, background worker, 600px thumbnails), details and search, all stored once and shared; admin cover fixes" with routes `GET /covers/resolve` ✓, `GET /covers/cached/:id/{file,thumb}`, `GET /books/details` ✓, `GET /books/search` ✓, `GET /books/admin` ✓, `POST /books/cover/reject` ✓ admin, `PUT /books/cover` ✓ admin.
- Replace the whole `### covers` section with a `### books` section that states: the storage (tables, keys, never-deleted images, thumbnails), the chain order and acceptance rules (≥400px, portrait 1.2–1.9, ISBNdb placeholder), the worker and `pending` + client polling, retry windows (30 days, 10-minute backoff), local-first search, `ISBNDB_API_KEY` and `ADMIN_USER_ID`, the route table from Task 10, and ISBNdb's rule that its data must be deleted if the subscription ends (covers keep `source`, so `DELETE`-ing `source = 'isbndb'` rows and re-queuing is possible).
- Update the module count in the intro sentence to match (the module is renamed, not added).
- In "Running it", replace "a Hardcover API key" with "an ISBNdb API key".

- [ ] **Step 2: Frontend README**

Run: `grep -n "covers\|Hardcover\|Open Library" frontend/README.md` and update each mention that describes the removed client-side chain or the old cache so it points to the backend `books` module and the shared `createCoverResolver`.

- [ ] **Step 3: Full verification**

Run from the repo root:

```bash
npm run build --workspace @scripta/shared && npm test --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend && npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend && npm run build --workspace frontend && npm run typecheck --workspace mobile && npm test --workspace mobile && npm run check:agents
```

Expected: every command succeeds.

- [ ] **Step 4: Commit**

```bash
/usr/bin/git add backend/README.md frontend/README.md && /usr/bin/git commit -m "Docs: the books module replaces covers

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
