# Fixture Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dev account fixture show every screen shipped since late September without the network or hand-written SQL. Fix two fixture bugs, record real shop responses for the newest parsing paths, and make the Codex review report its model.

**Architecture:** All data is synthetic and written by the existing seed scripts:
- `scripts/fixtures/library.json`, raw-written by `dev-account.mjs`;
- `backend/scripts/three-users.mjs`, which seeds once per data directory and is tested by `--check`;
- `scripts/dev-community.mjs` and `scripts/dev-editions.mjs`, which are idempotent and run on every emulator or phone boot.

The recorded shop fixtures were captured and trimmed while this plan was written, and are committed with it. The tasks only add the tests that read them.

**Tech Stack:** Node 26, tsx, `node:test`, Fastify `app.inject`, SQLite.

**Spec:** `docs/superpowers/specs/2026-10-16-fixture-refresh-design.md`

## Global Constraints

- No comments in code. Put the non-obvious *why* in the commit message (root `AGENTS.md`).
- Every seed stays idempotent: a second run adds nothing and changes nothing.
- Fixture text is synthetic or public domain. Recorded shop fixtures stay as committed; never paste more publisher prose into them, because the repo is public.
- Fresh worktree setup, once, before any backend or script command:
  - `npm run dev:link-deps`
  - `npm run build --workspace @scripta/shared`
  - Without these, `@scripta/shared` resolves to the primary checkout's stale build.
- Root script tests run with `npm run test:scripts`. Never use `node --test scripts/`.
- Stage and commit in one call (`git add <paths> && git commit …`). Other sessions share the git index.
- Do not run the seeds while this worktree's backend is running. Check with `node scripts/dev-status.mjs --json`.

## Review Focus

1. **A data directory seeded before this branch, then booted without `--reset`.**
   - `dev-community.mjs` and `dev-editions.mjs` must still succeed against it: old ISBNs, The Return of the King still "reading", no `quiz` in the three-user manifest.
   - The quiz step goes by title and author, and charlie's shared books by title, so neither depends on the new ISBNs.
   - Task 4 and Task 5 each run the seeds a second time, without a reset, to prove the idempotent path.
2. **Seeds run twice.** There must be no second "Guess the classic" quiz, no second play (409 is accepted), and no changed synopsis or genres. Task 4 and Task 5 each check this.
3. **Typed highlights in shared views.** Once alice's highlights carry `Type: "highlight"`, they become eligible passages. `PRIVATE_FIXTURE_NOTE` must still never reach a shared library or a public mural. `--check` already asserts this; Task 3 must keep those assertions and run `--check`.
4. **CI's clean environment.** There is no `backend/.env` and no developer variables. Task 1, Task 3 and Task 7 run `test:fixture` under `env -i`.

## Seed verification (used by Task 4 and Task 5)

Write this file once, outside the repo:

```bash
mkdir -p "$TMPDIR/fixture-refresh" && cat > "$TMPDIR/fixture-refresh/verify-seeds.mjs" <<'EOF'
const root = process.cwd();
const { devDataDirEnv } = await import(`${root}/scripts/devDataDir.mjs`);
const { DEV_EMAIL, DEV_PASSWORD, ensureBackendEnv } = await import(`${root}/scripts/dev-account.mjs`);
ensureBackendEnv();
process.chdir(`${root}/backend`);
Object.assign(process.env, devDataDirEnv());
const { buildApp } = await import(`${root}/backend/src/app.ts`);
const { openBooksDb } = await import(`${root}/backend/src/modules/books/adapters/sqlite/connection.ts`);
const { createSqliteBooksRepository } = await import(`${root}/backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`);
const app = buildApp();
await app.ready();
try {
  const login = await app.inject({ method: "POST", url: "/auth/login", payload: { identifier: DEV_EMAIL, password: DEV_PASSWORD } });
  const headers = { authorization: `Bearer ${login.json().accessToken}` };
  const dashboard = JSON.stringify((await app.inject({ url: "/community/dashboard?kinds=publication,vote,reading,follow,participation", headers })).json());
  const { quizzes } = (await app.inject({ url: "/quizzes", headers })).json();
  console.log("alice quiz in dashboard:", dashboard.includes("Alice's guess-the-book quiz"));
  console.log("dev quiz in dashboard:", dashboard.includes("Guess the classic"));
  console.log("dev quizzes named Guess the classic:", quizzes.filter((quiz) => quiz.name === "Guess the classic").length);
  const repo = createSqliteBooksRepository(openBooksDb());
  for (const isbn of ["9780547928227", "9780441172719"]) {
    const edition = repo.findBookByKey(`isbn:${isbn}`);
    const page = (await app.inject({ url: `/works/${edition.work_id}` })).json();
    console.log(isbn, "genres:", JSON.stringify(page.work.genres), "edition summary:", (edition.summary ?? "").slice(0, 40), "page has summary:", Boolean(page.work.summary));
  }
} finally {
  await app.close();
}
EOF
```

Reset and seed this worktree's `backend/data/dev/` the way `dev-emulator.mjs` does:

```bash
node -e 'import("./scripts/devFixtureSetup.mjs").then((m) => { const log = console.log; m.resetDevDataIfRequested(true, log); m.seedDevAccount(true, log); m.seedEditionWorks(log); m.seedFixtureUsers(log); m.seedCommunityGraph(log); })'
```

Re-seed without a reset (the path every later boot takes):

```bash
node -e 'import("./scripts/devFixtureSetup.mjs").then((m) => { const log = console.log; m.seedDevAccount(false, log); m.seedEditionWorks(log); m.seedFixtureUsers(log); m.seedCommunityGraph(log); })'
```

Verify:

```bash
node --import tsx "$TMPDIR/fixture-refresh/verify-seeds.mjs"
```

---

### Task 1: Every backend database in the dev data directory

`DB_MODULES` omits `quizzes`, so dev runs open the developer's own `backend/data/quizzes.sqlite`. `three-users.mjs` keeps its own copy of the list, with the same gap, for its isolated and `--check` modes. Task 3 publishes a quiz from `three-users.mjs`, so this task must land first.

Two things change for a worktree that already has a dev backend running:
- `assertAdoptedBackendMatches` (`scripts/devFixtureSetup.mjs`) will refuse a dev backend started before this change, because its environment lacks `QUIZZES_DB_PATH`. Stop that backend and boot again.
- Dev quizzes made before this change stay in `backend/data/quizzes.sqlite`. Nothing migrates them.

**Files:**
- Modify: `scripts/devDataDir.mjs`
- Modify: `backend/scripts/three-users.mjs`
- Test: `scripts/devDataDir.test.mjs`

**Interfaces:**
- Produces: `devDataDirEnv(directory)` returns a `*_DB_PATH` entry for every `*_DB_PATH` that `backend/src/config/env.ts` declares, except `WAITLIST_DB_PATH`. `env.ts:188` derives that one from `AUTH_DB_PATH`'s directory, so it follows automatically.

- [ ] **Step 1: Write the failing test**

In `scripts/devDataDir.test.mjs`, change the import line to:

