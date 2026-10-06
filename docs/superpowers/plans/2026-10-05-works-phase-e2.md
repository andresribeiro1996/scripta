# Phase E2a: Clients Speak Works — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Web and mobile send `X-Scripta-Works: 1` and speak works (`workId`, `workIds`, `winnerWorkId`) to arena, tier lists and quizzes, while every request without the header gets today's bytes and is logged as `legacy client`.

**Architecture:** One helper, `worksFormat(request, reply)`, decides the format per request, sets `Vary`, and logs header-less calls. Storage stays exactly as E1 left it: each game route translates at the edge through E1's work columns and side tables (`tournament_slots.work_id`, duel work columns, `tierlist_works`, `quiz_works`). Library helpers in `library/works.ts` turn incoming work ids into canonical ids and pick the key to store: the owner's copy key, or the work id itself. Always-on additive fields: `LibraryDocument.works` and `PublicBookData.key`/`workId`. Clients carry a work on each record as `_workId` (`withWorkIds`/`workIdOf` in `@scripta/shared`).

**Tech Stack:** Fastify/TypeScript, `node:sqlite`, `zod`, `node:test` via `tsx --test`, `@scripta/shared`, React/Vite (web), Expo/React Native (mobile).

**Spec:** `docs/superpowers/specs/2026-10-05-works-phase-e2-design.md` (sections Formats, Transition, Rollout PRs 1–5). The removal (E2b, PRs 6–9) gets its own plan after the gate.

## Global Constraints

- Header: `X-Scripta-Works: 1`. Log line: `legacy client` with `{ method, route }`, from `worksFormat` only. Only the routes the spec lists call `worksFormat`.
- Without the header, every response is byte-identical to today, except two always-on additive fields: `works` on every library document response, and `key` + `workId` on every `PublicBookData`. Existing tests may be edited only to add those two fields (and, for service-level arena tests, the new `workId`/`winnerWorkId` view fields). A legacy route test that fails for any other reason means the implementation is wrong.
- Storage is unchanged in this plan: no schema change, no stored JSON rewritten, no column dropped. A rollback of any PR here needs no restore.
- Every `workId` the API returns is canonical (`canonicalWorkIds`).
- Works-format errors: unknown work id → 400 `{ "error": "That book isn't in the catalog." }`; catalog unreachable → 503 (`WorkResolutionError`, message unchanged); duplicate work → 409 with E1's `duplicateWorkMessage`.
- In the works format, a work already in the item keeps its stored key; a new work gets the owner's copy key for it (first copy by library position), else the work id itself; a copy key already used by another entry of the item falls back to the work id.
- Within one tier list or quiz, each work appears once in the works format (tiers before pool; first book wins). Arena keeps every slot; a duel whose sides share a work gives a vote to side A.
- Every new backend `*.test.ts` file is added to the explicit list in `backend/package.json`'s `"test"` script. Every backend test preamble sets each `*_DB_PATH` the code opens, including `COVERS_DB_PATH`.
- No code comments (repo rule). The *why* goes in commit messages.
- After each backend task: `cd backend && npm run typecheck && npm test`. Shared: `cd packages/shared && npm run build && npm test`. Web: `cd frontend && npm run typecheck && npm run lint && npm test`. Mobile: `cd mobile && npm run typecheck && npm test`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage and commit in one command (concurrent sessions share the index).
- PRs, stacked, merged by the user in order: PR 1 Server plumbing (Tasks 1–4), PR 2 Arena (5–6), PR 3 Tier lists (7–9), PR 4 Quizzes (10–11), PR 5 Clients (12–15). PR 5 merges only after PRs 2–4 are live in production (see Execution notes).

## Review Focus

1. **A client's cached work id was merged away** (the keyless-grouping job ran between its read and its write). The write must store the canonical id, not 400. Test in Task 6.
2. **The owner holds two editions of one work.** A new tier-list entry must store the first copy's key by library position, so an old build sees that copy. Test in Task 4.
3. **The owner's copy key is already used by another entry of the item** (a side-table row gone stale after a book's ISBN was edited). The new entry must fall back to the work id instead of duplicating a key. Test in Task 4.
4. **An old build re-saves an item a new build wrote**, where a stored key is a bare work id (no library copy). E1's `resolveEntryWorks` would turn that key into an orphan with a NULL work; it must recognise the work id. Test in Task 4.
5. **A duel whose two sides now share a canonical work** (a later catalog merge). A works-format vote must land on side A, not 400. Test in Task 6.

---

## PR 1 — Server plumbing

### Task 1: `worksFormat`, CORS preflight cache, 503 for catalog outages, README

**Files:**
- Create: `backend/src/worksFormat.ts`
- Create: `backend/src/worksFormat.test.ts`
- Modify: `backend/src/app.ts` (CORS options ~line 84; `setErrorHandler` ~line 122)
- Modify: `backend/package.json` (`"test"` list)
- Modify: `backend/README.md` (after the "Works check" section)

**Interfaces:**
- Produces: `worksFormat(request: FastifyRequest, reply: FastifyReply): boolean` — true when the header is `1`; always appends `X-Scripta-Works` to `Vary`; logs `legacy client` otherwise.

- [ ] **Step 1: Write the failing tests** — `backend/src/worksFormat.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { test } from "node:test";
import Fastify from "fastify";

const dir = mkdtempSync(join(tmpdir(), "works-format-"));
Object.assign(process.env, {
  JWT_ACCESS_SECRET: "a".repeat(64),
  JWT_REFRESH_SECRET: "b".repeat(64),
  AUTH_DB_PATH: join(dir, "auth.sqlite"),
  LIBRARY_DB_PATH: join(dir, "library.sqlite"),
  GALLERY_DB_PATH: join(dir, "gallery.sqlite"),
  COVERS_DB_PATH: join(dir, "covers.sqlite"),
  MURALS_DB_PATH: join(dir, "murals.sqlite"),
  SOCIALS_DB_PATH: join(dir, "socials.sqlite"),
  ARENA_DB_PATH: join(dir, "arena.sqlite"),
  TIERLISTS_DB_PATH: join(dir, "tierlists.sqlite"),
  QUIZZES_DB_PATH: join(dir, "quizzes.sqlite"),
  COMMUNITY_DB_PATH: join(dir, "community.sqlite"),
  WAITLIST_DB_PATH: join(dir, "waitlist.sqlite"),
  FILES_STORAGE_PATH: join(dir, "files"),
  R2_IMAGES_BUCKET: ""
});

const { worksFormat } = await import("./worksFormat.js");
const { buildApp } = await import("./app.js");
const { WorkResolutionError } = await import("./modules/library/index.js");
const { env } = await import("./config/env.js");

function logged() {
  const lines: Array<Record<string, unknown>> = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      lines.push(JSON.parse(String(chunk)) as Record<string, unknown>);
      done();
    }
  });
  const server = Fastify({ logger: { level: "info", stream } });
  server.get("/things/:id", async (request, reply) => ({ works: worksFormat(request, reply) }));
  return { server, lines };
}

test("a request with the header gets the works format and logs nothing", async () => {
  const { server, lines } = logged();
  const res = await server.inject({ url: "/things/1", headers: { "x-scripta-works": "1" } });
  assert.deepEqual(res.json(), { works: true });
  assert.equal(res.headers.vary, "X-Scripta-Works");
  assert.equal(lines.some((line) => line.msg === "legacy client"), false);
  await server.close();
});

test("a request without the header gets today's format and logs its method and route", async () => {
  const { server, lines } = logged();
  const res = await server.inject({ url: "/things/1" });
  assert.deepEqual(res.json(), { works: false });
  assert.equal(res.headers.vary, "X-Scripta-Works");
  const legacy = lines.find((line) => line.msg === "legacy client");
  assert.equal(legacy?.method, "GET");
  assert.equal(legacy?.route, "/things/:id");
  await server.close();
});

test("an existing Vary value is kept", async () => {
  const server = Fastify();
  server.get("/v", async (request, reply) => {
    reply.header("vary", "Origin");
    return { works: worksFormat(request, reply) };
  });
  const res = await server.inject({ url: "/v" });
  assert.equal(res.headers.vary, "Origin, X-Scripta-Works");
  await server.close();
});

test("the app lets the web client send the header, caches the preflight, and answers a catalog outage with 503", async (t) => {
  const app = buildApp();
  t.after(() => app.close());
  app.get("/catalog-down", async () => {
    throw new WorkResolutionError(new Error("down"));
  });
  const preflight = await app.inject({
    method: "OPTIONS",
    url: "/library",
    headers: { origin: env.FRONTEND_URL, "access-control-request-method": "GET", "access-control-request-headers": "x-scripta-works" }
  });
  assert.equal(preflight.statusCode, 204);
  assert.match(String(preflight.headers["access-control-allow-headers"]), /x-scripta-works/i);
  assert.equal(preflight.headers["access-control-max-age"], "86400");
  const down = await app.inject({ url: "/catalog-down" });
  assert.equal(down.statusCode, 503);
  assert.match(down.json().error, /catalog/i);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx tsx --test src/worksFormat.test.ts`
Expected: FAIL — `Cannot find module './worksFormat.js'`.

- [ ] **Step 3: Implement**

`backend/src/worksFormat.ts`:

```ts
import type { FastifyReply, FastifyRequest } from "fastify";

export function worksFormat(request: FastifyRequest, reply: FastifyReply): boolean {
  const vary = reply.getHeader("vary");
  reply.header("vary", vary === undefined ? "X-Scripta-Works" : `${String(vary)}, X-Scripta-Works`);
  if (request.headers["x-scripta-works"] === "1") return true;
  request.log.info({ method: request.method, route: request.routeOptions.url }, "legacy client");
  return false;
}
```

`backend/src/app.ts` — in the `fastifyCors` options add `maxAge: 86400` after `methods`. At the top of the `setErrorHandler` callback, before `const statusCode = …`:

```ts
    if (error instanceof WorkResolutionError) return reply.code(503).send({ error: error.message });
```

(`WorkResolutionError` is already imported from `./modules/library/index.js`.) If the preflight assertion on `access-control-allow-headers` fails, `@fastify/cors` is not reflecting request headers in this version: add `allowedHeaders: ["Authorization", "Content-Type", "X-Scripta-Works"]` to the CORS options and re-run.

Add `src/worksFormat.test.ts` to the `"test"` list in `backend/package.json`.

Append to `backend/README.md` after the "Works check" section:

```markdown
### Works format (phase E2)

Web and mobile send `X-Scripta-Works: 1`. With it, arena, tier-list and quiz routes, and the tier-list map in the public mural and profile, take and return work ids (`workId`, `workIds`, `winnerWorkId`) instead of book keys; without it they answer exactly as before. Storage is unchanged until the removal: routes translate through the E1 work columns and side tables, and a works-format write stores the owner's copy key for each new work, or the work id when there is no copy. Every header-less request to one of those routes logs `legacy client` with its method and route, which is how we learn that old builds are gone. Library documents carry `works` (book key → canonical work id) and public books carry `key` and `workId` for every client. Spec: `docs/superpowers/specs/2026-10-05-works-phase-e2-design.md`.
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npx tsx --test src/worksFormat.test.ts && npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/worksFormat.ts backend/src/worksFormat.test.ts backend/src/app.ts backend/package.json backend/README.md && git commit -m "Add the works-format header check and its legacy-client log

Clients opt in to work ids with X-Scripta-Works: 1; a header-less request
logs legacy client, the signal for when old builds are gone. A catalog
outage on any route now answers 503 instead of 500.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: `LibraryDocument.works` on every library document response

**Files:**
- Modify: `backend/src/modules/library/works.ts` (add `canonicalWorkIds`)
- Modify: `backend/src/modules/library/domain/types.ts` (`LibraryDocument`, `LibraryDocumentText`)
- Modify: `backend/src/modules/library/domain/ports.ts`
- Modify: `backend/src/modules/library/adapters/sqlite/sqliteLibraryRepository.ts`
- Modify: `backend/src/modules/library/service.ts` (`toLibraryDocument`, `toLibraryDocumentText`, `createLibraryService`)
- Modify: `backend/src/modules/library/routes.ts` (`sendDocumentText`)
- Test: `backend/src/modules/library/service.test.ts`, `backend/src/modules/library/routes.test.ts`, `backend/src/modules/library/works.test.ts`

**Interfaces:**
- Produces: `canonicalWorkIds(ids: string[], canonical?: (ids: string[]) => Map<string, string>): Map<string, string>` in `library/works.ts` — dedupes, returns an empty Map for no ids without calling the catalog, wraps any catalog error in `WorkResolutionError`. Only ids the catalog knows are in the result.
- Produces: `LibraryRepository.workIds(userId): Array<{ book_key: string; work_id: string }>` (rows with a work, by position).
- Produces: `createLibraryService(…, resolveWorks?, canonicalWorks?: CanonicalWorks)` — new 9th parameter, default the catalog's `canonicalWorks`; `export type CanonicalWorks = (ids: string[]) => Map<string, string>`.
- Produces: `works: Record<string, string>` (book key → canonical work id; first row of a key wins) as the last field of `LibraryDocument` and `LibraryDocumentText`.

- [ ] **Step 1: Write the failing tests**

`works.test.ts` (import `canonicalWorkIds` alongside the existing imports):

```ts
test("canonicalWorkIds dedupes, skips the catalog for no ids, and wraps catalog errors", () => {
  const calls: string[][] = [];
  const canonical = (ids: string[]) => {
    calls.push(ids);
    return new Map(ids.map((id) => [id, id === "w-old" ? "w-new" : id]));
  };
  assert.deepEqual(canonicalWorkIds([], canonical), new Map());
  assert.deepEqual(calls, []);
  assert.deepEqual(canonicalWorkIds(["w-old", "w-old", "w-2"], canonical), new Map([["w-old", "w-new"], ["w-2", "w-2"]]));
  assert.deepEqual(calls, [["w-old", "w-2"]]);
  assert.throws(() => canonicalWorkIds(["w-1"], () => { throw new Error("down"); }), WorkResolutionError);
});
```

`service.test.ts`:

```ts
const titleWorks = (lookups: Array<{ title: string | null }>) => lookups.map((lookup) => `w-${lookup.title}`);

test("every library document answer carries each copy's canonical work", () => {
  const service = createLibraryService(createSqliteLibraryRepository(memoryDb()), () => "", 10_000_000, undefined, undefined, undefined, undefined, titleWorks, (ids) => new Map(ids.map((id) => [id, id === "w-Dune" ? "w-dune" : id])));
  const saved = service.saveLibrary("u1", { books: [{ Title: "Dune", Attribution: "Frank Herbert" }, { Title: "Orlando", Attribution: "Virginia Woolf" }] });
  const works = { "ta:dune|frank herbert": "w-dune", "ta:orlando|virginia woolf": "w-Orlando" };
  assert.deepEqual(saved.works, works);
  assert.deepEqual(service.getLibraryText("u1")!.works, works);
  assert.deepEqual(service.getLibrary("u1")!.works, works);
  assert.deepEqual(service.share("u1").works, works);
});

test("a catalog outage still answers the library with stored work ids and logs it", () => {
  const logged: string[] = [];
  const service = createLibraryService(createSqliteLibraryRepository(memoryDb()), () => "", 10_000_000, undefined, undefined, undefined, (_error, message) => logged.push(message), titleWorks, () => {
    throw new Error("catalog down");
  });
  service.saveLibrary("u1", { books: [{ Title: "Dune", Attribution: "Frank Herbert" }] });
  assert.deepEqual(service.getLibrary("u1")!.works, { "ta:dune|frank herbert": "w-Dune" });
  assert.ok(logged.some((message) => message.includes("work canonical lookup failed for u1")));
});
```

`routes.test.ts` — first add `process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");` to the preamble (the file's saves already resolve works through the real catalog and today write it under `./data`). Then:

```ts
test("PUT and GET /library answer each copy's work id", async () => {
  const { app, put } = await setup();
  const saved = await put(JSON.stringify({ data: { books: [kobo] } }));
  assert.equal(saved.statusCode, 200);
  const workId = saved.json().works["ta:dune|frank herbert"];
  assert.equal(typeof workId, "string");
  const read = await app.inject({ method: "GET", url: "/library", headers: { authorization: "Bearer u1" } });
  assert.deepEqual(read.json().works, { "ta:dune|frank herbert": workId });
  await app.close();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && npx tsx --test src/modules/library/works.test.ts src/modules/library/service.test.ts src/modules/library/routes.test.ts`