```js
import { devDataDirEnv, migrateLegacyFiles } from "./devDataDir.mjs";
```

Append:

```js
test("devDataDirEnv points every database the backend declares at the dev data directory", () => {
  const source = readFileSync(new URL("../backend/src/config/env.ts", import.meta.url), "utf8");
  const declared = [...new Set([...source.matchAll(/^\s+([A-Z]+)_DB_PATH:/gm)].map((match) => match[1]))].filter((name) => name !== "WAITLIST");
  const env = devDataDirEnv("/dev-data");
  assert.deepEqual(Object.keys(env).filter((key) => key.endsWith("_DB_PATH")).sort(), declared.map((name) => `${name}_DB_PATH`).sort());
  for (const name of declared) assert.equal(env[`${name}_DB_PATH`], join("/dev-data", `${name.toLowerCase()}.sqlite`));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:scripts`
Expected: FAIL in "devDataDirEnv points every database…". The actual key list lacks `QUIZZES_DB_PATH`.

- [ ] **Step 3: Implement**

In `scripts/devDataDir.mjs`, replace the `DB_MODULES` line with:

```js
const DB_MODULES = ["auth", "library", "gallery", "covers", "socials", "arena", "murals", "tierlists", "quizzes", "community"];
```

In `backend/scripts/three-users.mjs`, add next to the other imports at the top:

```js
import { devDataDirEnv } from "../../scripts/devDataDir.mjs";
```

Then replace these lines inside `if (!shared) { … }`:

```js
  for (const module of ["auth", "library", "gallery", "covers", "socials", "arena", "murals", "tierlists", "community"]) {
    process.env[`${module.toUpperCase()}_DB_PATH`] = join(directory, `${module}.sqlite`);
  }
  process.env.FILES_STORAGE_PATH = join(directory, "files");
```

with:

```js
  Object.assign(process.env, devDataDirEnv(directory));
```

- [ ] **Step 4: Run the tests and the fixture check**

Run: `npm run test:scripts`
Expected: PASS.

Run: `env -i PATH="$PATH" HOME="$HOME" npm run test:fixture --workspace backend 2>&1 | rg 'Three-user fixture checks passed'`
Expected: `Three-user fixture checks passed: data, privacy, ownership, ballots, duplicate votes, revoked shares, and preserved progress.`

- [ ] **Step 5: Commit**

```bash
git add scripts/devDataDir.mjs scripts/devDataDir.test.mjs backend/scripts/three-users.mjs && git commit -m "Keep the quizzes database in the dev data directory

DB_MODULES left quizzes out, so the emulator stack and test:fixture opened
the developer's own backend/data/quizzes.sqlite. three-users.mjs now reuses
devDataDirEnv instead of its own copy of the list, and a test compares the
list with every *_DB_PATH env.ts declares (WAITLIST_DB_PATH is derived from
AUTH_DB_PATH's directory)."
```

---

### Task 2: A valid, rich dev library fixture

**Files:**
- Modify: `scripts/fixtures/library.json`
- Modify: `scripts/dev-community.mjs`
- Modify: `packages/shared/src/library/readerIdentity.test.ts`
- Create: `packages/shared/src/library/devFixture.test.ts`

**Interfaces:**
- Produces the following, which Tasks 3 and 4 rely on:
  - library.json book titles "The Return of the King", "1984", "Dracula", "Frankenstein" and "Pride and Prejudice" stay present;
  - The Return of the King has ISBN `9780547928197`, `ReadStatus: 2` and `Rating: 5`.

- [ ] **Step 1: Write the failing tests**

Create `packages/shared/src/library/devFixture.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { eligiblePassages } from "../murals/home.js";
import { buildMuralPreset } from "../murals/presets.js";
import { genresForBook } from "./bookGenres.js";
import type { Group } from "./groups.js";
import { bookKey } from "./merge.js";

type Book = Record<string, unknown>;
const fixture = JSON.parse(readFileSync(new URL("../../../../scripts/fixtures/library.json", import.meta.url), "utf8")) as { books: Book[]; groups: Group[] };

const validIsbn13 = (isbn: string) => /^97[89]\d{10}$/.test(isbn) && [...isbn].reduce((sum, digit, index) => sum + Number(digit) * (index % 2 === 0 ? 1 : 3), 0) % 10 === 0;

test("every fixture ISBN has a valid check digit", () => {
  assert.deepEqual(fixture.books.filter((book) => !validIsbn13(String(book.ISBN))).map((book) => book.Title), []);
});

test("every group key names a fixture book", () => {
  const keys = new Set(fixture.books.map(bookKey));
  assert.deepEqual(fixture.groups.flatMap((group) => group.bookKeys.filter((key) => !keys.has(key))), []);
});

test("every fixture book carries known genres, so none waits on a network genre lookup", () => {
  const unknown = fixture.books.filter((book) => !Array.isArray(book._genres) || genresForBook(book).length !== book._genres.length);
  assert.deepEqual(unknown.map((book) => book.Title), []);
});

test("every finished fixture book has a rating and a read date", () => {
  const bare = fixture.books.filter((book) => book.ReadStatus === 2 && (typeof book.Rating !== "number" || typeof book.DateLastRead !== "string"));
  assert.deepEqual(bare.map((book) => book.Title), []);
});

test("the fixture's shelf preset has a reader card, a passage and favourites", () => {
  const blocks = buildMuralPreset("shelf", fixture.books, fixture.groups).blocks;
  assert.deepEqual(blocks.map((block) => (block.type === "shelf" ? `shelf:${block.title}` : block.type)), ["profile", "readerCard", "stats", "currentlyReading", "shelf:Finished", "quote", "shelf:Favourites"]);
  assert.equal(eligiblePassages(fixture.books).length, 4);
});
```

In `packages/shared/src/library/readerIdentity.test.ts`, replace the test named "the sample library fixture leans Cartographer with 3 of 11 finished books in a series" (the whole `test(…)` block) with:

```ts
test("the sample library fixture settles as a classics reader with a fantasy streak", () => {
  const data = JSON.parse(readFileSync(fixturePath, "utf8")) as { books: Book[]; groups: Group[] };
  const result = readerIdentity(data.books, data.groups);
  assert.equal(result.state, "settled");
  assert.equal(result.identity, "corr");
  assert.equal(result.streak, "star");
  assert.deepEqual(result.signal, { counted: 11, of: 12, label: "11 of 12 finished books with known genres are classics, literary fiction or poetry" });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test --workspace @scripta/shared 2>&1 | rg '^ℹ (pass|fail)|^✖'`
Expected: FAIL in four `devFixture.test.ts` tests and in "the sample library fixture settles…" (its state is `leaning`). "every group key names a fixture book" already passes, because books and groups share the old ISBNs. It guards Step 3's edit.

- [ ] **Step 3: Replace the fixture**

Write `scripts/fixtures/library.json` with exactly this content:

```json
{
  "schema_version": 1,
  "book_count": 24,
  "name": "Dev Library",
  "books": [
    { "ContentID": "fixture-1", "Title": "The Fellowship of the Ring", "Attribution": "J.R.R. Tolkien", "ISBN": "9780544003415", "Series": "The Lord of the Rings", "SeriesNumber": 1, "ReadStatus": 2, "Rating": 5, "DateLastRead": "2023-02-11", "_genres": ["Fantasy", "Classics"] },
    { "ContentID": "fixture-2", "Title": "The Two Towers", "Attribution": "J.R.R. Tolkien", "ISBN": "9780547928203", "Series": "The Lord of the Rings", "SeriesNumber": 2, "ReadStatus": 2, "Rating": 4, "DateLastRead": "2023-04-02", "_genres": ["Fantasy", "Classics"] },
    { "ContentID": "fixture-3", "Title": "The Return of the King", "Attribution": "J.R.R. Tolkien", "ISBN": "9780547928197", "Series": "The Lord of the Rings", "SeriesNumber": 3, "ReadStatus": 2, "Rating": 5, "DateLastRead": "2023-06-18", "_genres": ["Fantasy", "Classics"] },
    { "ContentID": "fixture-4", "Title": "A Game of Thrones", "Attribution": "George R.R. Martin", "ISBN": "9780553593716", "Series": "A Song of Ice and Fire", "SeriesNumber": 1, "ReadStatus": 2, "Rating": 3, "DateLastRead": "2024-01-20", "_genres": ["Fantasy"] },
    { "ContentID": "fixture-5", "Title": "A Clash of Kings", "Attribution": "George R.R. Martin", "ISBN": "9780553579901", "Series": "A Song of Ice and Fire", "SeriesNumber": 2, "ReadStatus": 1, "_genres": ["Fantasy"] },
    { "ContentID": "fixture-6", "Title": "A Storm of Swords", "Attribution": "George R.R. Martin", "ISBN": "9780553573428", "Series": "A Song of Ice and Fire", "SeriesNumber": 3, "ReadStatus": 0, "_genres": ["Fantasy"] },
    { "ContentID": "fixture-7", "Title": "The Hobbit", "Attribution": "J.R.R. Tolkien", "ISBN": "9780547928227", "ReadStatus": 2, "Rating": 5, "DateLastRead": "2022-12-28", "_genres": ["Fantasy", "Classics", "Children's"] },
    {
      "ContentID": "fixture-8",
      "Title": "1984",
      "Attribution": "George Orwell",
      "ISBN": "9780451524935",
      "ReadStatus": 2,
      "Rating": 4,
      "DateLastRead": "2024-05-09",
      "_genres": ["Science Fiction", "Classics", "Politics"],
      "_style": {
        "cardRadius": 0,
        "cardAspectRatio": "1/1",
        "cardBorderWidth": 2,
        "cardBorderStyle": "dashed",
        "cardBorderColor": "#c0392b",
        "cardBorderOpacity": 100,
        "cardBorderSides": { "top": true, "right": true, "bottom": true, "left": true },
        "cardOpacity": 100,
        "cardShadow": false,
        "cardHoverEffect": true,
        "overlayIntensity": 88,
        "showTitleAuthor": true,
        "cardFontFamily": "mono",
        "cardFontSize": 13,
        "cardTextColor": null,
        "cardBold": true,
        "cardItalic": false
      }
    },
    { "ContentID": "fixture-9", "Title": "Brave New World", "Attribution": "Aldous Huxley", "ISBN": "9780060850524", "ReadStatus": 1, "_genres": ["Science Fiction", "Classics"] },
    { "ContentID": "fixture-10", "Title": "Fahrenheit 451", "Attribution": "Ray Bradbury", "ISBN": "9781451673319", "ReadStatus": 0, "_genres": ["Science Fiction", "Classics"] },
    {
      "ContentID": "fixture-11",
      "Title": "Pride and Prejudice",
      "Attribution": "Jane Austen",
      "ISBN": "9780141439518",
      "ReadStatus": 2,
      "Rating": 4,
      "DateLastRead": "2024-09-14",
      "_genres": ["Romance", "Classics"],
      "highlights": [
        { "BookmarkID": "fixture-dev-highlight-1", "Type": "highlight", "Text": "It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.", "DateCreated": "2024-08-30T21:04:00.000Z" },
        { "BookmarkID": "fixture-dev-highlight-2", "Type": "highlight", "Text": "I declare after all there is no enjoyment like reading!", "Annotation": "Caroline, who is not reading.", "DateCreated": "2024-09-02T22:15:00.000Z" }
      ]
    },
    { "ContentID": "fixture-12", "Title": "To Kill a Mockingbird", "Attribution": "Harper Lee", "ISBN": "9780061120084", "ReadStatus": 2, "Rating": 5, "DateLastRead": "2025-01-05", "_genres": ["Classics", "Literary Fiction"] },
    { "ContentID": "fixture-13", "Title": "The Great Gatsby", "Attribution": "F. Scott Fitzgerald", "ISBN": "9780743273565", "ReadStatus": 1, "_genres": ["Classics", "Literary Fiction"] },
    { "ContentID": "fixture-14", "Title": "Moby-Dick", "Attribution": "Herman Melville", "ISBN": "9781503280786", "ReadStatus": 0, "_genres": ["Classics"] },
    { "ContentID": "fixture-15", "Title": "War and Peace", "Attribution": "Leo Tolstoy", "ISBN": "9781400079988", "ReadStatus": 0, "_genres": ["Classics", "Historical Fiction"] },
    { "ContentID": "fixture-16", "Title": "Crime and Punishment", "Attribution": "Fyodor Dostoevsky", "ISBN": "9780486415871", "ReadStatus": 1, "_genres": ["Classics", "Literary Fiction"] },
    {
      "ContentID": "fixture-17",
      "Title": "Dracula",
      "Attribution": "Bram Stoker",
      "ISBN": "9780486411095",
      "ReadStatus": 2,
      "Rating": 3,
      "DateLastRead": "2025-10-31",
      "_genres": ["Horror", "Classics"],
      "highlights": [
        { "BookmarkID": "fixture-dev-highlight-3", "Type": "highlight", "Text": "Listen to them, the children of the night. What music they make!", "DateCreated": "2025-10-28T23:40:00.000Z" }
      ]
    },
    {
      "ContentID": "fixture-18",
      "Title": "Frankenstein",
      "Attribution": "Mary Shelley",
      "ISBN": "9780486282114",
      "ReadStatus": 2,
      "Rating": 4,
      "DateLastRead": "2026-01-17",
      "_genres": ["Science Fiction", "Horror", "Classics"],
      "highlights": [
        { "BookmarkID": "fixture-dev-highlight-4", "Type": "highlight", "Text": "Beware; for I am fearless, and therefore powerful.", "DateCreated": "2026-01-12T20:30:00.000Z" }
      ]
    },
    { "ContentID": "fixture-19", "Title": "The Picture of Dorian Gray", "Attribution": "Oscar Wilde", "ISBN": "9780486278070", "ReadStatus": 1, "_genres": ["Classics", "Literary Fiction"] },
    { "ContentID": "fixture-20", "Title": "Jane Eyre", "Attribution": "Charlotte Brontë", "ISBN": "9780141441146", "ReadStatus": 0, "_genres": ["Romance", "Classics"] },
    { "ContentID": "fixture-21", "Title": "Wuthering Heights", "Attribution": "Emily Brontë", "ISBN": "9780141439556", "ReadStatus": 0, "_genres": ["Romance", "Classics"] },
    { "ContentID": "fixture-22", "Title": "The Odyssey", "Attribution": "Homer", "ISBN": "9780140268867", "ReadStatus": 1, "_genres": ["Classics", "Poetry"] },
    { "ContentID": "fixture-23", "Title": "Don Quixote", "Attribution": "Miguel de Cervantes", "ISBN": "9780060934347", "ReadStatus": 2, "Rating": 2, "DateLastRead": "2026-04-03", "_genres": ["Classics"] },
    { "ContentID": "fixture-24", "Title": "The Catcher in the Rye", "Attribution": "J.D. Salinger", "ISBN": "9780316769488", "ReadStatus": 2, "Rating": 3, "DateLastRead": "2026-08-22", "_genres": ["Classics", "Literary Fiction"] }
  ],
  "groups": [
    {
      "id": "fixture-group-lotr",
      "type": "series",
      "name": "The Lord of the Rings",
      "bookKeys": ["isbn:9780544003415", "isbn:9780547928203", "isbn:9780547928197"],
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z",
      "style": {
        "cardRadius": 24,
        "cardAspectRatio": "3/4",
        "cardBorderWidth": 3,
        "cardBorderStyle": "double",
        "cardBorderColor": "#8e6b2c",
        "cardBorderOpacity": 100,
        "cardBorderSides": { "top": true, "right": true, "bottom": true, "left": true },
        "cardOpacity": 100,
        "cardShadow": true,
        "cardHoverEffect": true,
        "overlayIntensity": 92,
        "showTitleAuthor": true,
        "cardFontFamily": "playfairDisplay",
        "cardFontSize": 14,
        "cardTextColor": null,
        "cardBold": false,
        "cardItalic": true
      }
    },
    {
      "id": "fixture-group-asoiaf",
      "type": "series",
      "name": "A Song of Ice and Fire",
      "bookKeys": ["isbn:9780553593716", "isbn:9780553579901", "isbn:9780553573428"],
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z"
    },
    {
      "id": "fixture-group-favorites",
      "type": "collection",
      "name": "Favorites",
      "bookKeys": [
        "isbn:9780544003415",
        "isbn:9780547928227",
        "isbn:9780451524935",
        "isbn:9780061120084",
        "isbn:9780486411095"
      ],
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z"
    },
    {
      "id": "fixture-group-nightstand",
      "type": "collection",
      "name": "On the nightstand",
      "bookKeys": [
        "isbn:9780553579901",
        "isbn:9780743273565",
        "isbn:9781400079988",
        "isbn:9780141439556"
      ],
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z"
    }
  ]
}
```