Expected: FAIL — `canonicalWorkIds` is not exported; `works` is undefined.

- [ ] **Step 3: Implement**

`works.ts`, after `WorkResolutionError`:

```ts
export function canonicalWorkIds(ids: string[], canonical: (ids: string[]) => Map<string, string> = canonicalWorks): Map<string, string> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  try {
    return canonical(unique);
  } catch (error) {
    throw new WorkResolutionError(error);
  }
}
```

`domain/types.ts` — add `works: Record<string, string>;` as the last field of both `LibraryDocument` and `LibraryDocumentText`.

`domain/ports.ts` — add to `LibraryRepository`: `workIds(userId: string): Array<{ book_key: string; work_id: string }>;`

`sqliteLibraryRepository.ts` — next to `listRowHashesStmt`:

```ts
  const workIdsStmt = db.prepare(`SELECT book_key, work_id FROM library_books WHERE user_id = ? AND work_id IS NOT NULL ORDER BY position`);
```

and in the returned object:

```ts
    workIds(userId) {
      return workIdsStmt.all(userId) as unknown as Array<{ book_key: string; work_id: string }>;
    },
```

`service.ts`:
- Import `canonicalWorks as canonicalCatalogWorks` next to `resolveWorks as resolveCatalogWorks` from `../books/index.js`, and `import { canonicalWorkIds, WorkResolutionError } from "./works.js";`.
- Add `export type CanonicalWorks = (ids: string[]) => Map<string, string>;`.
- `toLibraryDocument(row, publicUrlFor, works: Record<string, string>)` and `toLibraryDocumentText(row, publicUrlFor, works: Record<string, string>)` add `works` as their last field.
- Signature: `createLibraryService(repo, publicUrlFor, maxDocumentBytes, emitBookEvents?, enqueueCovers?, rekeyBooks?, logError?, resolveWorks: ResolveWorks = resolveCatalogWorks, canonicalWorks: CanonicalWorks = canonicalCatalogWorks)`.
- Inside, after `rowsWithWorks`:

```ts
  function worksOf(userId: string): Record<string, string> {
    const rows = repo.workIds(userId);
    let canonical = new Map<string, string>();
    try {
      canonical = canonicalWorkIds(rows.map((row) => row.work_id), canonicalWorks);
    } catch (error) {
      if (!(error instanceof WorkResolutionError)) throw error;
      logSkipped(error, `work canonical lookup failed for ${userId}`);
    }
    const works: Record<string, string> = {};
    for (const row of rows) works[row.book_key] ??= canonical.get(row.work_id) ?? row.work_id;
    return works;
  }
```

- Every `toLibraryDocument(…)`/`toLibraryDocumentText(…)` call passes `worksOf(userId)` as the third argument: `getLibrary`, `getLibraryText`, `saveLibrary`, both returns of `mergeBooks`, both returns of `share`.

`routes.ts` — `sendDocumentText` ends the body with `,"works":${JSON.stringify(document.works)}}` (after `shareUrl`).