In `scripts/dev-community.mjs`, in `SHARED_BOOKS`, change The Two Towers' ISBN `9780544003423` to `9780547928203`.

- [ ] **Step 4: Run the tests**

Run: `npm test --workspace @scripta/shared 2>&1 | rg '^ℹ (pass|fail)|^✖'`
Expected: `ℹ fail 0` and no `✖` lines.

Run: `rg -n '9780544003423|9780544003430' --hidden -g '!node_modules' -g '!docs/**'`
Expected: no output.

Run: `env -i PATH="$PATH" HOME="$HOME" npm run test:fixture --workspace backend 2>&1 | rg 'Three-user fixture checks passed'`
Expected: the "Three-user fixture checks passed" line. The three users take their 16 titles and ISBNs from this file.

- [ ] **Step 5: Commit**

```bash
git add scripts/fixtures/library.json scripts/dev-community.mjs packages/shared/src/library/readerIdentity.test.ts packages/shared/src/library/devFixture.test.ts && git commit -m "Give the dev library ratings, read dates, genres and passages

The Two Towers and The Return of the King had invalid check digits; they
now use the Mariner 2012 ISBNs that Open Library knows. The Return of the
King is finished so three readers can rate it once the fixture users do.

With genres on every book the account settles as a classics reader with a
fantasy streak, so the shelf preset offers the reader card, a rediscover
passage and Favourites. Before, online genre lookups made the pinned
'leaning' state depend on the network anyway. Highlights are public-domain
lines. devFixture.test.ts pins what device passes rely on."
```

---

### Task 3: Fixture users rate, highlight and publish a quiz

`three-users.mjs` seeds once per data directory (manifest-gated), and `--check` exercises it in CI from Task 7 on.

**Files:**
- Modify: `backend/scripts/three-users.mjs`
- Modify: `backend/scripts/three-users.md`

**Interfaces:**
- Consumes: library.json titles "The Fellowship of the Ring", "A Game of Thrones", "The Hobbit" and "Brave New World". All four are in alice's books (`books.slice(0, 12)`).
- Produces:
  - alice's and bob's finished books carry `Rating: 4`, so The Return of the King has three ratings with the dev account's 5;
  - the manifest gains `quiz: { id, code }`;
  - alice publishes a quiz named "Alice's guess-the-book quiz".

- [ ] **Step 1: Add the failing check**

In `check(fixture)`, directly after the line that votes a second time in the arena (the one expecting `409`), add:

```js
  const { board: quizBoard } = await request("GET", `/quizzes/voting/${fixture.quiz.code}`);
  assert.equal(quizBoard.questions.length, 4);
  assert.equal(quizBoard.playOpen, true);
  const aliceRatings = (await request("GET", "/library", undefined, tokens.alice)).data.books.filter((book) => book.Rating === 4).map((book) => book.Title);
  assert.deepEqual(aliceRatings, ["The Return of the King", "A Storm of Swords", "Brave New World", "To Kill a Mockingbird"]);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `env -i PATH="$PATH" HOME="$HOME" npm run test:fixture --workspace backend 2>&1 | rg -m1 'TypeError|AssertionError'`
Expected: `TypeError: Cannot read properties of undefined (reading 'code')`. The manifest has no `quiz` yet.

- [ ] **Step 3: Implement**

After `const password = "scripta123";`, add:

```js
const ALICE_QUIZ = [
  ["The Fellowship of the Ring", "Nine walkers leave a quiet country to carry a ring back to the fire that made it."],
  ["A Game of Thrones", "A northern lord rides south to serve his king and finds the capital colder than winter."],
  ["The Hobbit", "A comfortable homebody is hired as a burglar by thirteen dwarves and a wizard."],
  ["Brave New World", "In a tidy future where everyone is happy by design, one man would rather be unhappy and free."]
];
```

Replace the `books` mapping in `seed()`:

```js
  const books = titles.slice(0, 16).map((book, index) => ({
    ContentID: `fixture-book-${index + 1}`, Title: book.Title, Attribution: book.Attribution, ISBN: book.ISBN ?? null,
    ReadStatus: index % 3, ___PercentRead: [0, 45, 100][index % 3],
    highlights: [{ BookmarkID: `fixture-highlight-${index + 1}`, Text: "A synthetic passage for testing.", Annotation: "PRIVATE_FIXTURE_NOTE" }]
  }));
```

with:

```js
  const books = titles.slice(0, 16).map((book, index) => ({
    ContentID: `fixture-book-${index + 1}`, Title: book.Title, Attribution: book.Attribution, ISBN: book.ISBN ?? null,
    ReadStatus: index % 3, ___PercentRead: [0, 45, 100][index % 3], ...(index % 3 === 2 ? { Rating: 4 } : {}),
    highlights: [{ BookmarkID: `fixture-highlight-${index + 1}`, Type: "highlight", Text: "A synthetic passage for testing.", Annotation: "PRIVATE_FIXTURE_NOTE" }]
  }));
```

Replace:

```js
  const manifest = { users, library: { shareToken: library.shareToken }, murals, polls, arena: { id: arena.id, bobVoterToken: voterToken } };
```

with:

```js
  const quizBooks = ALICE_QUIZ.map(([title, blurb]) => {
    const book = aliceBooks.find((entry) => entry.Title === title);
    return { workId: works[bookKey(book)], title, author: book.Attribution, blurb };
  });
  const draft = await request("POST", "/quizzes", { name: "Alice's guess-the-book quiz", data: { sourceLabel: "Alice's shelf", questionCount: 4, allowedTypes: ["blurb_title"], books: quizBooks } }, tokens.alice, 201);
  const { voteCode: quizCode } = await request("POST", `/quizzes/${draft.id}/publish`, {}, tokens.alice, 201);
  const manifest = { users, library: { shareToken: library.shareToken }, murals, polls, arena: { id: arena.id, bobVoterToken: voterToken }, quiz: { id: draft.id, code: quizCode } };
```

- [ ] **Step 4: Run the check**

Run: `env -i PATH="$PATH" HOME="$HOME" npm run test:fixture --workspace backend 2>&1 | rg 'Three-user fixture checks passed'`
Expected: the "Three-user fixture checks passed" line.

If a `PRIVATE_FIXTURE_NOTE` assertion fails: typed highlights now reach a shared view and leak their annotation. That is a real privacy bug. Stop and report it; do not weaken the assertion.

Run: `npm test --workspace backend 2>&1 | rg '^ℹ (pass|fail)|^✖'`
Expected: `ℹ fail 0` and no `✖` lines.

In `backend/scripts/three-users.md`, replace the `fixture_alice` and `fixture_bob` rows of the "Starting state" table with:

```markdown
| `fixture_alice` | 12 books (4 finished, each rated 4), one highlight per book, shared library, shared/private freeform murals, two private source tier lists plus two open community copies, active four-book Arena, a published four-question blurb quiz |
| `fixture_bob` | 8 books (4 overlap Alice; 2 finished, each rated 4), a ballot on each poll, one Arena vote under a separate voter token |
```

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/three-users.mjs backend/scripts/three-users.md && git commit -m "Seed fixture-user ratings, typed highlights and a published quiz

Untyped highlights never counted as passages, so alice's shelf and Home had
none. Typing them also puts the privacy assertions on the realistic shape:
PRIVATE_FIXTURE_NOTE must still stay out of shared views.

Finished books carry Rating 4, which gives The Return of the King three
raters with the dev account and so a community stats tile. Alice's quiz uses
blurb questions only, so it publishes without covers or the network."
```

---

### Task 4: The dev account's quiz, played by alice

Home's participation rows are plays on games the viewer owns, so the dev account needs a published quiz that someone has played. `dev-community.mjs` runs on every boot and is the only seed that holds both accounts.

The quiz names its books by title and author because `dev-account.mjs` writes the library raw: its works resolve only when the backend boots, and the quiz route resolves titles on its own.

**Files:**
- Modify: `scripts/dev-community.mjs`

**Interfaces:**
- Consumes:
  - the dev library's "1984", "Dracula", "Frankenstein" and "Pride and Prejudice" (Task 2);
  - alice's "Alice's guess-the-book quiz" (Task 3), which reaches the dev account's inbox when the dev account follows alice.
- Produces: a published dev quiz named "Guess the classic", played once by fixture_alice.

- [ ] **Step 1: Run the verification to see it fail**

Write the verification script and run the reset seed and verify commands from "Seed verification" above.
Expected: `dev quiz in dashboard: false` and `dev quizzes named Guess the classic: 0`. `alice quiz in dashboard` already prints `true` (Task 3).

- [ ] **Step 2: Implement**

Below `SHARED_BOOKS`, add:

```js
const DEV_QUIZ = {
  name: "Guess the classic",
  books: [
    { title: "1984", author: "George Orwell", blurb: "A records clerk rewrites yesterday's news and keeps a diary he must never be caught with." },
    { title: "Dracula", author: "Bram Stoker", blurb: "A young solicitor travels east to sell a London house to a count who never eats." },
    { title: "Frankenstein", author: "Mary Shelley", blurb: "A student builds a man from the dead and runs from him the moment he opens his eyes." },
    { title: "Pride and Prejudice", author: "Jane Austen", blurb: "Five unmarried sisters, one wealthy newcomer, and a proud friend everyone misjudges." }
  ]
};
```

Below `ensureSharedBooks`, add:

```js
async function ensurePlayedQuiz(owner, player) {
  const { quizzes } = await call("GET", "/quizzes", undefined, owner.token);
  const quiz = quizzes.find((entry) => entry.name === DEV_QUIZ.name)
    ?? await call("POST", "/quizzes", { name: DEV_QUIZ.name, data: { sourceLabel: "My shelf", questionCount: 4, allowedTypes: ["blurb_title"], books: DEV_QUIZ.books } }, owner.token);
  const code = quiz.voteCode ?? (await call("POST", `/quizzes/${quiz.id}/publish`, {}, owner.token)).voteCode;
  const { board } = await call("GET", `/quizzes/voting/${code}`);
  const answers = board.questions.map((question) => ({ questionId: question.id, choiceIndex: 0 }));
  await call("POST", `/quizzes/voting/${code}/play`, { answers, durationMs: 42_000 }, player.token, [200, 409]);
}
```

In the `try` block, after `await ensureSharedBooks(charlie);`, add:

```js
  await ensurePlayedQuiz(dev, alice);
```

Replace the final `log(…)` line in the `try` block with:

```js
  log(`${DEV_USERNAME} follows fixture_alice and fixture_bob, fixture_alice follows back, and fixture_alice has played "${DEV_QUIZ.name}".`);
```

- [ ] **Step 3: Verify after a reset**

Run the reset seed command, then the verify command.
Expected:
```
alice quiz in dashboard: true
dev quiz in dashboard: true
dev quizzes named Guess the classic: 1
```

- [ ] **Step 4: Verify the re-run path**

Run the re-seed command (no reset), then the verify command.
Expected: the same three lines, still `1`. A second play answers 409 and is accepted.

- [ ] **Step 5: Commit**