Then run the whole backend suite and add `works` to any existing expectation that compares a whole library document (for example `publicViews.test.ts`'s "GET /library sends the stored document as UTF-8 JSON"); nothing else changes.

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/library && git commit -m "Return each library copy's work with every library document

Clients need a work id for each book to send works to the games and to
link the work page. The map is derived from library_books, never stored
in the document, and a catalog outage falls back to the stored ids.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: Public books carry `key` and `workId`

**Files:**
- Modify: `backend/src/modules/library/publicResolver.ts` (`PublicBookData`, `BookRowRecord`, `BOOK_COLUMNS`, `toPublicBooks`)
- Test: `backend/src/modules/library/publicViews.test.ts`; existing expectations in `backend/src/modules/murals/routes.test.ts`, `backend/src/modules/tierlists/routes.test.ts`, `backend/src/modules/community/*.test.ts` that compare public books

**Interfaces:**
- Consumes: `canonicalWorkIds` (Task 2).
- Produces: `PublicBookData` gains `key: string` (the row's `book_key`) and `workId: string | null` (canonical), as its last two fields.

- [ ] **Step 1: Write the failing test** — in `publicViews.test.ts` add `const { resolveWorks } = await import("../books/index.js");` to the imports, then:

```ts
test("public books carry their row's key and canonical work, even for a keyless book with no author", () => {
  const userId = "public-works";
  service.saveLibrary(userId, { books: [{ ContentID: "w1", Title: "Orlando", Attribution: "", ReadStatus: 1 }] });
  const row = openLibraryDb().prepare("SELECT book_key, work_id FROM library_books WHERE user_id = ?").get(userId) as { book_key: string; work_id: string };
  assert.equal(row.book_key, "ta:orlando|");
  const request = { bookKeys: [row.book_key], highlightRefs: [], needsCurrentlyReading: true, statsMetrics: [] };
  const before = resolvePublicLibraryData(userId, request);
  assert.equal(before.books[0]!.author, "Unknown author");
  assert.equal(before.books[0]!.key, "ta:orlando|");
  assert.equal(before.books[0]!.workId, row.work_id);
  assert.equal(before.currentlyReading[0]!.workId, row.work_id);
  const [target] = resolveWorks([{ isbn: null, title: "Orlando: A Biography", author: "Virginia Woolf" }]);
  openBooksDb().prepare("UPDATE works SET merged_into = ? WHERE id = ?").run(target, row.work_id);
  assert.equal(resolvePublicLibraryData(userId, request).books[0]!.workId, target);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx tsx --test src/modules/library/publicViews.test.ts`
Expected: FAIL — `key` is undefined.

- [ ] **Step 3: Implement** — in `publicResolver.ts`:
- `PublicBookData` gains `key: string;` and `workId: string | null;` (last).
- `BookRowRecord` gains `work_id: string | null;`; `BOOK_COLUMNS` selects `…, cover_url, work_id FROM library_books`.
- Import `canonicalWorkIds` from `./works.js`.
- `toPublicBooks`:

```ts
function toPublicBooks(rows: BookRowRecord[]): PublicBookData[] {
  const covers = coversOf(rows);
  const works = canonicalWorkIds(rows.flatMap((row) => (row.work_id ? [row.work_id] : [])));
  return rows.map((row) => ({
    title: row.title || "Untitled",
    author: row.author || "Unknown author",
    isbn: isbnOf(row),
    imageId: normalizeImageId(row.image_id) || null,
    coverUrl: row.cover_url ?? covers.get(row) ?? null,
    readStatus: row.read_status,
    key: row.book_key,
    workId: row.work_id && (works.get(row.work_id) ?? row.work_id)
  }));
}
```

Run the whole backend suite. Every failing expectation that compares a public book (mural payload, profile mural, tier-list voting board live resolve, tier-list `public_books` snapshot written at create/open-voting) gains exactly `key` and `workId`: read the expected `workId` from `library_books` for that user and key. Change nothing else.

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules && git commit -m "Give public books their key and work

Public clients rebuilt bookKey from keyless book data and matched it
against keys in the same payload, which already failed for a keyless book
with no author. With the key and work on each book they can match exactly.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: Game work helpers in `library/works.ts`

**Files:**
- Modify: `backend/src/modules/library/works.ts`
- Modify: `backend/src/modules/library/index.ts` (exports)
- Test: `backend/src/modules/library/works.test.ts`

**Interfaces:**
- Consumes: `canonicalWorkIds`, `WorkResolutionError` (Task 2).
- Produces (all exported from `library/index.ts`):
  - `class UnknownWorkError extends Error` — message `That book isn't in the catalog.`
  - `knownWorkIds(ids: string[], canonical?): string[]` — canonical id per input id, in order; throws `UnknownWorkError` for an id the catalog doesn't know.
  - `canonicalByKey(stored: Map<string, string | null>, canonical?): Map<string, string>` — key → canonical work; NULL works left out.
  - `firstKeyPerWork(keys: string[], works: Map<string, string>): Map<string, string>` — work → first key in `keys` order.
  - `createCopyKeysResolver({ db, canonicalWorks })` and `copyKeysForWorks(ownerUserId: string, workIds: string[]): Map<string, string>` — work → the owner's first copy key by position.
  - `keysForWorks(ownerUserId: string, workIds: string[], existing: Map<string, string>, copyKeys?): Map<string, string>` — work → key to store (existing → its key; else copy key unless used; else the work id).
  - `resolveTitleWorks(books: Array<{ title: string; author: string }>, resolve?): Array<string | null>` — `resolveWorks` by title and author, errors wrapped in `WorkResolutionError`.
  - `resolveEntryWorks` also resolves a key that is itself a catalog work id (no library row, no title or ISBN).

- [ ] **Step 1: Write the failing tests** — `works.test.ts`, extend the import with `canonicalByKey, createCopyKeysResolver, firstKeyPerWork, keysForWorks, knownWorkIds, resolveTitleWorks, UnknownWorkError`, then:

```ts
const catalog = (known: Record<string, string>) => (ids: string[]) => new Map(ids.flatMap((id) => (id in known ? [[id, known[id]!] as [string, string]] : [])));

test("knownWorkIds canonicalises in order and refuses an unknown id", () => {
  const canonical = catalog({ "w-old": "w-new", "w-2": "w-2" });
  assert.deepEqual(knownWorkIds(["w-2", "w-old"], canonical), ["w-2", "w-new"]);
  assert.throws(() => knownWorkIds(["w-2", "w-gone"], canonical), UnknownWorkError);
  assert.throws(() => knownWorkIds(["w-2"], () => { throw new Error("down"); }), WorkResolutionError);
});

test("canonicalByKey maps keys through merges and leaves NULL works out", () => {
  const stored = new Map<string, string | null>([["k1", "w-old"], ["k2", null], ["k3", "w-3"]]);
  assert.deepEqual(canonicalByKey(stored, catalog({ "w-old": "w-new", "w-3": "w-3" })), new Map([["k1", "w-new"], ["k3", "w-3"]]));
});

test("firstKeyPerWork keeps the first key of each work in the given order", () => {
  assert.deepEqual(firstKeyPerWork(["k2", "k1", "k3"], new Map([["k1", "w1"], ["k2", "w1"], ["k3", "w3"]])), new Map([["w1", "k2"], ["w3", "k3"]]));
});

test("copy keys pick the owner's first copy of each work by position, through merges", () => {
  const db = new DatabaseSync(":memory:");
  applyLibrarySchema(db);
  const row = db.prepare("INSERT INTO library_books (user_id, position, book_key, title, author, isbn, row_hash, work_id) VALUES (?, ?, ?, 'T', 'A', NULL, 'h', ?)");
  row.run("u1", 0, "isbn:9780441013593", "w-pt");
  row.run("u1", 1, "isbn:9780441172719", "w-dune");
  row.run("u1", 2, "ta:orlando|virginia woolf", "w-orlando");
  row.run("u2", 0, "ta:other|x", "w-dune");
  const copies = createCopyKeysResolver({ db, canonicalWorks: catalog({ "w-pt": "w-dune", "w-dune": "w-dune", "w-orlando": "w-orlando" }) });
  assert.deepEqual(copies("u1", ["w-dune", "w-none"]), new Map([["w-dune", "isbn:9780441013593"]]));
  assert.deepEqual(copies("u1", []), new Map());
});

test("keysForWorks keeps existing keys, uses a free copy key, else the work id", () => {
  const copyKeys = (_owner: string, ids: string[]) => new Map(ids.flatMap((id) => (id === "w-copy" ? [["w-copy", "isbn:1"] as [string, string]] : id === "w-taken" ? [["w-taken", "k-existing"] as [string, string]] : [])));
  const existing = new Map([["w-old", "k-existing"]]);
  assert.deepEqual(keysForWorks("u1", ["w-old", "w-copy", "w-none", "w-taken"], existing, copyKeys), new Map([["w-old", "k-existing"], ["w-copy", "isbn:1"], ["w-none", "w-none"], ["w-taken", "w-taken"]]));
});

test("a key that is itself a catalog work resolves to that work", () => {
  const db = new DatabaseSync(":memory:");
  applyLibrarySchema(db);
  const resolver = createEntryWorksResolver({ db, resolveWorks: () => { throw new Error("no lookups expected"); }, canonicalWorks: catalog({ "w-solo": "w-solo-canonical" }) });
  const works = resolver("u1", [{ key: "w-solo" }, { key: "isbn:gone" }]);
  assert.equal(works.get("w-solo")?.workId, "w-solo-canonical");
  assert.equal(works.get("isbn:gone")?.workId, null);
});

test("resolveTitleWorks looks books up by title and author and wraps catalog errors", () => {
  const seen: unknown[] = [];
  assert.deepEqual(resolveTitleWorks([{ title: "1984", author: "George Orwell" }], (lookups) => { seen.push(...lookups); return ["w-1984"]; }), ["w-1984"]);
  assert.deepEqual(seen, [{ isbn: null, title: "1984", author: "George Orwell" }]);
  assert.deepEqual(resolveTitleWorks([], () => { throw new Error("not called"); }), []);
  assert.throws(() => resolveTitleWorks([{ title: "1984", author: "" }], () => { throw new Error("down"); }), WorkResolutionError);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && npx tsx --test src/modules/library/works.test.ts`
Expected: FAIL — the new names are not exported.

- [ ] **Step 3: Implement** — in `works.ts`:

```ts
export class UnknownWorkError extends Error {
  constructor() {
    super("That book isn't in the catalog.");
  }
}

export function knownWorkIds(ids: string[], canonical: (ids: string[]) => Map<string, string> = canonicalWorks): string[] {
  const found = canonicalWorkIds(ids, canonical);
  return ids.map((id) => {
    const work = found.get(id);
    if (!work) throw new UnknownWorkError();
    return work;
  });
}

export function canonicalByKey(stored: Map<string, string | null>, canonical: (ids: string[]) => Map<string, string> = canonicalWorks): Map<string, string> {
  const found = canonicalWorkIds([...stored.values()].filter((id): id is string => id !== null), canonical);
  const result = new Map<string, string>();
  for (const [key, id] of stored) if (id) result.set(key, found.get(id) ?? id);
  return result;
}

export function firstKeyPerWork(keys: string[], works: Map<string, string>): Map<string, string> {
  const result = new Map<string, string>();
  for (const key of keys) {
    const work = works.get(key);
    if (work && !result.has(work)) result.set(work, key);
  }
  return result;
}

export function createCopyKeysResolver(deps: { db: DatabaseSync; canonicalWorks: (ids: string[]) => Map<string, string> }) {
  const rowsStmt = deps.db.prepare(`SELECT book_key, work_id FROM library_books WHERE user_id = ? AND work_id IS NOT NULL ORDER BY position`);
  return (ownerUserId: string, workIds: string[]): Map<string, string> => {
    const wanted = new Set(workIds);
    const result = new Map<string, string>();
    if (wanted.size === 0) return result;
    const rows = rowsStmt.all(ownerUserId) as unknown as Array<{ book_key: string; work_id: string }>;
    const found = canonicalWorkIds(rows.map((row) => row.work_id), deps.canonicalWorks);
    for (const row of rows) {
      const work = found.get(row.work_id) ?? row.work_id;
      if (wanted.has(work) && !result.has(work)) result.set(work, row.book_key);
    }
    return result;
  };
}

let copyKeysResolver: ReturnType<typeof createCopyKeysResolver> | null = null;

export function copyKeysForWorks(ownerUserId: string, workIds: string[]): Map<string, string> {
  copyKeysResolver ??= createCopyKeysResolver({ db: openLibraryDb(), canonicalWorks });
  return copyKeysResolver(ownerUserId, workIds);
}

export function keysForWorks(ownerUserId: string, workIds: string[], existing: Map<string, string>, copyKeys: (ownerUserId: string, workIds: string[]) => Map<string, string> = copyKeysForWorks): Map<string, string> {
  const unique = [...new Set(workIds)];
  const copies = copyKeys(ownerUserId, unique.filter((id) => !existing.has(id)));
  const used = new Set(existing.values());
  const result = new Map<string, string>();
  for (const id of unique) {
    let key = existing.get(id);
    if (key === undefined) {
      const copy = copies.get(id);
      key = copy !== undefined && !used.has(copy) ? copy : id;
      used.add(key);
    }
    result.set(id, key);
  }
  return result;
}

export function resolveTitleWorks(books: Array<{ title: string; author: string }>, resolve: (lookups: WorkLookup[]) => Array<string | null> = resolveWorks): Array<string | null> {
  if (books.length === 0) return [];
  try {
    return resolve(books.map((book) => ({ isbn: null, title: book.title, author: book.author })));
  } catch (error) {
    throw new WorkResolutionError(error);
  }
}
```

In `createEntryWorksResolver`, collect keys with no library row and no title or ISBN:

```ts
    const bare: string[] = [];
```

change the last branch of the `for (const [key, entry] of byKey)` loop to:

```ts
      else if (entry.title || entry.isbn) pending.push({ key, lookup: { isbn: entry.isbn ?? null, title: entry.title ?? null, author: entry.author ?? null } });
      else bare.push(key);
```

and at the end of the `try` block:

```ts
      const known = bare.length > 0 ? deps.canonicalWorks(bare) : new Map<string, string>();
      for (const key of bare) result.get(key)!.workId = known.get(key) ?? null;
```

Export from `library/index.ts`: `UnknownWorkError, canonicalByKey, canonicalWorkIds, copyKeysForWorks, firstKeyPerWork, keysForWorks, knownWorkIds, resolveTitleWorks`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npx tsx --test src/modules/library/works.test.ts && npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/library && git commit -m "Add the helpers that turn a client's work ids into stored keys

A new work stores the owner's first copy key so old builds still find the
book, or the work id when there is no copy. An old build re-saving such an
item sends that bare work id back, so resolveEntryWorks now recognises it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## PR 2 — Arena

### Task 5: Arena views carry works; reads speak the works format

**Files:**
- Modify: `backend/src/modules/arena/service.ts`
- Create: `backend/src/modules/arena/wire.ts`
- Modify: `backend/src/modules/arena/routes.ts` (GET `/arenas/mine`, `/arenas/voted`, `/arenas/public`, `/arenas/:id`)
- Test: `backend/src/modules/arena/service.test.ts`, `backend/src/modules/arena/routes.test.ts`

**Interfaces:**
- Consumes: `canonicalWorkIds` (Task 2), `worksFormat` (Task 1).
- Produces in `service.ts`:
  - `interface SeedBookView { key: string; workId: string | null; title: string; author: string; cover: string | null }`; `TournamentSummary.winner: SeedBookView | null`; `DuelSideView extends SeedBookView { votes }`; `DuelView.winnerWorkId: string | null` (after `winnerKey`); `TournamentView.slots: Array<{ slotIndex: number } & SeedBookView>`.
  - `type BookChoice = string | { workId: string }` — a book key, or a work.
  - `vote(tournamentId, duelId, voterToken, choice: BookChoice, voterUserId?)`, `tiebreak(tournamentId, ownerUserId, duelId, choice: BookChoice)`.
  - `seedingSlots(tournamentId, ownerUserId): TournamentSlotRow[]` — throws `TournamentNotFoundError` / `TournamentAlreadyStartedError` exactly like `setSlotsManual`.
  - `createArenaService(repo, emitPublished?, emitVotedOn?, canonicalWorks = canonicalWorkIds)`.
- Produces in `wire.ts`: `summariesForWire(summaries: TournamentSummary[], works: boolean)`, `tournamentForWire(view: TournamentView, works: boolean)`.

- [ ] **Step 1: Write the failing tests**

`service.test.ts` (uses the file's `createInMemoryArenaRepository`, `makeBook`, `resolveByWorkId`):

```ts
const canonicalIdentity = (ids: string[]) => new Map(ids.map((id) => [id, id]));

function startedDuel(canonical: (ids: string[]) => Map<string, string> = canonicalIdentity) {
  const service = createArenaService(createInMemoryArenaRepository(), undefined, undefined, canonical);
  const tournament = service.createTournament("owner-1", { name: "Test", bracketSize: 2, roundDurationMinutes: 60 });
  service.setSlotsManual(tournament.id, "owner-1", [
    { slotIndex: 0, book: { ...makeBook(1), workId: "w1" } },
    { slotIndex: 1, book: { ...makeBook(2), workId: "w2" } }
  ], resolveByWorkId);
  service.start(tournament.id, "owner-1");
  const duel = service.getTournamentView(tournament.id)!.duels[0]!;
  return { service, tournament, duel };
}

test("views carry each slot's, side's and winner's work", () => {
  const { service, tournament, duel } = startedDuel();
  const view = service.getTournamentView(tournament.id)!;
  assert.deepEqual(view.slots.map((slot) => slot.workId), ["w1", "w2"]);
  assert.deepEqual([duel.bookA.workId, duel.bookB.workId, duel.winnerWorkId], ["w1", "w2", null]);
  service.vote(tournament.id, duel.id, "v1", "book-2");
  service.settleEarly(tournament.id, "owner-1", duel.id);
  const settled = service.getTournamentView(tournament.id)!;
  assert.equal(settled.duels[0]!.winnerWorkId, "w2");
  assert.equal(settled.winner?.workId, "w2");
});

test("a vote by work lands on the side holding that work, through merges", () => {
  const { service, tournament, duel } = startedDuel((ids) => new Map(ids.map((id) => [id, id === "w2-old" ? "w2" : id])));
  service.vote(tournament.id, duel.id, "v1", { workId: "w2-old" });
  assert.equal(service.getTournamentView(tournament.id)!.duels[0]!.bookB.votes, 1);
  assert.throws(() => service.vote(tournament.id, duel.id, "v2", { workId: "w9" }), InvalidBookError);
});

test("a vote by work for a duel whose sides share a work goes to side A", () => {
  const { service, tournament, duel } = startedDuel((ids) => new Map(ids.map((id) => [id, id === "w2" ? "w1" : id])));
  service.vote(tournament.id, duel.id, "v1", { workId: "w1" });
  const after = service.getTournamentView(tournament.id)!.duels[0]!;
  assert.deepEqual([after.bookA.votes, after.bookB.votes], [1, 0]);
});

test("a tiebreak by work settles that side", () => {
  const { service, tournament, duel } = startedDuel();
  service.settleEarly(tournament.id, "owner-1", duel.id);
  service.tiebreak(tournament.id, "owner-1", duel.id, { workId: "w2" });
  assert.equal(service.getTournamentView(tournament.id)!.duels[0]!.winnerKey, "book-2");
});

test("seedingSlots answers only the owner of a tournament still seeding", () => {
  const { service, tournament } = startedDuel();
  assert.throws(() => service.seedingSlots(tournament.id, "owner-1"), TournamentAlreadyStartedError);
  assert.throws(() => service.seedingSlots(tournament.id, "someone"), TournamentNotFoundError);
  const seeding = service.createTournament("owner-1", { name: "Next", bracketSize: 2, roundDurationMinutes: 60 });
  assert.deepEqual(service.seedingSlots(seeding.id, "owner-1"), []);
});
```

`routes.test.ts` — add a works-format read test using the existing `arenaApp`/`putSlots` helpers:

```ts
test("GET /arenas/:id and /arenas/mine speak works with the header and keys without it", async () => {
  const { app, id } = await arenaApp();
  assert.equal((await putSlots(app, id, [
    { key: "ta:dune|frank herbert", title: "Dune", author: "Frank Herbert" },
    { key: "ta:orlando|virginia woolf", title: "Orlando", author: "Virginia Woolf" }
  ])).statusCode, 204);
  const works = await app.inject({ method: "GET", url: `/arenas/${id}`, headers: { "x-scripta-works": "1" } });
  assert.match(String(works.headers.vary), /X-Scripta-Works/);
  const slots = works.json().tournament.slots as Array<Record<string, unknown>>;
  assert.deepEqual(Object.keys(slots[0]!), ["slotIndex", "workId", "title", "author", "cover"]);
  assert.equal(typeof slots[0]!.workId, "string");
  const legacy = await app.inject({ method: "GET", url: `/arenas/${id}` });
  assert.deepEqual(Object.keys(legacy.json().tournament.slots[0]), ["slotIndex", "key", "title", "author", "cover"]);
  assert.doesNotMatch(legacy.body, /workId/);
  const mine = await app.inject({ method: "GET", url: "/arenas/mine", headers: { authorization: "Bearer u1", "x-scripta-works": "1" } });
  assert.equal(mine.json().tournaments[0].winner, null);
  await app.close();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && npx tsx --test src/modules/arena/service.test.ts src/modules/arena/routes.test.ts`
Expected: FAIL — `workId` undefined on views; works-format slots still carry `key`.

- [ ] **Step 3: Implement `service.ts`**
- Add `SeedBookView`, `BookChoice` and the view type changes listed under Interfaces. Import `canonicalWorkIds` from `../library/index.js`.
- `toTournamentSummary`: `winner: winner && { key: winner.key, workId: winner.workId ?? null, title: winner.title, author: winner.author, cover: winner.cover }`.
- `toDuelView`: `bookA: { key: d.book_a_key, workId: d.book_a_work_id, title: d.book_a_title, author: d.book_a_author, cover: d.book_a_cover, votes: counts[d.book_a_key] ?? 0 }`, `bookB` likewise, and `winnerWorkId: d.winner_work_id` right after `winnerKey`.
- `getTournamentView` slots: `{ slotIndex: s.slot_index, key: s.book_key, workId: s.work_id, title: s.title, author: s.author, cover: s.cover_url }`.
- `createArenaService(repo, emitPublished?, emitVotedOn?, canonicalWorks: (ids: string[]) => Map<string, string> = canonicalWorkIds)`; inside it:

```ts
  function sideKey(duel: DuelRow, choice: BookChoice): string {
    if (typeof choice === "string") {
      if (choice !== duel.book_a_key && choice !== duel.book_b_key) throw new InvalidBookError();
      return choice;
    }
    const found = canonicalWorks([choice.workId, ...[duel.book_a_work_id, duel.book_b_work_id].filter((id): id is string => id !== null)]);
    const workOf = (id: string | null) => (id === null ? null : found.get(id) ?? id);
    const wanted = workOf(choice.workId);
    if (workOf(duel.book_a_work_id) === wanted) return duel.book_a_key;
    if (workOf(duel.book_b_work_id) === wanted) return duel.book_b_key;
    throw new InvalidBookError();
  }
```

- `vote(tournamentId, duelId, voterToken, choice, voterUserId = null)`: replace the key check with `const bookKey = sideKey(duel, choice);` (after the `DuelNotVotableError` check) and store `book_key: bookKey`.
- `tiebreak(tournamentId, ownerUserId, duelId, choice)`: after the `DuelNotTiedError` check, `const winnerBookKey = sideKey(duel, choice);`, then settle with it.
- Add `seedingSlots`:

```ts
    seedingSlots(tournamentId, ownerUserId) {
      const tournament = repo.getOwnedTournament(tournamentId, ownerUserId);
      if (!tournament) throw new TournamentNotFoundError();
      if (tournament.status !== "seeding") throw new TournamentAlreadyStartedError();
      return repo.getSlots(tournamentId);
    },
```

Existing service tests that `deepEqual` whole views gain the new `workId`/`winnerWorkId` fields; update only those.

- [ ] **Step 4: Implement `wire.ts` and the read routes**

`backend/src/modules/arena/wire.ts`:

```ts
import { canonicalWorkIds } from "../library/index.js";
import type { DuelSideView, DuelView, SeedBookView, TournamentSummary, TournamentView } from "./service.js";

type Canonical = Map<string, string> | null;

function workOf(id: string | null, canonical: Map<string, string>): string | null {
  return id === null ? null : canonical.get(id) ?? id;
}

function bookForWire(book: SeedBookView, canonical: Canonical) {
  return canonical
    ? { workId: workOf(book.workId, canonical), title: book.title, author: book.author, cover: book.cover }
    : { key: book.key, title: book.title, author: book.author, cover: book.cover };
}

function sideForWire(side: DuelSideView, canonical: Canonical) {
  return { ...bookForWire(side, canonical), votes: side.votes };
}

function duelForWire(duel: DuelView, canonical: Canonical) {
  const winner = canonical ? { winnerWorkId: workOf(duel.winnerWorkId, canonical) } : { winnerKey: duel.winnerKey };
  return {
    id: duel.id,
    roundNumber: duel.roundNumber,
    duelIndex: duel.duelIndex,
    bookA: sideForWire(duel.bookA, canonical),
    bookB: sideForWire(duel.bookB, canonical),
    ...winner,
    status: duel.status,
    opensAt: duel.opensAt,
    closesAt: duel.closesAt,
    hasVoted: duel.hasVoted
  };
}

function summaryForWire<T extends TournamentSummary>(summary: T, canonical: Canonical) {
  return { ...summary, winner: summary.winner && bookForWire(summary.winner, canonical) };
}

function canonicalFor(works: boolean, ids: Array<string | null>): Canonical {
  return works ? canonicalWorkIds(ids.filter((id): id is string => id !== null)) : null;
}

export function summariesForWire(summaries: TournamentSummary[], works: boolean) {
  const canonical = canonicalFor(works, summaries.map((summary) => summary.winner?.workId ?? null));
  return summaries.map((summary) => summaryForWire(summary, canonical));
}

export function tournamentForWire(view: TournamentView, works: boolean) {
  const canonical = canonicalFor(works, [
    view.winner?.workId ?? null,
    ...view.slots.map((slot) => slot.workId),
    ...view.duels.flatMap((duel) => [duel.bookA.workId, duel.bookB.workId, duel.winnerWorkId])
  ]);
  return {
    ...summaryForWire(view, canonical),
    slots: view.slots.map(({ slotIndex, ...book }) => ({ slotIndex, ...bookForWire(book, canonical) })),
    duels: view.duels.map((duel) => duelForWire(duel, canonical))
  };
}
```

In `routes.ts` import `worksFormat` from `../../worksFormat.js` and `summariesForWire, tournamentForWire` from `./wire.js`:
- `GET /arenas/mine`: `return reply.send({ tournaments: summariesForWire(service.listMine(request.user.id), worksFormat(request, reply)) });`, and the same for `/arenas/voted` (`listVoted`) and `/arenas/public` (`listPublic`, after the query parse).
- `GET /arenas/:id`: call `const works = worksFormat(request, reply);` first in the handler, and send `{ tournament: tournamentForWire(tournament, works) }`.
- Vote route: `service.vote(…, body.data.bookKey, …)` stays (a string is a key). Tiebreak route: `service.tiebreak(…, body.data.winnerBookKey)` stays.

- [ ] **Step 5: Run to verify it passes**

Run: `cd backend && npx tsx --test src/modules/arena/service.test.ts src/modules/arena/routes.test.ts && npm run typecheck && npm test`
Expected: PASS, including every existing arena route test unchanged.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/arena && git commit -m "Speak works on arena reads when the client asks

Views now carry each slot's, side's and winner's work; the wire layer
keeps today's bytes without the header and swaps keys for canonical work
ids with it. Votes and tiebreaks can name a work as well as a key.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: Arena writes in the works format

**Files:**
- Modify: `backend/src/modules/arena/wire.ts` (add `keyedSeedBooks`)
- Modify: `backend/src/modules/arena/routes.ts` (`PUT /arenas/:id/slots`, `POST /arenas/:id/random-fill`, `POST …/tiebreak`, vote route)
- Test: `backend/src/modules/arena/routes.test.ts`

**Interfaces:**
- Consumes: `knownWorkIds`, `canonicalByKey`, `firstKeyPerWork`, `keysForWorks`, `UnknownWorkError` (Task 4); `seedingSlots`, `BookChoice` (Task 5).
- Produces: `keyedSeedBooks<T extends { workId: string }>(ownerUserId: string, books: T[], slots: TournamentSlotRow[]): { books: Array<Omit<T, "workId"> & { key: string }>; works: Map<string, { workId: string | null }>; ids: string[] }`.

- [ ] **Step 1: Write the failing tests** — `routes.test.ts`; add to the dynamic imports:

```ts
const { buildVoteRoute } = await import("./routes.js");
const { resolveWorks } = await import("../books/index.js");
const { openBooksDb } = await import("../books/adapters/sqlite/connection.js");
const { openLibraryDb } = await import("../library/adapters/sqlite/connection.js");
```

(`buildVoteRoute` can join the existing `buildArenaRoutes` import.) Then:

```ts
function libraryCopy(userId: string, position: number, key: string, workId: string) {
  openLibraryDb().prepare("INSERT INTO library_books (user_id, position, book_key, title, author, row_hash, work_id) VALUES (?, ?, ?, 'T', 'A', 'h', ?)").run(userId, position, key, workId);
}

async function worksArena(owner: string) {
  const db = new DatabaseSync(":memory:");
  applyArenaMigrations(db);
  const service = createArenaService(createSqliteArenaRepository(db));
  const app = Fastify();
  app.decorate("authenticateAccessToken", (token: string) => ({ id: token, email: `${token}@example.test`, username: token, avatarId: null }));
  await app.register(buildArenaRoutes(service));
  await app.register(buildVoteRoute(service));
  const created = await app.inject({ method: "POST", url: "/arenas", headers: { authorization: `Bearer ${owner}` }, payload: { name: "Works", bracketSize: 2, roundDurationMinutes: 60 } });
  const headers = { authorization: `Bearer ${owner}`, "x-scripta-works": "1" };
  const id = created.json().tournament.id as string;
  const seed = (books: Array<{ workId: string; title: string }>) =>
    app.inject({ method: "PUT", url: `/arenas/${id}/slots`, headers, payload: { slots: books.map((book, slotIndex) => ({ slotIndex, book: { ...book, author: "Someone", cover: null } })) } });
  const view = async () => (await app.inject({ method: "GET", url: `/arenas/${id}`, headers: { "x-scripta-works": "1" } })).json().tournament;
  return { app, db, id, headers, seed, view };
}

const work = (title: string) => resolveWorks([{ isbn: null, title, author: "Someone" }])[0]!;

test("works-format slots store the owner's copy key, or the work id with no copy", async () => {
  const [kept, loose] = [work("Copy Kept"), work("No Copy")];
  libraryCopy("a1", 0, "isbn:9780000000001", kept);
  const { app, db, id, seed, view } = await worksArena("a1");
  assert.equal((await seed([{ workId: kept, title: "Copy Kept" }, { workId: loose, title: "No Copy" }])).statusCode, 204);
  const rows = (db.prepare("SELECT book_key, work_id FROM tournament_slots WHERE tournament_id = ? ORDER BY slot_index").all(id) as Array<Record<string, unknown>>).map((row) => ({ ...row }));
  assert.deepEqual(rows, [{ book_key: "isbn:9780000000001", work_id: kept }, { book_key: loose, work_id: loose }]);
  assert.deepEqual((await view()).slots.map((slot: { workId: string }) => slot.workId), [kept, loose]);
  const legacy = await app.inject({ method: "GET", url: `/arenas/${id}` });
  assert.deepEqual(legacy.json().tournament.slots.map((slot: { key: string }) => slot.key), ["isbn:9780000000001", loose]);
  await app.close();
});

test("a merged-away work id is stored as its canonical work", async () => {
  const [old, target, other] = [work("Merged Away"), work("Merge Target"), work("Other Side")];
  openBooksDb().prepare("UPDATE works SET merged_into = ? WHERE id = ?").run(target, old);
  const { app, db, id, seed } = await worksArena("a2");
  assert.equal((await seed([{ workId: old, title: "Merged Away" }, { workId: other, title: "Other Side" }])).statusCode, 204);
  assert.equal((db.prepare("SELECT work_id FROM tournament_slots WHERE tournament_id = ? AND slot_index = 0").get(id) as { work_id: string }).work_id, target);
  await app.close();
});

test("works-format slots reject an unknown work and two editions of one work", async () => {
  const [old, target] = [work("Edition One"), work("Edition Two")];
  openBooksDb().prepare("UPDATE works SET merged_into = ? WHERE id = ?").run(target, old);
  const { app, seed } = await worksArena("a3");
  const unknown = await seed([{ workId: "not-a-work", title: "X" }, { workId: target, title: "Edition Two" }]);
  assert.equal(unknown.statusCode, 400);
  assert.equal(unknown.json().error, "That book isn't in the catalog.");
  const duplicate = await seed([{ workId: target, title: "Edition Two" }, { workId: old, title: "Edition One" }]);
  assert.equal(duplicate.statusCode, 409);
  assert.match(duplicate.json().error, /Edition One/);
  await app.close();
});

test("votes and tiebreaks by work, including a duel whose sides now share a work", async () => {
  const [a, b] = [work("Side A Book"), work("Side B Book")];
  const { app, db, id, headers, seed, view } = await worksArena("a4");
  await seed([{ workId: a, title: "Side A Book" }, { workId: b, title: "Side B Book" }]);
  assert.equal((await app.inject({ method: "POST", url: `/arenas/${id}/start`, headers })).statusCode, 204);
  const duelId = (await view()).duels[0].id as string;
  const vote = (voterToken: string, workId: string) => app.inject({ method: "POST", url: `/arenas/${id}/duels/${duelId}/vote`, headers: { "x-scripta-works": "1" }, payload: { voterToken, workId } });
  assert.equal((await vote("v1", b)).statusCode, 204);
  assert.equal((await vote("v2", "not-a-work")).statusCode, 400);
  assert.equal((await view()).duels[0].bookB.votes, 1);
  db.prepare("UPDATE duels SET book_b_work_id = book_a_work_id WHERE id = ?").run(duelId);
  assert.equal((await vote("v3", a)).statusCode, 204);
  assert.equal((await view()).duels[0].bookA.votes, 1);
  await app.inject({ method: "POST", url: `/arenas/${id}/duels/${duelId}/settle`, headers });
  assert.equal((await view()).duels[0].status, "tied_pending_tiebreak");
  assert.equal((await app.inject({ method: "POST", url: `/arenas/${id}/duels/${duelId}/tiebreak`, headers, payload: { winnerWorkId: a } })).statusCode, 204);
  assert.equal((await view()).duels[0].winnerWorkId, a);
  await app.close();
});

test("works-format random fill keeps one slot per work", async () => {
  const [a, b, c] = [work("Fill One"), work("Fill Two"), work("Fill Three")];
  const { app, db, id, headers } = await worksArena("a5");
  const res = await app.inject({ method: "POST", url: `/arenas/${id}/random-fill`, headers, payload: { pool: [a, a, b, c].map((workId) => ({ workId, title: "T", author: "A", cover: null })) } });
  assert.equal(res.statusCode, 204);
  const stored = (db.prepare("SELECT work_id FROM tournament_slots WHERE tournament_id = ?").all(id) as Array<{ work_id: string }>).map((row) => row.work_id);
  assert.equal(new Set(stored).size, 2);
  await app.close();
});
```

(The tie in the vote test: after `v3` both sides have one vote, so settle leaves it tied.)

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && npx tsx --test src/modules/arena/routes.test.ts`
Expected: FAIL — works-format bodies are rejected with 400 by today's schemas.

- [ ] **Step 3: Implement**

`wire.ts` — add:

```ts
import { canonicalByKey, firstKeyPerWork, keysForWorks, knownWorkIds } from "../library/index.js";
import type { TournamentSlotRow } from "./domain/types.js";

export function keyedSeedBooks<T extends { workId: string }>(ownerUserId: string, books: T[], slots: TournamentSlotRow[]) {
  const ids = knownWorkIds(books.map((book) => book.workId));
  const stored = canonicalByKey(new Map(slots.map((slot) => [slot.book_key, slot.work_id])));
  const keys = keysForWorks(ownerUserId, ids, firstKeyPerWork(slots.map((slot) => slot.book_key), stored));
  const works = new Map<string, { workId: string | null }>();
  const keyed = books.map(({ workId: _workId, ...book }, index) => {
    const key = keys.get(ids[index]!)!;
    works.set(key, { workId: ids[index]! });
    return { ...book, key };
  });
  return { books: keyed, works, ids };
}
```

(Merge the `canonicalWorkIds` import from Task 5 into the same `../library/index.js` import.)

`routes.ts` — new schemas next to today's:

```ts
const seedWorkSchema = z.object({
  workId: z.string().min(1),
  title: z.string().min(1),
  author: z.string().min(1),
  cover: z.string().url().nullable().optional().transform((v) => v ?? null)
});

const setWorkSlotsSchema = z.object({ slots: z.array(z.object({ slotIndex: z.number().int().min(0), book: seedWorkSchema })) });

const randomFillWorksSchema = z.object({ pool: z.array(seedWorkSchema).min(1) });

const voteWorkSchema = z.object({ voterToken: z.string().min(1).max(100), workId: z.string().min(1) });

const tiebreakWorkSchema = z.object({ winnerWorkId: z.string().min(1) });
```

Import `UnknownWorkError` from `../library/index.js` and `keyedSeedBooks` from `./wire.js`. `PUT /arenas/:id/slots` body:

```ts
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "Invalid tournament id." });
      const works = worksFormat(request, reply);
      try {
        if (works) {
          const body = setWorkSlotsSchema.safeParse(request.body);
          if (!body.success) return reply.code(400).send({ error: "Expected {slots: [{slotIndex, book}, ...]}." });
          const keyed = keyedSeedBooks(request.user.id, body.data.slots.map((slot) => slot.book), service.seedingSlots(params.data.id, request.user.id));
          const duplicate = keyed.ids.findIndex((id, index) => keyed.ids.indexOf(id) !== index);
          if (duplicate !== -1) throw new DuplicateBookError(body.data.slots[duplicate]!.book.title);
          service.setSlotsManual(params.data.id, request.user.id, body.data.slots.map((slot, index) => ({ slotIndex: slot.slotIndex, book: keyed.books[index]! })), () => keyed.works);
        } else {
          const body = setSlotsSchema.safeParse(request.body);
          if (!body.success) return reply.code(400).send({ error: "Expected {slots: [{slotIndex, book}, ...]}." });
          service.setSlotsManual(params.data.id, request.user.id, body.data.slots, resolveWorks);
        }
        return reply.code(204).send();
      } catch (err) {
        if (err instanceof UnknownWorkError) return reply.code(400).send({ error: err.message });
        if (err instanceof WorkResolutionError) return reply.code(503).send({ error: err.message });
        if (err instanceof ArenaError) return reply.code(statusForArenaError(err)).send({ error: err.message });
        throw err;
      }
```

`POST /arenas/:id/random-fill` follows the same shape; the works branch is:

```ts
          const body = randomFillWorksSchema.safeParse(request.body);
          if (!body.success) return reply.code(400).send({ error: "Expected {pool: [book, ...]}." });
          const keyed = keyedSeedBooks(request.user.id, body.data.pool, service.seedingSlots(params.data.id, request.user.id));
          service.randomFill(params.data.id, request.user.id, keyed.books, () => keyed.works);
```

`POST …/tiebreak`: `const works = worksFormat(request, reply);` then parse `tiebreakWorkSchema` (error `Expected {winnerWorkId}.`) and call `service.tiebreak(…, { workId: body.data.winnerWorkId })`, or today's schema and `body.data.winnerBookKey`. Its catch gains `if (err instanceof WorkResolutionError) return reply.code(503).send({ error: err.message });` (a work on neither side is already `InvalidBookError`, a 400).

Vote route (`buildVoteRoute`): `const works = worksFormat(request, reply);`, parse `voteWorkSchema` (error `Expected {voterToken, workId}.`) or today's `voteSchema`, and pass `{ workId: body.data.workId }` or `body.data.bookKey`; add `if (err instanceof WorkResolutionError) return reply.code(503).send({ error: err.message });` to its catch (import already present in the file).

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npx tsx --test src/modules/arena/routes.test.ts && npm run typecheck && npm test`
Expected: PASS, every existing arena test unchanged.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/arena && git commit -m "Take works on arena seeding, votes and tiebreaks

A works-format write checks ownership first, then stores the owner's copy
key for each work (or the work id) so old builds keep rendering the
bracket. A vote names the side by its canonical work; a duel whose sides
now share a work gives it to side A.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## PR 3 — Tier lists

### Task 7: Stored works and the tier-list wire helpers

**Files:**
- Modify: `backend/src/modules/tierlists/domain/ports.ts`, `backend/src/modules/tierlists/adapters/sqlite/sqliteTierlistsRepository.ts`, `backend/src/modules/tierlists/service.ts` (`storedWorks`)
- Create: `backend/src/modules/tierlists/wire.ts`
- Create: `backend/src/modules/tierlists/wire.test.ts`
- Modify: `backend/package.json` (`"test"` list)

**Interfaces:**
- Produces: `TierlistsRepository.storedWorks(tierlistId): Map<string, string | null>` (key → stored work from `tierlist_works`); `TierlistsService.storedWorks(tierlistId)` (passthrough). Any hand-written fake of the port gets `storedWorks() { return new Map(); }`.
- Produces in `wire.ts`:
  - `interface WorksTier { id: string; label: string; color: string; workIds: string[] }`, `interface WorksBoard { tiers: WorksTier[]; pool: string[] }`
  - `boardKeysInOrder(data: unknown): string[]` — tier keys, then pool keys.
  - `boardToWorks(data: unknown, works: Map<string, string>): { tiers: Array<Record<string, unknown>>; pool: string[] }` — each tier's `bookKeys` replaced by `workIds`; first occurrence of a work wins (tiers before pool); keys without a work left out; other tier fields kept.
  - `histogramToWorks(cells: HistogramCell[], works: Map<string, string>, firstKeys: Set<string>)` → `Array<{ workId; tierId; votes }>`.
  - `placementsToWorks(placements: Placement[], works, firstKeys)` → `Array<{ workId; tierId }>`.
  - `placementsFromWorks(placements: Array<{ workId: string; tierId: string }>, ids: string[], keyByWork: Map<string, string>): Placement[] | null` — `ids` are the canonical ids of `placements` in order; null when one isn't in the board.
  - `boardBooksToWorks(pool: string[], snapshot: unknown[] | null, works: Map<string, string>, live: () => unknown[]): unknown[]`.
  - `keyedBoard(ownerUserId: string, board: WorksBoard, data: unknown, stored: Map<string, string | null>): { data: { tiers: Array<{ id: string; label: string; color: string; bookKeys: string[] }>; pool: string[] }; works: Map<string, string | null> } | { status: 400 | 409; error: string }`.
  - `tierlistToWorks(tierlist: Tierlist, stored: Map<string, string | null>): Tierlist`.

- [ ] **Step 1: Write the failing tests** — `wire.test.ts` (pure helpers only; `keyedBoard` is covered through the routes in Task 8):

```ts
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "tierlists-wire-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.TIERLISTS_DB_PATH = join(scratch, "tierlists.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { boardBooksToWorks, boardKeysInOrder, boardToWorks, histogramToWorks, placementsFromWorks, placementsToWorks } = await import("./wire.js");

const works = new Map([["k1", "w1"], ["k2", "w1"], ["k3", "w3"]]);
const data = { tiers: [{ id: "s", label: "S", color: "#000000", bookKeys: ["k2"] }], pool: ["k1", "k3", "k-orphan"] };

test("boardToWorks swaps keys for works, tiers before pool, first edition wins, orphans left out", () => {
  assert.deepEqual(boardKeysInOrder(data), ["k2", "k1", "k3", "k-orphan"]);
  assert.deepEqual(boardToWorks(data, works), { tiers: [{ id: "s", label: "S", color: "#000000", workIds: ["w1"] }], pool: ["w3"] });
});

test("histogram cells and placements keep only each work's first key", () => {
  const first = new Set(["k2", "k3"]);
  assert.deepEqual(histogramToWorks([{ bookKey: "k1", tierId: "s", votes: 4 }, { bookKey: "k2", tierId: "s", votes: 2 }, { bookKey: "k3", tierId: "s", votes: 1 }], works, first), [{ workId: "w1", tierId: "s", votes: 2 }, { workId: "w3", tierId: "s", votes: 1 }]);
  assert.deepEqual(placementsToWorks([{ bookKey: "k1", tierId: "s" }, { bookKey: "k3", tierId: "a" }], works, first), [{ workId: "w3", tierId: "a" }]);
});

test("placementsFromWorks maps each work to its board key and refuses a work not on the board", () => {
  const keyByWork = new Map([["w1", "k2"], ["w3", "k3"]]);
  assert.deepEqual(placementsFromWorks([{ workId: "w1-old", tierId: "s" }], ["w1"], keyByWork), [{ bookKey: "k2", tierId: "s" }]);
  assert.equal(placementsFromWorks([{ workId: "w9", tierId: "s" }], ["w9"], keyByWork), null);
});

test("a frozen snapshot is zipped with the pool when the lengths match, else books come live", () => {
  const live = () => [{ title: "Live", key: "k1", workId: "w1" }];
  assert.deepEqual(boardBooksToWorks(["k1", "k3"], [{ title: "A" }, { title: "B" }], works, live), [{ title: "A", key: "k1", workId: "w1" }, { title: "B", key: "k3", workId: "w3" }]);
  assert.deepEqual(boardBooksToWorks(["k1", "k3"], [{ title: "A" }], works, live), live());
  assert.deepEqual(boardBooksToWorks(["k1"], null, works, live), live());
});
```

Add `src/modules/tierlists/wire.test.ts` to `backend/package.json`'s `"test"` list.

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx tsx --test src/modules/tierlists/wire.test.ts`
Expected: FAIL — `Cannot find module './wire.js'`.

- [ ] **Step 3: Implement**

Repository (`sqliteTierlistsRepository.ts`):

```ts
  const storedWorksStmt = db.prepare(`SELECT key, work_id FROM tierlist_works WHERE tierlist_id = ?`);
```

```ts
    storedWorks(tierlistId) {
      return new Map((storedWorksStmt.all(tierlistId) as Array<{ key: string; work_id: string | null }>).map((row) => [row.key, row.work_id]));
    },
```

Port: `storedWorks(tierlistId: string): Map<string, string | null>;`. Service interface and implementation: `storedWorks(tierlistId: string): Map<string, string | null>;` / `storedWorks(tierlistId) { return repo.storedWorks(tierlistId); },`.

`backend/src/modules/tierlists/wire.ts`:

```ts
import { canonicalByKey, duplicateWorkMessage, firstKeyPerWork, keysForWorks, knownWorkIds } from "../library/index.js";
import type { HistogramCell, Placement, Tierlist } from "./domain/types.js";

export interface WorksTier {
  id: string;
  label: string;
  color: string;
  workIds: string[];
}

export interface WorksBoard {
  tiers: WorksTier[];
  pool: string[];
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function tiersOf(data: unknown): Array<Record<string, unknown>> {
  return list((data as { tiers?: unknown } | null)?.tiers).filter((tier): tier is Record<string, unknown> => typeof tier === "object" && tier !== null);
}

function poolOf(data: unknown): unknown[] {
  return list((data as { pool?: unknown } | null)?.pool);
}

export function boardKeysInOrder(data: unknown): string[] {
  return [...tiersOf(data).flatMap((tier) => list(tier.bookKeys)), ...poolOf(data)].filter((key): key is string => typeof key === "string" && key !== "");
}

export function boardToWorks(data: unknown, works: Map<string, string>) {
  const seen = new Set<string>();
  const take = (keys: unknown) =>
    list(keys).flatMap((key) => {
      const work = typeof key === "string" ? works.get(key) : undefined;
      if (!work || seen.has(work)) return [];
      seen.add(work);
      return [work];
    });
  const tiers = tiersOf(data).map(({ bookKeys, ...tier }) => ({ ...tier, workIds: take(bookKeys) }));
  return { tiers, pool: take(poolOf(data)) };
}

export function histogramToWorks(cells: HistogramCell[], works: Map<string, string>, firstKeys: Set<string>) {
  return cells.flatMap((cell) => (firstKeys.has(cell.bookKey) ? [{ workId: works.get(cell.bookKey)!, tierId: cell.tierId, votes: cell.votes }] : []));
}

export function placementsToWorks(placements: Placement[], works: Map<string, string>, firstKeys: Set<string>) {
  return placements.flatMap((placement) => (firstKeys.has(placement.bookKey) ? [{ workId: works.get(placement.bookKey)!, tierId: placement.tierId }] : []));
}

export function placementsFromWorks(placements: Array<{ workId: string; tierId: string }>, ids: string[], keyByWork: Map<string, string>): Placement[] | null {
  const keyed: Placement[] = [];
  for (const [index, placement] of placements.entries()) {
    const bookKey = keyByWork.get(ids[index]!);
    if (!bookKey) return null;
    keyed.push({ bookKey, tierId: placement.tierId });
  }
  return keyed;
}

export function boardBooksToWorks(pool: string[], snapshot: unknown[] | null, works: Map<string, string>, live: () => unknown[]): unknown[] {
  if (!snapshot || snapshot.length !== pool.length) return live();
  return snapshot.map((book, index) => ({ ...(book as Record<string, unknown>), key: pool[index], workId: works.get(pool[index]!) ?? null }));
}

export function keyedBoard(ownerUserId: string, board: WorksBoard, data: unknown, stored: Map<string, string | null>) {
  const all = [...board.tiers.flatMap((tier) => tier.workIds), ...board.pool];
  if (new Set(all).size !== all.length) return { status: 400 as const, error: "Duplicate tier or book." };
  const ids = knownWorkIds(all);
  if (new Set(ids).size !== ids.length) return { status: 409 as const, error: duplicateWorkMessage({ workId: null, title: null }) };
  const canonical = new Map(all.map((id, index) => [id, ids[index]!]));
  const keys = keysForWorks(ownerUserId, ids, firstKeyPerWork(boardKeysInOrder(data), canonicalByKey(stored)));
  const keyOf = (id: string) => keys.get(canonical.get(id)!)!;
  return {
    data: {
      tiers: board.tiers.map(({ workIds, ...tier }) => ({ ...tier, bookKeys: workIds.map(keyOf) })),
      pool: board.pool.map(keyOf)
    },
    works: new Map<string, string | null>(ids.map((id) => [keys.get(id)!, id]))
  };
}

export function tierlistToWorks(tierlist: Tierlist, stored: Map<string, string | null>): Tierlist {
  return { ...tierlist, data: boardToWorks(tierlist.data, canonicalByKey(stored)) };
}
```

(Check `HistogramCell` and `Placement` field names in `tierlists/domain/types.ts` — they are `{ bookKey, tierId, votes }` and `{ bookKey, tierId }`.)

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npx tsx --test src/modules/tierlists/wire.test.ts && npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/tierlists backend/package.json && git commit -m "Add tier-list helpers between stored keys and work ids

Within a list each work appears once on the wire, tiers before pool, so
a list that still holds two editions shows the first and votes keep
matching their key.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 8: Tier-list owner routes in the works format

**Files:**
- Modify: `backend/src/modules/tierlists/routes.ts` (`GET /tierlists`, `POST /tierlists`, `GET`/`PUT /tierlists/:id`, `POST …/open-voting`, `PUT …/voting`, `GET …/results`)
- Modify: `backend/src/worksFormat.ts` (`sendWorksError`)
- Test: `backend/src/modules/tierlists/routes.test.ts`

**Interfaces:**
- Consumes: Task 7 helpers; `worksFormat`; `UnknownWorkError`, `WorkResolutionError`, `canonicalByKey`, `firstKeyPerWork`.
- Produces: `sendWorksError(reply: FastifyReply, err: unknown)` in `backend/src/worksFormat.ts` — 400 for `UnknownWorkError`, 503 for `WorkResolutionError`, rethrows anything else.

- [ ] **Step 1: Write the failing tests** — in `routes.test.ts` add `const { resolveWorks } = await import("../books/index.js");`, then:

```ts
async function ownerApp() {
  const db = new DatabaseSync(":memory:");
  applyTierlistsMigrations(db);
  const service = createTierlistsService(createSqliteTierlistsRepository(db));
  const app = Fastify();
  app.decorate("authenticateAccessToken", (token: string) => ({ id: token, email: `${token}@example.test`, username: token, avatarId: null }));
  await app.register(buildTierlistRoutes(service));
  return { app, service };
}

const worksHeaders = (user: string) => ({ authorization: `Bearer ${user}`, "x-scripta-works": "1" });
const titleWork = (title: string) => resolveWorks([{ isbn: null, title, author: "Someone" }])[0]!;
const copy = (userId: string, position: number, key: string, workId: string) =>
  openLibraryDb().prepare("INSERT INTO library_books (user_id, position, book_key, title, author, row_hash, work_id) VALUES (?, ?, ?, 'T', 'A', 'h', ?)").run(userId, position, key, workId);
const tier = (workIds: string[]) => ({ id: "s", label: "S", color: "#c9482f", workIds });

test("a works-format create stores copy keys, answers works, and reads back as keys without the header", async () => {
  const [held, loose] = [titleWork("Owner Holds"), titleWork("Owner Lacks")];
  copy("t1", 0, "isbn:9780000000002", held);
  const { app } = await ownerApp();
  const created = await app.inject({ method: "POST", url: "/tierlists", headers: worksHeaders("t1"), payload: { name: "Mine", data: { tiers: [tier([held])], pool: [loose] } } });
  assert.equal(created.statusCode, 201);
  assert.deepEqual(created.json().data, { tiers: [tier([held])], pool: [loose] });
  const legacy = await app.inject({ method: "GET", url: `/tierlists/${created.json().id}`, headers: { authorization: "Bearer t1" } });
  assert.deepEqual(legacy.json().data, { tiers: [{ id: "s", label: "S", color: "#c9482f", bookKeys: ["isbn:9780000000002"] }], pool: [loose] });
  const listed = await app.inject({ method: "GET", url: "/tierlists", headers: worksHeaders("t1") });
  assert.deepEqual(listed.json().tierlists[0].data.pool, [loose]);
  await app.close();
});

test("a works-format create rejects an unknown work, a repeated work, and two editions of one work", async () => {
  const [old, kept] = [titleWork("First Edition"), titleWork("Second Edition")];
  openBooksDb().prepare("UPDATE works SET merged_into = ? WHERE id = ?").run(kept, old);
  const { app } = await ownerApp();
  const create = (pool: string[]) => app.inject({ method: "POST", url: "/tierlists", headers: worksHeaders("t2"), payload: { name: "X", data: { tiers: [tier([])], pool } } });
  assert.equal((await create(["not-a-work"])).statusCode, 400);
  assert.equal((await create([kept, kept])).statusCode, 400);
  assert.equal((await create([kept, old])).statusCode, 409);
  await app.close();
});

test("a works-format PUT keeps the stored key of a work already on the list", async () => {
  const [held, added] = [titleWork("Kept Key"), titleWork("Added Later")];
  copy("t3", 0, "ta:kept key|someone", held);
  const { app, service } = await ownerApp();
  const created = await app.inject({ method: "POST", url: "/tierlists", headers: { authorization: "Bearer t3" }, payload: { name: "Old build", data: { tiers: [{ id: "s", label: "S", color: "#c9482f", bookKeys: [] }], pool: ["ta:kept key|someone"] } } });
  const id = created.json().id as string;
  const put = await app.inject({ method: "PUT", url: `/tierlists/${id}`, headers: worksHeaders("t3"), payload: { data: { tiers: [tier([held])], pool: [added] } } });
  assert.equal(put.statusCode, 200);
  assert.deepEqual(put.json().data, { tiers: [tier([held])], pool: [added] });
  assert.deepEqual((service.getTierlist("t3", id)!.data as { tiers: Array<{ bookKeys: string[] }> }).tiers[0]!.bookKeys, ["ta:kept key|someone"]);
  await app.close();
});

test("owner results and open-voting answer works", async () => {
  const [a, b] = [titleWork("Ranked A"), titleWork("Ranked B")];
  copy("t4", 0, "ta:ranked a|someone", a);
  copy("t4", 1, "ta:ranked b|someone", b);
  const { app } = await ownerApp();
  const created = await app.inject({ method: "POST", url: "/tierlists", headers: worksHeaders("t4"), payload: { name: "Poll", data: { tiers: [tier([a])], pool: [b] } } });
  const id = created.json().id as string;
  const opened = await app.inject({ method: "POST", url: `/tierlists/${id}/open-voting`, headers: worksHeaders("t4"), payload: { access: "anonymous" } });
  assert.equal(opened.statusCode, 201);
  assert.deepEqual(opened.json().tierlist.data.pool, [b, a]);
  const results = await app.inject({ method: "GET", url: `/tierlists/${id}/results`, headers: worksHeaders("t4") });
  assert.deepEqual(results.json().histogram, [{ workId: a, tierId: "s", votes: 1 }]);
  const toggled = await app.inject({ method: "PUT", url: `/tierlists/${id}/voting`, headers: worksHeaders("t4"), payload: { open: false } });
  assert.deepEqual(toggled.json().tierlist.data.pool, [b, a]);
  await app.close();
});
```

(Add `const { openBooksDb } = await import("../books/adapters/sqlite/connection.js");` to the imports.)

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && npx tsx --test src/modules/tierlists/routes.test.ts`
Expected: FAIL — works-format create gets 400 (`bookKeys` required).

- [ ] **Step 3: Implement** — in `routes.ts` import `worksFormat`, `canonicalByKey`, `firstKeyPerWork`, `UnknownWorkError`, and from `./wire.js` `boardKeysInOrder, histogramToWorks, keyedBoard, tierlistToWorks, type WorksBoard`. New schemas:

```ts
const worksTierSchema = z.object({ id: z.string().min(1), label: z.string().trim().min(1).max(30), color: z.string().regex(/^#[0-9a-f]{6}$/i), workIds: z.array(z.string().min(1)) });

const worksBoardSchema = z.object({ tiers: z.array(worksTierSchema), pool: z.array(z.string().min(1)).max(500) });

const createWorksSchema = z.object({
  name: z.string().trim().min(1, "name is required and must be non-empty.").max(200),
  data: worksBoardSchema.extend({ tiers: z.array(worksTierSchema).min(1) }).optional(),
  access: z.enum(["anonymous", "members"]).optional()
});

const updateWorksSchema = z
  .object({ name: z.string().min(1).optional(), data: worksBoardSchema.optional() })
  .refine((body) => body.name !== undefined || body.data !== undefined, { message: "At least one of name or data must be provided." });
```

A local helper for owner responses:

```ts
function withWorks(service: TierlistsService, tierlist: Tierlist, works: boolean): Tierlist {
  return works ? tierlistToWorks(tierlist, service.storedWorks(tierlist.id)) : tierlist;
}
```

(import `type Tierlist` from `./domain/types.js`), and an error mapper every works branch that writes uses — add it to `backend/src/worksFormat.ts` so Task 11 reuses it:

```ts
import { UnknownWorkError, WorkResolutionError } from "./modules/library/index.js";

export function sendWorksError(reply: FastifyReply, err: unknown) {
  if (err instanceof UnknownWorkError) return reply.code(400).send({ error: err.message });
  if (err instanceof WorkResolutionError) return reply.code(503).send({ error: err.message });
  throw err;
}
```

Routes:
- `GET /tierlists`: `const works = worksFormat(request, reply); return reply.send({ tierlists: service.listTierlists(request.user.id).map((tierlist) => withWorks(service, tierlist, works)) });`
- `GET /tierlists/:id`: after the 404 check, `return reply.send(withWorks(service, tierlist, worksFormat(request, reply)));`
- `POST /tierlists`: start with `const works = worksFormat(request, reply);`; keep today's body unchanged in the `else` branch. Works branch:

```ts
      if (works) {
        const parsed = createWorksSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid request." });
        const { name, data, access } = parsed.data;
        if (access && !data) return reply.code(400).send({ error: "Choose books and tiers before publishing." });
        if (data) {
          const ids = data.tiers.map((t) => t.id);
          if (new Set(ids).size !== ids.length) return reply.code(400).send({ error: "Duplicate tier or book." });
          if (access && (!data.pool.length || data.tiers.some((t) => t.workIds.length))) return reply.code(400).send({ error: "Public tier lists need an unranked book pool." });
        }
        try {
          const keyed = data ? keyedBoard(request.user.id, data, undefined, new Map()) : undefined;
          if (keyed && "error" in keyed) return reply.code(keyed.status).send({ error: keyed.error });
          const keys = keyed ? [...new Set([...keyed.data.pool, ...keyed.data.tiers.flatMap((t) => t.bookKeys)])] : [];
          const publicBooks = access ? resolvePublicLibraryData(request.user.id, { bookKeys: keys, highlightRefs: [], needsCurrentlyReading: false, statsMetrics: [] }).books : [];
          if (access && publicBooks.length !== keys.length) return reply.code(400).send({ error: "A selected book is no longer in your library." });
          const tierlist = service.createTierlist(request.user.id, name, keyed?.data, access, publicBooks, keyed?.works);
          return reply.code(201).send(withWorks(service, tierlist, true));
        } catch (err) {
          return sendWorksError(reply, err);
        }
      }
```

- `PUT /tierlists/:id`: `const works = worksFormat(request, reply);` after the id parse; works branch:

```ts
      if (works) {
        const body = updateWorksSchema.safeParse(request.body);
        if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? "Invalid request." });
        try {
          let keyed: Exclude<ReturnType<typeof keyedBoard>, { error: string }> | undefined;
          if (body.data.data !== undefined) {
            const owned = service.getTierlist(request.user.id, params.data.id);
            if (!owned || owned.voteCode !== null) return reply.code(404).send({ error: "No tier list with that id." });
            const result = keyedBoard(request.user.id, body.data.data, owned.data, service.storedWorks(owned.id));
            if ("error" in result) return reply.code(result.status).send({ error: result.error });
            keyed = result;
          }
          const tierlist = service.updateTierlist(request.user.id, params.data.id, { ...(body.data.name !== undefined ? { name: body.data.name } : {}), ...(keyed ? { data: keyed.data } : {}) }, keyed?.works);
          if (!tierlist) return reply.code(404).send({ error: "No tier list with that id." });
          return reply.send(withWorks(service, tierlist, true));
        } catch (err) {
          return sendWorksError(reply, err);
        }
      }
```

- `POST …/open-voting`: `const works = worksFormat(request, reply);` at the top; send `{ tierlist: withWorks(service, tierlist, works), voteCode: tierlist.voteCode }`.
- `PUT …/voting`: send `{ tierlist: withWorks(service, tierlist, worksFormat(request, reply)) }`.
- `GET …/results`: after the ownership check:

```ts
      const results = service.getResults(params.data.id);
      if (!worksFormat(request, reply)) return reply.send(results);
      const owned = service.getTierlist(request.user.id, params.data.id)!;
      const stored = canonicalByKey(service.storedWorks(owned.id));
      const first = new Set(firstKeyPerWork(boardKeysInOrder(owned.data), stored).values());
      return reply.send({ histogram: histogramToWorks(results.histogram, stored, first), ballotCount: results.ballotCount });
```

Keep the existing ownership check as it is (it already fetches the list; reuse that variable instead of a second `getTierlist` if convenient).

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npx tsx --test src/modules/tierlists/routes.test.ts && npm run typecheck && npm test`
Expected: PASS, existing tier-list tests unchanged.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/tierlists && git commit -m "Speak works on the tier-list owner routes

Creates and edits take work ids and store copy keys; reads, open-voting,
the voting toggle and results answer work ids. Without the header every
route answers exactly as before.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 9: Voting board, ballots, and the mural/profile tier-list map

**Files:**
- Modify: `backend/src/modules/tierlists/routes.ts` (`GET /tierlists/voting/:code`, ballot routes, `sendBallotOutcome`)
- Modify: `backend/src/modules/tierlists/plugin.ts`, `backend/src/modules/tierlists/index.ts` (`tierlistsForWire`)
- Modify: `backend/src/modules/murals/routes.ts` (`GET /murals/shared/:token`)
- Modify: `backend/src/modules/community/routes.ts` (`GET /community/profiles/:username`)
- Test: `backend/src/modules/tierlists/routes.test.ts`

**Interfaces:**
- Produces: `tierlistsForWire(tierlists: Record<string, TierlistData>, works: boolean): Record<string, TierlistData | { name: string; tiers: Array<Record<string, unknown>>; pool: string[] }>` — returns the same object when `works` is false.

- [ ] **Step 1: Write the failing tests** — `tierlists/routes.test.ts`, reusing Task 8's helpers plus a public app:

```ts
async function publicApp(service: ReturnType<typeof createTierlistsService>, signedInAs?: string) {
  const app = Fastify();
  if (signedInAs) app.decorate("authenticateAccessToken", (token: string) => (token === signedInAs ? { id: signedInAs, email: `${signedInAs}@example.test`, username: signedInAs, avatarId: null } : null));
  await app.register(buildPublicTierlistRoutes(service));
  return app;
}

test("the voting board and ballots speak works with the header", async () => {
  const [a, b] = [titleWork("Board A"), titleWork("Board B")];
  copy("t5", 0, "ta:board a|someone", a);
  copy("t5", 1, "ta:board b|someone", b);
  const { app, service } = await ownerApp();
  const created = await app.inject({ method: "POST", url: "/tierlists", headers: worksHeaders("t5"), payload: { name: "Public", data: { tiers: [tier([])], pool: [a, b] }, access: "anonymous" } });
  const code = created.json().voteCode as string;
  const voter = await publicApp(service);
  const board = await voter.inject({ method: "GET", url: `/tierlists/voting/${code}`, headers: { "x-scripta-works": "1" } });
  assert.deepEqual(board.json().board.pool, [a, b]);
  assert.deepEqual(board.json().books.map((book: { key: string; workId: string }) => [book.key, book.workId]), [["ta:board a|someone", a], ["ta:board b|someone", b]]);
  const ballot = await voter.inject({ method: "POST", url: `/tierlists/voting/${code}/ballot`, headers: { "x-scripta-works": "1" }, payload: { placements: [{ workId: b, tierId: "s" }] } });
  assert.equal(ballot.statusCode, 200);
  assert.deepEqual(ballot.json().placements, [{ workId: b, tierId: "s" }]);
  assert.deepEqual(ballot.json().results.histogram, [{ workId: b, tierId: "s", votes: 1 }]);
  const stray = await voter.inject({ method: "POST", url: `/tierlists/voting/${code}/ballot`, headers: { "x-scripta-works": "1" }, payload: { placements: [{ workId: "not-a-work", tierId: "s" }] } });
  assert.equal(stray.statusCode, 400);
  const legacy = await voter.inject({ method: "GET", url: `/tierlists/voting/${code}` });
  assert.deepEqual(legacy.json().board.pool, ["ta:board a|someone", "ta:board b|someone"]);
  await voter.close();
  await app.close();
});

test("a frozen snapshot shorter than the pool falls back to the live library", async () => {
  const [a, b] = [titleWork("Short A"), titleWork("Short B")];
  copy("t6", 0, "ta:short a|someone", a);
  copy("t6", 1, "ta:short b|someone", b);
  const { app, service } = await ownerApp();
  const created = await app.inject({ method: "POST", url: "/tierlists", headers: worksHeaders("t6"), payload: { name: "Short", data: { tiers: [tier([])], pool: [a, b] }, access: "anonymous" } });
  const code = created.json().voteCode as string;
  const row = service.getVotingBoard(code)!;
  const voter = await publicApp({ ...service, getVotingBoard: () => ({ ...row, publicBooks: row.publicBooks!.slice(0, 1) }) });
  const board = await voter.inject({ method: "GET", url: `/tierlists/voting/${code}`, headers: { "x-scripta-works": "1" } });
  assert.deepEqual(board.json().books.map((book: { workId: string }) => book.workId), [a, b]);
  await voter.close();
  await app.close();
});
```

And the mural/profile map, through the tier lists' own file database (add `const { openTierlistsDb } = await import("./adapters/sqlite/connection.js");` and `const { tierlistsForWire } = await import("./index.js");`):

```ts
test("tierlistsForWire swaps a mural's tier-list keys for works and leaves today's format alone", () => {
  const insert = openTierlistsDb().prepare("INSERT INTO tierlist_works (tierlist_id, key, work_id) VALUES ('t-map', ?, ?)");
  insert.run("k1", "w1");
  insert.run("k2", "w2");
  const tierlists = { "t-map": { name: "On the wall", tiers: [{ id: "s", label: "S", color: "#000000", bookKeys: ["k1"] }], pool: ["k2", "k-orphan"] } };
  assert.equal(tierlistsForWire(tierlists, false), tierlists);
  assert.deepEqual(tierlistsForWire(tierlists, true), { "t-map": { name: "On the wall", tiers: [{ id: "s", label: "S", color: "#000000", workIds: ["w1"] }], pool: ["w2"] } });
});
```

(`w1`/`w2` aren't catalog works, so `canonicalByKey` keeps them as stored.)

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && npx tsx --test src/modules/tierlists/routes.test.ts`
Expected: FAIL — the board still answers keys; `tierlistsForWire` is not exported.

- [ ] **Step 3: Implement**

`tierlists/routes.ts`, voting board handler:

```ts
      const works = worksFormat(request, reply);
      const params = codeParamSchema.safeParse(request.params);
      …
      const live = () => resolvePublicLibraryData(board.ownerUserId, { bookKeys: board.pool, highlightRefs: [], needsCurrentlyReading: false, statsMetrics: [] }).books;
      if (!works) {
        const libraryData = board.publicBooks !== null ? { books: board.publicBooks } : { books: live() };
        return reply.send({ board: { name: board.name, tiers: board.tiers, pool: board.pool, access: board.access, votingOpen: board.votingOpen, ballotCount: board.ballotCount, eligibleVoteCount: board.eligibleVoteCount, promotedAt: board.promotedAt, ...(board.votingOpen ? {} : { histogram: board.histogram }) }, books: libraryData.books });
      }
      const stored = canonicalByKey(service.storedWorks(board.id));
      const first = new Set(firstKeyPerWork(board.pool, stored).values());
      return reply.send({
        board: {
          name: board.name,
          tiers: board.tiers,
          pool: boardToWorks({ pool: board.pool }, stored).pool,
          access: board.access,
          votingOpen: board.votingOpen,
          ballotCount: board.ballotCount,
          eligibleVoteCount: board.eligibleVoteCount,
          promotedAt: board.promotedAt,
          ...(board.votingOpen ? {} : { histogram: histogramToWorks(board.histogram, stored, first) })
        },
        books: boardBooksToWorks(board.pool, board.publicBooks, stored, live)
      });
```

(The legacy branch must produce exactly today's bytes: keep today's `libraryData` expression and object literal as they are and only move them under `if (!works)`.)

Ballot routes: a works schema `const worksPlacementsSchema = z.object({ placements: z.array(z.object({ workId: z.string().min(1), tierId: z.string().min(1) })).max(500) });` and, in both `POST …/ballot` and `PUT …/ballot/:ballotId`, when `worksFormat(request, reply)`:

```ts
      const board = service.getVotingBoard(params.data.code);
      if (!board) return reply.code(404).send({ error: "No tier list at that link." });
      try {
        const ids = knownWorkIds(body.data.placements.map((placement) => placement.workId));
        const placements = placementsFromWorks(body.data.placements, ids, firstKeyPerWork(board.pool, canonicalByKey(service.storedWorks(board.id))));
        if (!placements) return reply.code(400).send({ error: "Those placements don't match this tier list." });
        const outcome = service.submitBallot(params.data.code, placements, voterFor(request, ballotId));
        return sendBallotOutcome(reply, service, params.data.code, outcome, true);
      } catch (err) {
        if (err instanceof UnknownWorkError) return reply.code(400).send({ error: "Those placements don't match this tier list." });
        if (err instanceof WorkResolutionError) return reply.code(503).send({ error: err.message });
        throw err;
      }
```

In the works branch, parse the body with `worksPlacementsSchema` instead of `placementsSchema` (same `Invalid ballot.` 400 on failure); `ballotId` is `null` for POST. `readBallot` passes `worksFormat(request, reply)` to `sendBallotOutcome`. `sendBallotOutcome(reply, service, code, outcome, works: boolean)`: the error branches are unchanged; on success:

```ts
  const board = service.getVotingBoard(code);
  if (!works) return reply.send({ ballotId: outcome.ballotId, placements: outcome.placements, results: { histogram: board?.histogram ?? [], ballotCount: board?.ballotCount ?? 0 } });
  const stored = board ? canonicalByKey(service.storedWorks(board.id)) : new Map<string, string>();
  const first = new Set(firstKeyPerWork(board?.pool ?? [], stored).values());
  return reply.send({ ballotId: outcome.ballotId, placements: placementsToWorks(outcome.placements, stored, first), results: { histogram: histogramToWorks(board?.histogram ?? [], stored, first), ballotCount: board?.ballotCount ?? 0 } });
```

`tierlists/plugin.ts`:

```ts
let wireRepo: ReturnType<typeof createSqliteTierlistsRepository> | undefined;

export function tierlistsForWire(tierlists: Record<string, TierlistData>, works: boolean) {
  if (!works) return tierlists;
  const repo = (wireRepo ??= createSqliteTierlistsRepository(openTierlistsDb()));
  return Object.fromEntries(Object.entries(tierlists).map(([id, data]) => {
    const board = boardToWorks(data, canonicalByKey(repo.storedWorks(id)));
    return [id, { name: data.name, tiers: board.tiers, pool: board.pool }];
  }));
}
```

Export it from `tierlists/index.ts`. In `murals/routes.ts` (shared token route) send `tierlists: tierlistsForWire(payload.tierlists, worksFormat(request, reply))`. In `community/routes.ts` (`GET /community/profiles/:username`):

```ts
        const works = worksFormat(request, reply);
        const view = service.getProfileByUsername(username, viewer?.id);
        reply.header("Cache-Control", "no-store");
        return reply.send(works && view.mural ? { ...view, mural: { ...view.mural, tierlists: tierlistsForWire(view.mural.tierlists, true) } } : view);
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npm run typecheck && npm test`
Expected: PASS, every existing public-payload test unchanged.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/tierlists backend/src/modules/murals backend/src/modules/community && git commit -m "Speak works on tier-list voting and the mural tier-list map

Voters place works; the board and results answer works. A frozen book
snapshot gets each book's key and work by position when it lines up with
the pool, and falls back to the live library when it doesn't.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## PR 4 — Quizzes

### Task 10: Quiz generation without book identity; backend keeps its own stored types

**Files:**
- Modify: `packages/shared/src/quizzes/types.ts`, `packages/shared/src/quizzes/draw.ts`, `packages/shared/src/quizzes/grade.ts`, `packages/shared/src/quizzes/draw.test.ts`
- Modify: `backend/src/modules/quizzes/domain/types.ts`, `backend/src/modules/quizzes/service.ts`

**Interfaces:**
- Produces in shared: `interface QuizBookContent { title: string; author: string; coverUrl: string | null; quote: string | null; blurb: string | null }`; `QuizBook extends QuizBookContent { key: string }` (unchanged shape for now); `eligibleTypes(book: QuizBookContent)`; `generateQuizQuestions<B extends QuizBookContent>(books: B[], config: QuizConfig, seed: string): Array<{ id: string; type: QuizQuestionType; book: B; options: string[]; answerIndex: number }>`; `gradeAnswers(questions: Array<{ id: string; answerIndex: number }>, submitted)`.
- Produces in backend: `StoredQuizBook extends QuizBookContent { key: string }`, `StoredQuizQuestion { id; type; bookKey; options; answerIndex }` in `quizzes/domain/types.ts`.

- [ ] **Step 1: Update the failing test first** — in `draw.test.ts` replace every `q.bookKey` with `q.book.key`, and add:

```ts
test("a distractor is any other book object, so two books sharing a title still draw", () => {
  const books = [book("a"), book("b"), book("c"), book("d"), book("e")];
  const questions = generateQuizQuestions(books, { questionCount: 5, allowedTypes: ["title_cover"] }, "seed");
  for (const question of questions) assert.ok(books.includes(question.book));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/shared && npm test`
Expected: FAIL — `q.book` is undefined.

- [ ] **Step 3: Implement** — `types.ts`: add `QuizBookContent` and make `QuizBook` extend it. `draw.ts`: `eligibleTypes(book: QuizBookContent)`; `generateQuizQuestions<B extends QuizBookContent>(books: B[], …)` with `valueOf = (b: B) => …`, `distractors: B[]`, the distractor filter `distractorPool.filter((b) => b !== book)`, and the push `questions.push({ id: \`q${questions.length}\`, type, book, options: ordered, answerIndex: ordered.indexOf(answerValue) });` (return type `Array<{ id: string; type: QuizQuestionType; book: B; options: string[]; answerIndex: number }>`). `grade.ts`: `gradeAnswers(questions: Array<{ id: string; answerIndex: number }>, submitted: SubmittedAnswer[])`.

Backend `quizzes/domain/types.ts`:

```ts
import type { QuizBookContent, QuizQuestionType } from "@scripta/shared";

export interface StoredQuizBook extends QuizBookContent {
  key: string;
}

export interface StoredQuizQuestion {
  id: string;
  type: QuizQuestionType;
  bookKey: string;
  options: string[];
  answerIndex: number;
}
```

`quizzes/service.ts`: replace `QuizBook`/`QuizQuestion` with `StoredQuizBook`/`StoredQuizQuestion` everywhere, and in `publishQuiz`:

```ts
      const questions = generateQuizQuestions(books, { questionCount: doc.questionCount, allowedTypes: doc.allowedTypes }, code).map((question) => ({ id: question.id, type: question.type, bookKey: question.book.key, options: question.options, answerIndex: question.answerIndex }));
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/shared && npm run build && npm test && cd ../../backend && npm run typecheck && npm test`
Expected: PASS, including every existing quiz test (publish output is unchanged because keys within a quiz are unique).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/quizzes backend/src/modules/quizzes && git commit -m "Draw quiz questions without reading a book key

The backend stores keyed quiz documents until the removal while clients
move to works, so the shared draw no longer depends on either identity
and the backend owns its stored shapes.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 11: Quiz owner routes in the works format

**Files:**
- Modify: `backend/src/modules/quizzes/domain/ports.ts`, `backend/src/modules/quizzes/adapters/sqlite/sqliteQuizzesRepository.ts`, `backend/src/modules/quizzes/service.ts` (`storedWorks`)
- Create: `backend/src/modules/quizzes/wire.ts`
- Modify: `backend/src/modules/quizzes/routes.ts` (`GET /quizzes`, `POST /quizzes`, `GET`/`PUT /quizzes/:id`, `POST …/publish`, `PUT …/voting`)
- Test: `backend/src/modules/quizzes/routes.test.ts`

**Interfaces:**
- Produces: `QuizzesRepository.storedWorks(quizId): Map<string, string | null>` (from `quiz_works`) and the service passthrough; fakes return `new Map()`.
- Produces in `wire.ts`: `quizToWorks(quiz: Quiz, stored: Map<string, string | null>): Quiz`; `quizBookWorks(books: Array<{ workId?: string; title: string; author: string }>): Array<string | null>`; `keyedQuizBooks<T extends { workId?: string }>(ownerUserId: string, books: T[], ids: string[], storedKeys: string[], stored: Map<string, string | null>): { books: Array<Omit<T, "workId"> & { key: string }>; works: Map<string, string | null> }`.

- [ ] **Step 1: Write the failing tests** — `quizzes/routes.test.ts` (add `resolveWorks`, `openLibraryDb`, `openBooksDb` imports as in Task 8, and an owner app like the file's existing helper):

```ts
const quizHeaders = (user: string) => ({ authorization: `Bearer ${user}`, "x-scripta-works": "1" });
const named = (title: string) => resolveWorks([{ isbn: null, title, author: "Someone" }])[0]!;
const book = (title: string, workId?: string) => ({ ...(workId ? { workId } : {}), title, author: "Someone", coverUrl: "https://covers.test/x.jpg", quote: null, blurb: null });

test("a works-format create resolves pool books by title, keeps one book per work, and answers works", async () => {
  const held = named("Quiz Held");
  openLibraryDb().prepare("INSERT INTO library_books (user_id, position, book_key, title, author, row_hash, work_id) VALUES ('q1', 0, 'ta:quiz held|someone', 'Quiz Held', 'Someone', 'h', ?)").run(held);
  const { app } = await quizApp();
  const created = await app.inject({ method: "POST", url: "/quizzes", headers: quizHeaders("q1"), payload: { name: "Mixed", data: { books: [book("Quiz Held", held), book("Pool Classic"), book("Quiz Held again", held)] } } });
  assert.equal(created.statusCode, 201);
  const books = created.json().data.books as Array<{ workId: string; title: string }>;
  assert.deepEqual(books.map((entry) => entry.title), ["Quiz Held", "Pool Classic"]);
  assert.equal(books[0]!.workId, held);
  assert.equal(books[1]!.workId, named("Pool Classic"));
  assert.doesNotMatch(created.body, /"key"/);
  const legacy = await app.inject({ method: "GET", url: `/quizzes/${created.json().id}`, headers: { authorization: "Bearer q1" } });
  assert.deepEqual(legacy.json().data.books.map((entry: { key: string }) => entry.key), ["ta:quiz held|someone", named("Pool Classic")]);
  await app.close();
});

test("a works-format PUT keeps stored keys, rejects an unknown work and a second edition", async () => {
  const [a, b, old] = [named("Put A"), named("Put B"), named("Put B old edition")];
  openBooksDb().prepare("UPDATE works SET merged_into = ? WHERE id = ?").run(b, old);
  const { app } = await quizApp();
  const created = await app.inject({ method: "POST", url: "/quizzes", headers: quizHeaders("q2"), payload: { name: "Edit", data: { books: [book("Put A", a)] } } });
  const id = created.json().id as string;
  const put = (books: unknown[]) => app.inject({ method: "PUT", url: `/quizzes/${id}`, headers: quizHeaders("q2"), payload: { data: { books } } });
  const ok = await put([book("Put A", a), book("Put B", b)]);
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(ok.json().data.books.map((entry: { workId: string }) => entry.workId), [a, b]);
  assert.equal((await put([book("Put A", "not-a-work")])).statusCode, 400);
  assert.equal((await put([book("Put B", b), book("Put B old edition", old)])).statusCode, 409);
  await app.close();
});
```

(`quizApp()` is the file's owner-route app helper; if it is named differently, use that one. It must register `buildQuizRoutes(service)`.)

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && npx tsx --test src/modules/quizzes/routes.test.ts`
Expected: FAIL — `key` is required by today's schema.

- [ ] **Step 3: Implement**

Repository and port: `const storedWorksStmt = db.prepare(\`SELECT key, work_id FROM quiz_works WHERE quiz_id = ?\`);` and `storedWorks(quizId)` returning a Map, exactly like Task 7; service passthrough.

`backend/src/modules/quizzes/wire.ts`:

```ts
import { canonicalByKey, firstKeyPerWork, keysForWorks, knownWorkIds, resolveTitleWorks } from "../library/index.js";
import type { Quiz, StoredQuizBook, StoredQuizQuestion } from "./domain/types.js";

export function quizToWorks(quiz: Quiz, stored: Map<string, string | null>): Quiz {
  const works = canonicalByKey(stored);
  const data = (quiz.data ?? {}) as Record<string, unknown>;
  const seen = new Set<string>();
  const books = (Array.isArray(data.books) ? (data.books as StoredQuizBook[]) : []).flatMap(({ key, ...book }) => {
    const workId = works.get(key);
    if (!workId || seen.has(workId)) return [];
    seen.add(workId);
    return [{ workId, ...book }];
  });
  const questions = Array.isArray(data.questions)
    ? (data.questions as StoredQuizQuestion[]).map((question) => ({ id: question.id, type: question.type, workId: works.get(question.bookKey) ?? null, options: question.options, answerIndex: question.answerIndex }))
    : data.questions;
  return { ...quiz, data: { ...data, books, questions } };
}

export function quizBookWorks(books: Array<{ workId?: string; title: string; author: string }>): Array<string | null> {
  const given = [...new Set(books.flatMap((book) => (book.workId ? [book.workId] : [])))];
  const canonical = knownWorkIds(given);
  const known = new Map(given.map((id, index) => [id, canonical[index]!]));
  const titled = books.filter((book) => !book.workId);
  const resolved = resolveTitleWorks(titled);
  const byBook = new Map(titled.map((book, index) => [book, resolved[index] ?? null]));
  return books.map((book) => (book.workId ? known.get(book.workId)! : byBook.get(book) ?? null));
}

export function keyedQuizBooks<T extends { workId?: string }>(ownerUserId: string, books: T[], ids: string[], storedKeys: string[], stored: Map<string, string | null>) {
  const keys = keysForWorks(ownerUserId, ids, firstKeyPerWork(storedKeys, canonicalByKey(stored)));
  return {
    books: books.map(({ workId: _workId, ...book }, index) => ({ key: keys.get(ids[index]!)!, ...book })),
    works: new Map<string, string | null>(ids.map((id) => [keys.get(id)!, id]))
  };
}
```

`routes.ts` — a works book schema and data schema:

```ts
const quizWorkBookSchema = quizBookSchema.omit({ key: true }).extend({ workId: z.string().min(1).max(200).optional() });

const quizWorksDataSchema = quizDataSchema.extend({ books: z.array(quizWorkBookSchema).max(500).default([]) });

const createQuizWorksSchema = z.object({ name: createQuizSchema.shape.name, data: quizWorksDataSchema });

const updateQuizWorksSchema = z
  .object({ name: z.string().min(1).optional(), data: quizWorksDataSchema.optional() })
  .refine((body) => body.name !== undefined || body.data !== undefined, { message: "At least one of name or data must be provided." });
```

A response helper `const withWorks = (quiz: Quiz, works: boolean) => (works ? quizToWorks(quiz, service.storedWorks(quiz.id)) : quiz);` inside `buildQuizRoutes` (import `type Quiz` from `./domain/types.js`), and `sendWorksError` imported from `../../worksFormat.js` (Task 8).

- `GET /quizzes`: `{ quizzes: service.listQuizzes(request.user.id).map((quiz) => withWorks(quiz, works)) }`; `GET /quizzes/:id`: `withWorks(quiz, worksFormat(request, reply))`; publish: `{ quiz: withWorks(outcome.quiz, works), voteCode: outcome.quiz.voteCode }`; `PUT …/voting`: `{ quiz: withWorks(quiz, worksFormat(request, reply)) }`. Call `worksFormat` once at the top of each handler.
- `POST /quizzes` works branch:

```ts
        const parsed = createQuizWorksSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid request." });
        try {
          const ids = quizBookWorks(parsed.data.data.books);
          const seen = new Set<string>();
          const kept = parsed.data.data.books.flatMap((entry, index) => {
            const id = ids[index];
            if (!id || seen.has(id)) return [];
            seen.add(id);
            return [{ entry, id }];
          });
          const keyed = keyedQuizBooks(request.user.id, kept.map((item) => item.entry), kept.map((item) => item.id), [], new Map());
          const quiz = service.createQuiz(request.user.id, parsed.data.name, { ...parsed.data.data, books: keyed.books }, keyed.works);
          return reply.code(201).send(withWorks(quiz, true));
        } catch (err) {
          return sendWorksError(reply, err);
        }
```

- `PUT /quizzes/:id` works branch:

```ts
        const body = updateQuizWorksSchema.safeParse(request.body);
        if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? "Invalid request." });
        try {
          let data: unknown;
          let keyedWorks: Map<string, string | null> | undefined;
          if (body.data.data) {
            const owned = service.getQuiz(request.user.id, params.data.id);
            if (!owned || owned.voteCode !== null) return reply.code(404).send({ error: "No quiz with that id." });
            const books = body.data.data.books;
            const ids = quizBookWorks(books);
            if (ids.some((id) => id === null)) return reply.code(400).send({ error: "That book isn't in the catalog." });
            const duplicate = ids.findIndex((id, index) => ids.indexOf(id) !== index);
            if (duplicate !== -1) return reply.code(409).send({ error: duplicateWorkMessage({ workId: null, title: books[duplicate]!.title }) });
            const storedKeys = ((owned.data as { books?: Array<{ key?: unknown }> }).books ?? []).flatMap((entry) => (typeof entry.key === "string" ? [entry.key] : []));
            const keyed = keyedQuizBooks(request.user.id, books, ids as string[], storedKeys, service.storedWorks(owned.id));
            data = { ...body.data.data, books: keyed.books };
            keyedWorks = keyed.works;
          }
          const quiz = service.updateQuiz(request.user.id, params.data.id, { ...(body.data.name !== undefined ? { name: body.data.name } : {}), ...(data !== undefined ? { data } : {}) }, keyedWorks);
          if (!quiz) return reply.code(404).send({ error: "No quiz with that id." });
          return reply.send(withWorks(quiz, true));
        } catch (err) {
          return sendWorksError(reply, err);
        }
```

Keep today's handler bodies unchanged in the `else` branches.

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npx tsx --test src/modules/quizzes/routes.test.ts && npm run typecheck && npm test`
Expected: PASS, existing quiz tests unchanged.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/quizzes && git commit -m "Speak works on the quiz owner routes

Library books arrive with their work; curated pool books arrive with
only a title and are resolved by title and author. Each stores the
owner's copy key or the work id, so old builds keep editing the quiz.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## PR 5 — Clients

Tasks 12–14 are one branch and one PR. After Task 12, `frontend` and `mobile` don't typecheck until their own task lands; each task verifies its own package. Shared is consumed through `dist`, so rebuild it (`cd packages/shared && npm run build`) before typechecking a client.

### Task 12: `@scripta/shared` speaks works

**Files:**
- Modify: `packages/shared/src/library/merge.ts` (`bookKey`), `packages/shared/src/library/types.ts` (`LibraryDocument.works`), `packages/shared/src/library/index.ts`
- Create: `packages/shared/src/library/works.ts`, `packages/shared/src/library/works.test.ts`
- Modify: `packages/shared/src/arena/types.ts`, `packages/shared/src/arena/arenaSeed.ts`
- Create: `packages/shared/src/arena/arenaSeed.test.ts`
- Modify: `packages/shared/src/tierlists/tierlist.ts`, `ballot.ts`, `results.ts`
- Create: `packages/shared/src/tierlists/ballot.test.ts`
- Modify: `packages/shared/src/quizzes/types.ts`, `packages/shared/src/quizzes/pool.ts`
- Test: `packages/shared/src/library/merge.test.ts`

**Interfaces (what Tasks 13–14 build on):**
- `bookKey(book)` returns `book._key` when it is a string (public books carry their server key), else today's computation.
- `withWorkIds(books, works: Record<string, string> | undefined)` → copies of the books with `_workId` set where the map has their key; `workIdOf(book): string | undefined` reads `_workId`.
- `LibraryDocument.works?: Record<string, string>`.
- Arena: `SeedBook { workId: string | null; title; author; cover }`, `DuelSide extends SeedBook { votes }`, `Duel.winnerWorkId: string | null` (replaces `winnerKey`), `toSeedBook(book, cover): SeedBook | null` (null when the book has no `_workId`).
- Tier lists: `TierDefinition.workIds`, `createTier` → `workIds: []`, `Placement { workId; tierId }`, `blankBoard`/`ballotBoard` with `workIds`, `HistogramCell { workId; tierId; votes }`, `BookResult.workId`, `aggregate(histogram, tierIds, pool, mode)` keyed by work, `toPlacements(data: { tiers: Array<{ id: string; workIds: string[] }> }): Placement[]`.
- Quizzes: `QuizBook extends QuizBookContent { workId: string }`, `QuizBookInput extends QuizBookContent { workId?: string }`, `QuizQuestion { id; type; workId: string | null; options; answerIndex }`, `QuizDataInput = Omit<QuizData, "books"> & { books: QuizBookInput[] }`, `QUIZ_POOL: Array<QuizBookInput & { id: string }>` (the old `pool-*` slug moves to `id`).

- [ ] **Step 1: Write the failing tests**

`library/works.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { bookKey } from "./merge.js";
import { withWorkIds, workIdOf } from "./works.js";

test("withWorkIds tags each book with its work and leaves workless books alone", () => {
  const dune = { Title: "Dune", Attribution: "Frank Herbert" };
  const orlando = { Title: "Orlando", Attribution: "Virginia Woolf" };
  const [tagged, untouched] = withWorkIds([dune, orlando], { "ta:dune|frank herbert": "w-dune" });
  assert.equal(workIdOf(tagged!), "w-dune");
  assert.equal(untouched, orlando);
  assert.equal(workIdOf(untouched!), undefined);
  assert.equal("_workId" in dune, false);
  assert.deepEqual(withWorkIds([dune], undefined), [dune]);
});

test("bookKey honours a server key carried on a public book", () => {
  assert.equal(bookKey({ Title: "Orlando", Attribution: "Unknown author", _key: "ta:orlando|" }), "ta:orlando|");
});
```

`arena/arenaSeed.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { toSeedBook } from "./arenaSeed.js";

test("toSeedBook seeds a book's work and refuses a book without one", () => {
  assert.deepEqual(toSeedBook({ Title: "Dune", Attribution: "Frank Herbert", _workId: "w-dune" }, null), { workId: "w-dune", title: "Dune", author: "Frank Herbert", cover: null });
  assert.equal(toSeedBook({ Title: "Dune" }, null), null);
});
```

`tierlists/ballot.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { ballotBoard, blankBoard, toPlacements } from "./ballot.js";
import { aggregate } from "./results.js";

const board = { tiers: [{ id: "s", label: "S", color: "#000000" }, { id: "a", label: "A", color: "#111111" }], pool: ["w1", "w2", "w3"] };

test("a ballot rebuilds the board by work and round-trips to placements", () => {
  assert.deepEqual(blankBoard(board).tiers.map((tier) => tier.workIds), [[], []]);
  const filled = ballotBoard(board, [{ workId: "w2", tierId: "s" }, { workId: "w9", tierId: "gone" }]);
  assert.deepEqual(filled.tiers.map((tier) => tier.workIds), [["w2"], []]);
  assert.deepEqual(filled.pool, ["w1", "w3"]);
  assert.deepEqual(toPlacements(filled), [{ workId: "w2", tierId: "s" }]);
});

test("results aggregate per work", () => {
  const results = aggregate([{ workId: "w1", tierId: "a", votes: 2 }, { workId: "w2", tierId: "s", votes: 1 }], ["s", "a"], ["w1", "w2", "w3"], "plurality");
  assert.deepEqual(results.map((result) => [result.workId, result.tierId]), [["w1", "a"], ["w2", "s"], ["w3", null]]);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd packages/shared && npm test`
Expected: FAIL — `./works.js` missing; `workIds` undefined.

- [ ] **Step 3: Implement**
- `merge.ts` `bookKey`: first line `if (typeof book._key === "string") return book._key;`.
- `library/works.ts`:

```ts
import { bookKey } from "./merge.js";

export function withWorkIds(books: Array<Record<string, unknown>>, works: Record<string, string> | undefined): Array<Record<string, unknown>> {
  return books.map((book) => {
    const workId = works?.[bookKey(book)];
    return workId ? { ...book, _workId: workId } : book;
  });
}

export function workIdOf(book: Record<string, unknown>): string | undefined {
  return typeof book._workId === "string" ? book._workId : undefined;
}
```

  Export both from `library/index.ts`.
- `library/types.ts`: `LibraryDocument` gains `works?: Record<string, string>;`.
- `arena/types.ts` and `arenaSeed.ts`:

```ts
export interface SeedBook {
  workId: string | null;
  title: string;
  author: string;
  cover: string | null;
}
```

  `Duel`: `winnerWorkId: string | null` replaces `winnerKey`. `toSeedBook`:

```ts
export function toSeedBook(book: Record<string, unknown>, cover: string | null): SeedBook | null {
  const workId = workIdOf(book);
  return workId ? { workId, title: String(book.Title ?? "Untitled"), author: String(book.Attribution ?? "Unknown author"), cover } : null;
}
```

  (import `workIdOf` from `../library/works.js`; drop the `bookKey` import if unused).
- Tier lists: rename `bookKeys` → `workIds` in `TierDefinition`, `createTier`, `blankBoard`, `ballotBoard`; `Placement.bookKey` → `workId`; `HistogramCell.bookKey` → `workId`; `BookResult.bookKey` → `workId`; in `aggregate` rename the local `votesByBook`/`bookKey` names to `votesByWork`/`workId` and read `cell.workId`; `toPlacements(data: { tiers: Array<{ id: string; workIds: string[] }> }): Placement[]` maps `workId`. Keep every comment-free line otherwise identical.
- Quizzes: `QuizBook extends QuizBookContent { workId: string }`; add `QuizBookInput`, `QuizDataInput`; `QuizQuestion.bookKey` → `workId: string | null`. `pool.ts`: `entry(id, …)` returns `QuizBookInput & { id: string }` with `id` instead of `key`; `QUIZ_POOL: Array<QuizBookInput & { id: string }>`.
- Run `rg -n "bookKeys|winnerKey|\.bookKey\b|key: bookKey" packages/shared/src/arena packages/shared/src/tierlists packages/shared/src/quizzes` and fix any remaining game-side use. Mural and library code keeps `bookKey`/`bookKeys` (copies).

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/shared && npm run build && npm test && cd ../../backend && npm run typecheck`
Expected: PASS (the backend no longer imports the changed quiz types after Task 10).

- [ ] **Step 5: Commit**

```bash
git add packages/shared && git commit -m "Move the shared game types to works

Games identify books by work id; the library and murals keep book keys.
Records carry their work as _workId, and a public book's server key as
_key, which bookKey honours so public views match exactly.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 13: Web speaks works

**Files** (paths from the E2 fact-finding; `rg` for anything typecheck surfaces beyond them):
- API: `frontend/src/api/client.ts`, `library.ts`, `arena.ts`, `tierlists.ts`, `tierlistVoting.ts`, `quizzes.ts`, `sharedMurals.ts`
- Lib: `frontend/src/lib/arenaSeed.ts`, `frontend/src/lib/sharedMural.ts`, `frontend/src/lib/tierlistResults.ts`
- Pages: `ArenaSeedPage.tsx`, `ArenaViewPage.tsx`, `TierListCreatePage.tsx`, `TierListEditorPage.tsx`, `VoteTierlistPage.tsx`, `QuizCreatePage.tsx`, `QuizEditorPage.tsx`, `MuralEditorPage.tsx`, `SharedMuralPage.tsx`, `CommunityProfilePage.tsx`
- Components: `arena/SeedSlotGrid.tsx`, `arena/DuelCard.tsx`, `arena/BracketMap.tsx`, `tierlist/TierBoard.tsx`, `tierlist/AddBooksSheet.tsx`, `tierlist/TierlistResultsView.tsx`, `murals/blocks/BookBlocks.tsx` (`TierRow`, `DraggableTierTile`), `murals/MuralBlockDetail.tsx`
- Hooks: `useArena.ts`, `useTierlistVoting.ts`
- Tests: `frontend/scripts/test-tierlist-results.mts`, `test-arena-seed.mts`, and any `scripts/test-*.mts` typecheck or `npm test` flags

**Rules:**
1. `rawFetch` sets `headers.set("X-Scripta-Works", "1")` on every request.
2. `api/library.ts`: replace the local `LibraryDocument` interface with `export type { LibraryDocument } from "@scripta/shared";`.
3. `PublicBookData` (`api/sharedMurals.ts`) gains `key: string; workId: string | null;`. Every place that rebuilds a private-shaped book from a public one (`lib/sharedMural.ts` `toPrivateBook`, `VoteTierlistPage.tsx` `toPrivateBook`) adds `_key: pub.key, _workId: pub.workId ?? undefined`. `buildReconstructedBooks` keeps its logic; `bookKey` now returns `_key`, so blocks and highlights match the server's keys exactly.
4. Wherever a game screen offers or matches the owner's library books, use `withWorkIds(library.data.books, library.works)`; offer only books where `workIdOf(book)` is set, and hide books whose work is already in the item (seeding grid "available", tier-list create and add-books, quiz create shelf/collection sources).
5. Game entries are work ids end to end: arena `slot.workId`, `duel.bookA.workId`, `duel.winnerWorkId === duel.bookA.workId`; vote and tiebreak send `{ voterToken, workId }` and `{ winnerWorkId }`; tier boards build `byWork = new Map(books.flatMap((book) => { const id = workIdOf(book); return id ? [[id, book] as const] : []; }))` instead of `byKey`, read `tier.workIds`, use work ids as dnd and React keys; ballots and results use `workId`; quiz books carry `workId` and the editor matches `book.workId`.
6. Owner mural tier-list blocks match tier rows against `withWorkIds(own books, works)`; public ones against the rebuilt books (which carry `_workId`).
7. Quiz create sends `QuizDataInput`: library books as `{ workId, title, author, coverUrl, quote, blurb }`, pool books as `QUIZ_POOL` entries without their `id` (`({ id, ...book }) => book`); pool selection state keys on `id`.
8. Never write `_workId` or `_key` into a library save: they only exist on copies made for game and public views.

- [ ] **Step 1: Update the tests first** — in `scripts/test-tierlist-results.mts` and `scripts/test-arena-seed.mts`, switch fixtures and assertions to `workId`/`workIds`/`winnerWorkId`, and add one case to the results script where two entries' histogram cells are matched by `workId`. Run `cd frontend && npm test` and see them fail.

- [ ] **Step 2: Apply rules 1–8**, file by file, then `cd frontend && npm run typecheck` until clean.

Key code — `lib/sharedMural.ts`:

```ts
export function toPrivateBook(pub: PublicBookData): Record<string, unknown> {
  return {
    Title: pub.title,
    Attribution: pub.author,
    ISBN: pub.isbn,
    ImageId: pub.imageId,
    _coverUrl: pub.coverUrl,
    ReadStatus: pub.readStatus,
    _key: pub.key,
    ...(pub.workId ? { _workId: pub.workId } : {}),
    highlights: [] as Array<Record<string, unknown>>
  };
}
```

`lib/arenaSeed.ts`:

```ts
export async function toSeedBook(book: Record<string, unknown>): Promise<SeedBook | null> {
  const existing = typeof book._coverUrl === "string" ? book._coverUrl : null;
  const cover = existing ?? (await resolveBookCover(book));
  return createSeedBook(book, cover);
}
```

Callers skip a `null` result (they only pass books that have a work).

- [ ] **Step 3: Verify** — `cd frontend && npm run typecheck && npm run lint && npm test`. Expected: PASS.

- [ ] **Step 4: Check in the browser** — start the dev stack per `docs/dev-workflow.md` (claim a port slot), sign in with the seeded dev account, and walk: arena seed → start → vote; tier-list create → edit → open voting → vote on `/vote/:code` → results; quiz create from shelf and from the famous-books pool; a shared mural with a spotlight, a quote and a tier-list block. In the Network panel every API request carries `X-Scripta-Works: 1` and game responses carry `workId`. In the backend log there is no `legacy client` line from the web.

- [ ] **Step 5: Commit**

```bash
git add frontend && git commit -m "Speak works on the web

The web sends X-Scripta-Works and holds work ids for every arena, tier-list
and quiz entry. Public murals match the server's book keys instead of
rebuilding them.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 14: Mobile speaks works

**Files** (as Task 13; `rg` for anything typecheck surfaces beyond them):
- Core and API: `mobile/src/core/apiClient.ts`, `mobile/src/features/library/api/types.ts`, `mobile/src/features/arena/api.ts`, `mobile/src/features/tierlists/api.ts`, `mobile/src/features/quizzes/api.ts`, `mobile/src/features/public/api.ts`
- Arena: `ArenaSeedScreen.tsx`, `ArenaViewScreen.tsx`, `ArenaVoteDeck.tsx`, `DuelSideRow.tsx`, `BracketMap.tsx`, `BracketRounds.tsx`, `arenaView.ts`
- Tier lists: `TierBoard.tsx` (`keyOf` becomes `workOf`), `TierlistCreateScreen.tsx`, `TierlistEditorScreen.tsx`, `VoteTierlistScreen.tsx`, `TierlistResults.tsx`, `TierSortDeck.tsx`, `TierlistShareImage.tsx`, `tierlistShareData.ts`, `tierBoardData.ts`
- Quizzes: `QuizCreateScreen.tsx`, `QuizEditorScreen.tsx`
- Public and murals: `public/adapters.ts`, `murals/MuralCanvas.tsx`, `murals/MuralEditorScreen.tsx` where tier-list blocks render
- Tests: `public/adapters.test.ts`, `tierlists/TierBoard.test.ts`, `tierlists/tierlistShareData.test.ts`, `arena/arenaHome.test.ts`

**Rules:** Task 13's rules 2–8 apply unchanged (rule 2: `features/library/api/types.ts` re-exports `LibraryDocument` from shared). Rule 1 for mobile: `rawRequest` adds `headers["X-Scripta-Works"] = "1";` next to `Content-Type`. `TierBoard.tsx`'s `keyOf` becomes:

```ts
export function workOf(book: TierBook): string | undefined {
  return workIdOf(book);
}
```

and every `TierBook` built from a voting payload carries `_workId` (in `VoteTierlistScreen.tsx`, build the records with `privateBook`-style fields plus `_key` and `_workId`, then `cleanBoard` filters `board.pool` by the set of `workOf` values). `adapters.ts` `privateBook` adds `_key: book.key` and `_workId: book.workId ?? undefined` (same shape as the web's `toPrivateBook`); `reconstructTierlists` passes `tiers`/`pool` through unchanged (now work ids).

- [ ] **Step 1: Update the tests first** — `adapters.test.ts`: a public book with an empty author and key `ta:orlando|` must attach its highlight (`bookKey: "ta:orlando|"`) and be found by a shelf block holding `ta:orlando|`; fixtures for `TierBoard.test.ts`, `tierlistShareData.test.ts`, `arenaHome.test.ts` move to `workId`/`workIds`/`winnerWorkId`. Run `cd mobile && npm test` and see them fail.

- [ ] **Step 2: Apply the rules**, then `cd mobile && npm run typecheck` until clean.

- [ ] **Step 3: Verify** — `cd mobile && npm run typecheck && npm test`. Expected: PASS. `npx expo-doctor` stays as before (this task adds no dependency, so the native fingerprint is unchanged and the change ships over the air).

- [ ] **Step 4: Commit**

```bash
git add mobile && git commit -m "Speak works on mobile

Mobile sends X-Scripta-Works and holds work ids for every arena, tier-list
and quiz entry. JS only, so it ships as an OTA update.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 15: Device pass

- [ ] **Step 1:** Run `node scripts/dev-status.mjs --json`. If another worktree holds the emulator lease, skip to Step 3 and say so in the PR.
- [ ] **Step 2:** Dispatch `device-checker` (worktree path, a scratch screenshot dir) for: arena seeding (pick, random fill), arena view and vote, a tier list create → edit → open voting → vote → results, quiz create from the shelf and from famous books, a public mural with a spotlight, a quote and a tier-list block, and a public profile with that mural. Correct looks like: every book shows its cover and title; nothing reads "Books unavailable" or "Pick a book"; votes count on the tapped side; the backend log shows no `legacy client` line from the emulator.
- [ ] **Step 3:** Fix anything it reports in Task 14's files, re-run `cd mobile && npm run typecheck && npm test`, and commit.

---

## Execution notes

- Each PR is cut from `origin/main` after the previous one merges (the `ship` skill). A `branch-reviewer` pass runs once per PR before it is opened.
- **PR 5 gate.** Before merging PR 5, PRs 2–4 must be live: with `API` set to the production API URL (`EXPO_PUBLIC_API_URL` in `mobile/eas.json`'s production profile),

```bash
curl -s -D - -o /dev/null "$API/arenas/public" | grep -i '^vary'
```

```bash
curl -s -D - -o /dev/null "$API/tierlists/voting/zzzzzzzz" | grep -i '^vary'
```

  both show `X-Scripta-Works`. PR 4 (quizzes) has only signed-in routes; confirm its merge commit is the live Railway deployment (`deploy-ops`, read-only).
- After PR 5 merges: Pages redeploys the web, and `mobile/.eas/workflows/production-update.yml` publishes the OTA update (no native change). From then on, `legacy client` lines come only from old builds; the 14-day gate in the spec starts at that OTA publish.
- The removal (E2b, PRs 6–9) is not in this plan. Write its plan after the gate clears, starting from the pre-removal check in the spec.