```bash
git add scripts/dev-community.mjs && git commit -m "Seed a dev-account quiz that alice has played

Home's participation rows are plays on games the viewer owns, and the dev
account owned none. The quiz names its books by title and author because
dev-account.mjs writes the library raw and its works resolve only at boot.
A repeat play answers 409, which the seed accepts, so re-runs add nothing."
```

---

### Task 5: Synopses and genres for the multi-edition works

**Files:**
- Modify: `scripts/dev-editions.mjs`

**Interfaces:**
- Produces:
  - every edition of The Hobbit (`OL262758W`) and Dune (`OL893415W`) has a synopsis in its own language;
  - both works have catalog genres.
  - `mergeDetails` only fills an empty summary and `fillSourceGenres` only fills empty genres, so re-runs and later Open Library details leave both alone.

- [ ] **Step 1: Run the verification to see it fail**

Run the reset seed command, then the verify command.
Expected: neither line shows the synopsis or the genres below. Offline, both print `genres: []` and an empty edition summary. Online, the details backfill that every `buildApp()` starts may already have filled Open Library's genres and summary; that is fine, as long as they are not the ones below.

- [ ] **Step 2: Implement**

Replace `WORKS` with:

```js
const WORKS = [
  {
    workKey: "OL262758W",
    author: "J.R.R. Tolkien",
    genres: ["Fantasy", "Classics", "Children's"],
    editions: [
      { isbn: "9780261102217", title: "The Hobbit", languages: ["eng"], year: 1999, pages: 310, publisher: "HarperCollins", color: "#8a5a2b", summary: "Bilbo Baggins likes his armchair and his pantry. A wizard and thirteen dwarves talk him into a long walk east, with a dragon at the end of it and a ring he picks up on the way." },
      { isbn: "9788445077528", title: "El hobbit", languages: ["spa"], year: 2012, pages: 320, publisher: "Minotauro", color: "#b3361f", summary: "A Bilbo Bolsón le gustan su sillón y su despensa. Un mago y trece enanos lo convencen de emprender un largo viaje hacia el este, con un dragón al final del camino." },
      { isbn: "9788595084742", title: "O Hobbit", languages: ["por"], year: 2019, pages: 336, publisher: "HarperCollins Brasil", color: "#1f6f8b", summary: "Bilbo Bolseiro gosta da sua poltrona e da sua despensa. Um feiticeiro e treze anões convencem-no a partir numa longa viagem para leste, com um dragão no fim do caminho." },
      { isbn: "9780547928227", title: "The Hobbit", languages: ["eng"], year: 2012, pages: 300, publisher: "Mariner Books", color: "#3b7d3a", summary: "Bilbo Baggins likes his armchair and his pantry. A wizard and thirteen dwarves talk him into a long walk east, with a dragon at the end of it and a ring he picks up on the way." },
    ],
  },
  {
    workKey: "OL893415W",
    author: "Frank Herbert",
    genres: ["Science Fiction", "Classics"],
    editions: [
      { isbn: "9780441172719", title: "Dune", languages: ["eng"], year: 2005, pages: 535, publisher: "Ace", color: "#c98a2b", summary: "On the desert planet that is the only source of the spice, a young duke's son survives his family's betrayal and finds a place among the people of the sand." },
      { isbn: "9788576573135", title: "Duna", languages: ["por"], year: 2017, pages: 680, publisher: "Aleph", color: "#7a3b8c", summary: "No planeta deserto que é a única fonte da especiaria, o filho de um duque sobrevive à traição contra a sua família e encontra lugar entre o povo das areias." },
      { isbn: "9788497595063", title: "Dune", languages: ["spa"], year: 2011, pages: 592, publisher: "Debolsillo", color: "#2c4f9e", summary: "En el planeta desierto que es la única fuente de la especia, el hijo de un duque sobrevive a la traición contra su familia y encuentra un lugar entre el pueblo de la arena." },
    ],
  },
];
```

In the loop, change the `mergeDetails` call to pass the edition's summary:

```js
      repo.mergeDetails(book.id, { summary: edition.summary, pages: edition.pages, year: edition.year, publisher: edition.publisher, translator: null }, null);
```

After the inner `for (const edition of work.editions) { … }` loop closes, still inside `for (const work of WORKS)`, add:

```js
    const workId = repo.findBookByKey(`isbn:${work.editions[0].isbn}`)?.work_id;
    if (!workId) throw new Error(`No work for ${work.editions[0].title} (${work.editions[0].isbn}).`);
    repo.fillSourceGenres(workId, work.genres);
```

- [ ] **Step 3: Verify after a reset**

Run the reset seed command, then the verify command.
Expected:
- `9780547928227` prints genres with exactly `Fantasy`, `Classics` and `Children's`, in any order, an edition summary starting `Bilbo Baggins likes his armchair`, and `page has summary: true`.
- `9780441172719` prints genres with exactly `Science Fiction` and `Classics`, an edition summary starting `On the desert planet that is the only`, and `page has summary: true`.

- [ ] **Step 4: Verify the re-run path**

Run the re-seed command (no reset), then the verify command.
Expected: identical output. The page summary may come from Open Library once the details backfill has run online (a work page without a viewer prefers the work's own summary); the edition summary and the genres must not change.

- [ ] **Step 5: Commit**

```bash
git add scripts/dev-editions.mjs && git commit -m "Give the multi-edition works synopses and catalog genres

A work page takes its synopsis and genre chips from the catalog, which only
Open Library filled, online. Each edition gets a synopsis in its own language
so the language filter has something to choose between. mergeDetails and
fillSourceGenres only fill empty fields, so re-runs and later details keep
these."
```

---

### Task 6: Tests on the recorded shop responses

The fixtures are already committed under `backend/src/modules/books/seed/fixtures/`. They were recorded on 2026-10-16 and trimmed; see the spec.

| File | Source |
|---|---|
| `presenca-products.json` | `https://www.presenca.pt/products.json?limit=5&page=1` |
| `relogio-products.json` | `https://www.relogiodagua.pt/wp-json/wc/store/v1/products?per_page=5&page=1` |
| `pages/relogio-ovelhas-perdidas.html` | `https://www.relogiodagua.pt/produto/ovelhas-perdidas/` |
| `pages/gradiva-o-africano-ebook.html` | `https://www.gradiva.pt/produto/o-africano-ebook/` |
| `pages/guerraepaz-a-mulher-do-veu.html` | `https://www.guerraepaz.pt/produto/a-mulher-do-veu/` |
| `pages/penguinlivros-o-primeiro-leitor.html` | `https://penguinlivros.pt/loja/companhia-das-letras/livro/o-primeiro-leitor/` |

These tests pin behaviour the parser already has, on real markup, so they pass on first run. Step 2 is a mutation check that proves they can fail. Do not edit the fixtures to make a test pass. A failure on a recorded fixture is a parser finding: stop and report it.

**Files:**
- Test: `backend/src/modules/books/seed/publisherFeed.test.ts`
- Test: `backend/src/modules/books/seed/importPublisherCovers.test.ts`

**Interfaces:**
- Consumes: `pageAuthors`, `findPageIsbn`, `withPageText`, `parseShopifyProducts` and `parseWooProducts` from `publisherFeed.ts`. In the importer test it uses `harness`, `publisherBook`, `relogioLinks`, `WOO_FEED` and `importPublisherCovers`, all already defined in `importPublisherCovers.test.ts`.

- [ ] **Step 1: Write the tests**

Append to `backend/src/modules/books/seed/publisherFeed.test.ts`. It must go after `presenca` is declared, so at the end of the file:

```ts
const recordedPage = (name: string) => readFileSync(new URL(`./fixtures/pages/${name}.html`, import.meta.url), "utf8");
const blankDetails = { summary: null, pages: null, year: null, translator: null, originalTitle: null };

test("recorded product pages from the four author-link shops give the product's own author and ISBN", () => {
  const cases: Array<[string, string, string]> = [
    ["relogio-ovelhas-perdidas", "Madeline Cash", "9789897837838"],
    ["gradiva-o-africano-ebook", "J. M. Leo Clèzio", "9789897855269"],
    ["guerraepaz-a-mulher-do-veu", "Ana Paula Jardim", "9789895764952"],
    ["penguinlivros-o-primeiro-leitor", "Luiz Schwarcz", "9789895894369"]
  ];
  for (const [name, author, isbn] of cases) {
    const html = recordedPage(name);
    assert.equal(pageAuthors(html), author, name);
    assert.equal(findPageIsbn(html), isbn, name);
  }
});

test("recorded product pages give the page count and translator they show", () => {
  assert.deepEqual(withPageText(blankDetails, recordedPage("relogio-ovelhas-perdidas")), { ...blankDetails, pages: 280, translator: "Marta Mendonça" });
  assert.equal(withPageText(blankDetails, recordedPage("guerraepaz-a-mulher-do-veu")).pages, 120);
  assert.equal(withPageText(blankDetails, recordedPage("penguinlivros-o-primeiro-leitor")).pages, 296);
});

test("a recorded Presença feed takes every author from its tags and the ISBN from the SKU, and drops the product without an image", () => {
  const feed = JSON.parse(readFileSync(new URL("./fixtures/presenca-products.json", import.meta.url), "utf8"));
  assert.deepEqual(parseShopifyProducts(feed, presenca).map((book) => [book.isbn, book.rank, book.author]), [
    ["9789722380584", 0, "Natsu Hyuga"],
    ["9789722380577", 0, "Dan Leydon, Emily Stead, John Murray, Matt Oldfield, Seth Burkett"],
    ["9789722380560", 0, "Dan Leydon, Matt Oldfield"],
    ["9789722380553", 0, "G. T. Karber"]
  ]);
});

test("a recorded Relógio feed finds each ISBN in the image file name and no author", () => {
  const feed = JSON.parse(readFileSync(new URL("./fixtures/relogio-products.json", import.meta.url), "utf8"));
  assert.deepEqual(parseWooProducts(feed, relogio).map((book) => [book.isbn, book.rank, book.author]), [
    ["9789897837838", 1, null],
    ["9789897837920", 1, null],
    ["9789727084708", 1, null],
    ["9789897837890", 1, null],
    ["9789897837364", 1, null]
  ]);
});
```

Append to `backend/src/modules/books/seed/importPublisherCovers.test.ts`, at the end of the file:

```ts
const OVELHAS = "9789897837838";
const OVELHAS_URL = "https://www.relogiodagua.pt/produto/ovelhas-perdidas/";
const recordedRelogioFeeds = {
  [WOO_FEED]: { text: readFileSync(new URL("./fixtures/relogio-products.json", import.meta.url), "utf8") },
  [OVELHAS_URL]: { text: readFileSync(new URL("./fixtures/pages/relogio-ovelhas-perdidas.html", import.meta.url), "utf8") }
};

test("a recorded Relógio feed and product page fill a title-only book's author", async () => {
  const h = await harness({ feeds: recordedRelogioFeeds });
  const before = publisherBook(h.repo, OVELHAS, "Ovelhas Perdidas", "");

  await importPublisherCovers(h.deps, [relogioLinks], { dryRun: false });

  assert.equal(h.repo.getBook(before.id)!.author, "Madeline Cash");
  assert.equal(h.requests.filter((url) => url === OVELHAS_URL).length, 1);
});
```

- [ ] **Step 2: Run, then mutation-check**

Run: `npm test --workspace backend 2>&1 | rg '^ℹ (pass|fail)|^✖'`
Expected: `ℹ fail 0` and no `✖` lines.

Temporarily change `AUTHOR_PATH` in `backend/src/modules/books/seed/publisherFeed.ts` to `/\/autor\//`. Run the backend tests again.
Expected: FAIL in "recorded product pages from the four author-link shops…" for `penguinlivros-o-primeiro-leitor`, whose links use `/autores/`.

Revert with `git checkout backend/src/modules/books/seed/publisherFeed.ts`, then run again.
Expected: `ℹ fail 0` and no `✖` lines.

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/books/seed/publisherFeed.test.ts backend/src/modules/books/seed/importPublisherCovers.test.ts && git commit -m "Test the newest shop parsing on recorded responses

Page authors, Presença's author tags and the feed-ISBN-then-page-author path
were tested only on hand-written snippets. These run the parser and the
importer on the real responses recorded on 2026-10-16: a five-author
Presença product, a product with no image, Penguin's /autores/ links,
Gradiva's translator link and a related-product card after each product."
```

---

### Task 7: CI runs the three-user check; docs describe the fixture

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `mobile/README.md`
- Modify: `scripts/dev-emulator.mjs`
- Modify: `.claude/skills/emulator-verify/SKILL.md`

- [ ] **Step 1: Add the CI step**

In `.github/workflows/ci.yml`, directly after `- run: npm test --workspace backend`, add:

```yaml
      - run: npm run test:fixture --workspace backend
```

- [ ] **Step 2: Update the docs**

In `mobile/README.md`, replace the bullet that starts "- A dedicated local-only dev account" (it ends "…have real content to look at immediately. The Expo app auto-signs into this account on boot (dev builds only — see `src/core/devSession.ts`'s own comment; it never overwrites a real signed-in session).") with:

```markdown
- A dedicated local-only dev account (`scripta-dev@local.test` /
  `scripta_dev`, seeded by `scripts/dev-account.mjs`) carrying a 24-book
  fixture library (`scripts/fixtures/library.json`) — two series, two
  collections, mixed read statuses, ratings and read dates on finished
  books, genres on every book, four highlights, and both a book-level and a
  series-level style override. It reads as a settled classics reader, so
  the shelf preset offers the reader card, a passage and Favourites. The
  Expo app auto-signs into this account on boot (dev builds only — see
  `src/core/devSession.ts`'s own comment; it never overwrites a real
  signed-in session).
```

After the bullet that starts "- The three-user fixture", add:

```markdown
- Every boot also runs `scripts/dev-editions.mjs` (The Hobbit and Dune
  with several editions, synopses and genres) and `scripts/dev-community.mjs`
  (published profiles, follows, alice's finished book, and a dev-account
  quiz that alice has played).

`library.json` and the three-user fixture reach an existing
`backend/data/dev/` only with `--reset`; the editions and community seeds
reach it on the next boot. Feed and participation rows leave Home 30 days
after they were seeded — `--reset` brings them back.
```

In `scripts/dev-emulator.mjs`, in the header comment's step 4, replace:

```js
//   4. Seed the dev account + fixture library (scripts/dev-account.mjs,
//      writing into backend/data/dev/), then seed the three fixture
//      users (fixture_alice/bob/charlie, backend/scripts/three-users.mjs
//      --seed-only --shared) into that SAME directory — one database,
//      four logins.
```

with:

```js
//   4. Seed the dev account + fixture library (scripts/dev-account.mjs,
//      writing into backend/data/dev/), the multi-edition works
//      (scripts/dev-editions.mjs), the three fixture users
//      (fixture_alice/bob/charlie, backend/scripts/three-users.mjs
//      --seed-only --shared) and the follows and quiz between them
//      (scripts/dev-community.mjs) into that SAME directory — one
//      database, four logins.
```

In `.claude/skills/emulator-verify/SKILL.md`, replace:

```markdown
seeds the signed-in dev account (`scripta-dev@local.test`, 24-book fixture, three fixture users)
```

with:

```markdown
seeds the signed-in dev account (`scripta-dev@local.test`, 24-book fixture with ratings, genres and highlights, three fixture users, follows, quizzes, multi-edition works)
```

and replace:

```markdown
Add `--reset` only when the pass needs clean fixture data.
```

with:

```markdown
Add `--reset` only when the pass needs clean fixture data, or when `scripts/fixtures/library.json` or `backend/scripts/three-users.mjs` changed since this worktree's data was seeded.
```

- [ ] **Step 3: Run the gate**

Run: `env -i PATH="$PATH" HOME="$HOME" npm run test:fixture --workspace backend 2>&1 | rg 'Three-user fixture checks passed'`
Expected: the "Three-user fixture checks passed" line.

Run: `node scripts/gate.mjs`
Expected: every command it runs passes.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml mobile/README.md scripts/dev-emulator.mjs .claude/skills/emulator-verify/SKILL.md && git commit -m "Run the three-user fixture check in CI and describe the fixture

test:fixture covers privacy, ownership and ballots across the fixture users
but never ran in CI, so a change to the seeds could break it unseen. It runs
offline-tolerant (cover lookups are best-effort) in about 30 seconds."
```

---

### Task 8: The Codex review reports its configured model

`codex exec --json` never emits a `model` field (see `scripts/fixtures/codex-exec.jsonl`), so every report says "Model: unknown". Codex takes its model from `$CODEX_HOME/config.toml`, defaulting to `~/.codex/config.toml`.

**Files:**
- Modify: `scripts/codexReview.mjs`
- Modify: `scripts/codex-review.mjs`
- Test: `scripts/codexReview.test.mjs`

**Interfaces:**
- Produces: `configuredModel(toml: string): string | null`. It returns the top-level `model` value, or `null` when the file sets none or sets it only inside a `[section]`.

- [ ] **Step 1: Write the failing tests**

In `scripts/codexReview.test.mjs`, add `configuredModel` to the import from `./codexReview.mjs`. Replace the test "codexUsage reads the recorded Codex run" with:

```js
test("codexUsage reads the recorded Codex run, which names no model", () => {
  const usage = codexUsage(readFileSync(new URL("./fixtures/codex-exec.jsonl", import.meta.url), "utf8"));
  assert.ok(usage.tokens.input > 0);
  assert.ok(usage.tokens.output > 0);
  assert.equal(usage.model, null);
});

test("configuredModel reads the top-level model from Codex's config", () => {
  assert.equal(configuredModel('model = "gpt-6.1-sol"\nmodel_reasoning_effort = "xhigh"\n\n[profiles.fast]\nmodel = "gpt-6.1-mini"\n'), "gpt-6.1-sol");
  assert.equal(configuredModel('model_reasoning_effort = "xhigh"\n[profiles.fast]\nmodel = "gpt-6.1-mini"\n'), null);
  assert.equal(configuredModel(""), null);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm run test:scripts 2>&1 | rg '^ℹ (pass|fail)|^✖'`
Expected: FAIL. `configuredModel` is not exported.

- [ ] **Step 3: Implement**

In `scripts/codexReview.mjs`, after `codexUsage`, add:

```js
export function configuredModel(toml) {
  const topLevel = toml.split(/^\s*\[/m)[0];
  return /^\s*model\s*=\s*"([^"]+)"/m.exec(topLevel)?.[1] ?? null;
}
```

In `scripts/codex-review.mjs`:
- add `import { homedir } from "node:os";` with the other `node:` imports;
- add `configuredModel,` to the import list from `./codexReview.mjs`;
- after the `TIMEOUT_MS` line, add:

```js
function codexConfig() {
  try {
    return readFileSync(join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "config.toml"), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}
```

and replace `const usage = codexUsage(jsonl);` with:

```js
  const streamed = codexUsage(jsonl);
  const usage = { ...streamed, model: streamed.model ?? configuredModel(codexConfig()) };
```

- [ ] **Step 4: Run the tests**

Run: `npm run test:scripts 2>&1 | rg '^ℹ (pass|fail)|^✖'`
Expected: `ℹ fail 0` and no `✖` lines.

Run: `node -e 'const fs = require("node:fs"), os = require("node:os"); import("./scripts/codexReview.mjs").then((m) => console.log(m.configuredModel(fs.readFileSync(os.homedir() + "/.codex/config.toml", "utf8"))))'`
Expected: the model in the user's own Codex config (`gpt-6.1-sol` on 2026-10-16).

- [ ] **Step 5: Commit**

```bash
git add scripts/codexReview.mjs scripts/codex-review.mjs scripts/codexReview.test.mjs && git commit -m "Report the Codex model from Codex's own config

codex exec --json never names its model (the recorded run has no model
field), so every report said 'Model: unknown' and rounds.jsonl logged null.
The stream still wins if a later Codex version starts sending it. Only a
missing config file reads as no model; any other read error propagates."
```

---

## Branch acceptance (main session, after Task 8)

1. Run `node scripts/dev-status.mjs --json` once.
   - If another worktree holds the emulator, skip the device pass and report it as skipped. The API checks in Tasks 4 and 5 stand as acceptance.
   - Otherwise run `node scripts/dev-emulator.mjs --reset` and dispatch `device-checker`. Give it the worktree path, a screenshot directory, and these screens with what correct looks like:
     - **Profile → Murals → new mural → "My shelf" preset:** it offers a reader card block, a quote block and a Favourites shelf.
     - **The Return of the King's book screen:** a community rating tile from 3 ratings.
     - **Home:** the "Guess the classic" participation row and fixture_alice's quiz publication.
     - **The Hobbit's book screen:** a synopsis and genre chips.
2. Run `branch-reviewer` with the spec and this plan. In parallel and in the background, run `node scripts/codex-review.mjs branch docs/superpowers/specs/2026-10-16-fixture-refresh-design.md docs/superpowers/plans/2026-10-16-fixture-refresh.md`. The report should now name the model.
