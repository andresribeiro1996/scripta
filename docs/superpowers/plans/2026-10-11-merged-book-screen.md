# Merged Book Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "Book details" sheet and the separate work page with one book screen at `/work/:id` (web and mobile): hero with genres and an Open Library meta line, status/feeling menus, About · Highlights · Community tabs, rare tools behind ⋯.

**Architecture:** The backend adds `genres`, `rating`, `year`, `pages` to `WorkPage.work`. A pure `bookScreenModel` in `@scripta/shared` decides controls, tabs, menu items and labels for every viewer; web and mobile each render it. The owner's book still comes from the library document via `mine.bookKey`. `/book/<key>` survives as a redirect to `/work/<id>`, or a library-only fallback when the book has no work yet.

**Tech Stack:** Fastify + node:sqlite backend, `@scripta/shared` (TS, node:test), React + Vite + Tailwind web, Expo Router + React Native mobile.

**Spec:** `docs/superpowers/specs/2026-10-11-merged-book-screen-design.md`

## Global Constraints

- No code comments (repo rule); the why goes in commit messages.
- Reuse `@scripta/shared` helpers: `normalizeBookGenres`, `validBookRating`, `statusLabel`, `FINISH_FEELINGS`, `summaryPreview`, `editionLabel`, `readerCountsLabel`, `readerStatusLabel`, `gameOwnerLabel`, `genresForBook`.
- Status menu labels are `statusLabel(0|1|2)`: "To read", "Reading", "Finished". Unset feeling reads "How did it land?".
- Genres: max 3. Editions preview: first 3, then "Show all N".
- Missing data is omitted, never shown as a placeholder.
- No swipe between tabs; mobile tab switch is `Segmented` inside the page's single `ScrollView`.
- Mobile menus use the native `Menu` component with an `IconButton`/plain trigger exactly as `TierlistEditorScreen.tsx:146` does.
- `BookSummary`, `FeelingChips`, `FinishSheet`, `PerCardStylePanel`, `CoverPickerModal` stay; only their call sites move.
- Run git from the worktree root; stage and commit in one command (other sessions share the index).
- Backend tests need the env preamble the existing test files already set; run them through `npm test` in `backend/` or `npx tsx --test <file>` from `backend/`.
- After `packages/shared` changes, run `npm run build` in `packages/shared/` before typechecking `frontend/` or `mobile/` (they import `dist/`).

## Review Focus

1. A book in the library whose work id is not resolved yet (`library.works[key]` missing) must still open, with controls and Highlights, on both clients — test in Task 2 (`unresolved` row) and Task 7 device pass.
2. A work whose editions have no details at all (`genres: []`, no rating, no year/pages) shows no chips and no meta line, not "★ NaN" or an empty line — tests in Task 1 and Task 2.
3. Signed-out viewer on the public `/work/:id` (web and mobile `(public)` group) must not fire the library request or show owner controls — `useLibrary({ enabled })` in Tasks 4 and 6; model row in Task 2.
4. Picking the already-current status or feeling is a no-op (no save, no finish flow) — screens guard with `selected`; Task 2 asserts `selected` flags.
5. Opening the screen from the Arena tab on mobile reaches Card style / Cover / Finished in the Arena stack, not by jumping tabs — route move in Task 7.

---

## File structure

| File | Responsibility |
|---|---|
| `backend/src/modules/books/domain/types.ts` | `WorkPageRows.editions` gains `genres`, `rating`, `rating_count`, `pages` |
| `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts` | `pageEditionsStmt` selects them |
| `backend/src/modules/books/works.ts` | `CatalogWorkPage.editions` gains parsed `genres`, `rating`, `ratingCount`, `pages` |
| `backend/src/modules/works/service.ts` | derives `work.genres/rating/year/pages` |
| `packages/shared/src/works/types.ts` | `WorkPage.work` new fields |
| `packages/shared/src/works/bookScreen.ts` (new) | `bookScreenModel`, `bookMetaLine`, `bookHighlights` |
| `frontend/src/hooks/useBookActions.ts` (new) | the library book mutations now inline in `LibraryPage` |
| `frontend/src/components/OptionsMenu.tsx` | optional `trigger` content |
| `frontend/src/components/book/BookScreen.tsx` (new) | web merged screen |
| `frontend/src/pages/WorkPage.tsx`, `frontend/src/pages/BookKeyPage.tsx` (new) | data loading + routing for the screen |
| `mobile/src/features/works/BookScreen.tsx` (new) | mobile merged screen |
| `mobile/src/features/works/WorkScreen.tsx` | becomes the fetch/redirect wrapper around `BookScreen` |
| `mobile/src/app/(app)/(home,arena,library)/book/[key]/*` | moved from `(home,library)`; `index.tsx` becomes redirect/fallback |

Deleted by the end: `frontend/src/components/BookDetailSheet.tsx`, `frontend/src/components/work/WorkPageView.tsx`, `mobile/src/features/library/components/BookDetail.tsx`, `mobile/src/features/works/workScreenModel.ts` and its test.

---

### Task 1: Work page carries genres, rating, year, pages

**Files:**
- Modify: `backend/src/modules/books/domain/types.ts:69-73`
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts:88`
- Modify: `backend/src/modules/books/works.ts:30-56`
- Modify: `backend/src/modules/works/service.ts`
- Modify: `packages/shared/src/works/types.ts`
- Test: `backend/src/modules/books/works.test.ts`, `backend/src/modules/works/service.test.ts`

**Interfaces:**
- Produces: `WorkPage["work"]` = `{ id; title; author; summary; coverUrl; editions; genres: string[]; rating: { value: number; count: number } | null; year: number | null; pages: number | null }`.
- Produces: `CatalogWorkPage["editions"][number]` gains `genres: string[]; rating: number | null; ratingCount: number; pages: number | null`.

- [ ] **Step 1: Failing repository/catalog test** — append to `backend/src/modules/books/works.test.ts`:

```ts
test("a work page edition carries normalised genres, rating and pages", () => {
  const { db, repo } = freshRepo();
  const [work] = resolveWorksWith(repo, [{ isbn: "9780441013593", title: "Dune", author: "Frank Herbert" }]);
  db.prepare("UPDATE books SET genres = ?, rating = 4.25, rating_count = 120, pages = 412 WHERE work_id = ?").run(JSON.stringify(["Science Fiction", "Space opera"]), work!);
  const [edition] = getWorkPageWith(repo, () => "x", work!)!.editions;
  assert.deepEqual(edition!.genres, ["Science Fiction"]);
  assert.equal(edition!.rating, 4.25);
  assert.equal(edition!.ratingCount, 120);
  assert.equal(edition!.pages, 412);
});
```

(`normalizeBookGenres(["Science Fiction", "Space opera"])` returns `["Science Fiction"]`.)

- [ ] **Step 2: Run it, expect FAIL** — `cd backend && npx tsx --test src/modules/books/works.test.ts` → fails on `edition.genres` undefined.

- [ ] **Step 3: Implement**

`domain/types.ts`:
```ts
export type WorkPageRows = {
  work: { id: string; title: string; author: string; summary: string | null };
  aliasIds: string[];
  editions: Array<{ id: string; title: string; language: string | null; year: number | null; isbn: string | null; summary: string | null; cover_image_id: string | null; genres: string; rating: number | null; rating_count: number; pages: number | null }>;
};
```

`sqliteBooksRepository.ts:88`:
```ts
const pageEditionsStmt = db.prepare(`SELECT id, title, language, year, isbn, summary, cover_image_id, genres, rating, rating_count, pages FROM books WHERE work_id = ? ORDER BY created_at, rowid`);
```

`works.ts` — import `normalizeBookGenres` from `@scripta/shared`, extend the type and the mapping:
```ts
editions: Array<{ bookId: string; title: string; language: string | null; year: number | null; isbn: string | null; summary: string | null; coverUrl: string | null; genres: string[]; rating: number | null; ratingCount: number; pages: number | null }>;
```
```ts
      coverUrl: edition.cover_image_id ? coverUrl(edition.cover_image_id) : null,
      genres: normalizeBookGenres(JSON.parse(edition.genres)),
      rating: edition.rating,
      ratingCount: edition.rating_count,
      pages: edition.pages
```

- [ ] **Step 4: Run, expect PASS** — same command.

- [ ] **Step 5: Failing service tests** — in `backend/src/modules/works/service.test.ts`, first add `genres: [], rating: null, ratingCount: 0, pages: null` to every edition literal in `deps()` and `pageWith()` (the type now requires them). Then append:

```ts
type Edition = NonNullable<ReturnType<WorksDeps["getWorkPage"]>>["editions"][number];
const edition = (bookId: string, isbn: string | null, extra: Partial<Edition>): Edition => ({
  bookId, title: "Dune", language: "en", year: null, isbn, summary: null, coverUrl: null, genres: [], rating: null, ratingCount: 0, pages: null, ...extra
});
const pageOf = (editions: Edition[]): WorksDeps["getWorkPage"] => () => ({ id: "w", title: "Dune", author: "Frank Herbert", summary: null, aliasIds: ["w"], editions });

test("genres: most editions first, capped at three", () => {
  const getWorkPage = pageOf([
    edition("e1", null, { genres: ["Fantasy", "Classics"] }),
    edition("e2", null, { genres: ["Classics", "Horror", "Romance"] }),
    edition("e3", null, { genres: ["Classics", "Horror"] })
  ]);
  assert.deepEqual(createWorksService(deps({ getWorkPage })).getPage("w", null)!.work.genres, ["Classics", "Horror", "Fantasy"]);
});

test("rating comes from the edition with the most ratings, ignoring invalid ones", () => {
  const getWorkPage = pageOf([
    edition("e1", null, { rating: 4.5, ratingCount: 10 }),
    edition("e2", null, { rating: 3.9, ratingCount: 300 }),
    edition("e3", null, { rating: 7, ratingCount: 900 })
  ]);
  assert.deepEqual(createWorksService(deps({ getWorkPage })).getPage("w", null)!.work.rating, { value: 3.9, count: 300 });
});

test("year is the earliest edition's; pages prefer the viewer's edition", () => {
  const getWorkPage = pageOf([
    edition("e1", "9788576573135", { year: 2017, pages: 680 }),
    edition("e2", "9780441013593", { year: 1965, pages: 412 })
  ]);
  const signedIn = createWorksService(deps({ getWorkPage })).getPage("w", "viewer")!.work;
  const signedOut = createWorksService(deps({ getWorkPage })).getPage("w", null)!.work;
  assert.equal(signedIn.year, 1965);
  assert.equal(signedIn.pages, 412);
  assert.equal(signedOut.pages, 680);
});

test("editions without details give no genres, rating, year or pages", () => {
  const work = createWorksService(deps({ getWorkPage: pageOf([edition("e1", null, {})]) })).getPage("w", null)!.work;
  assert.deepEqual([work.genres, work.rating, work.year, work.pages], [[], null, null, null]);
});
```

(The `viewer` copy in `deps()` has ISBN `978-0441013593`, which matches `e2` after `isbnKey`.) All four genre names are members of `BOOK_GENRES`.

- [ ] **Step 6: Run, expect FAIL** — `cd backend && npx tsx --test src/modules/works/service.test.ts`.

- [ ] **Step 7: Implement** — `packages/shared/src/works/types.ts`:
```ts
export type WorkRating = { value: number; count: number };

export type WorkPage = {
  work: { id: string; title: string; author: string; summary: string | null; coverUrl: string | null; editions: WorkEdition[]; genres: string[]; rating: WorkRating | null; year: number | null; pages: number | null };
  ...rest unchanged
};
```

`backend/src/modules/works/service.ts` — add `validBookRating` to the shared import, then above `createWorksService`:
```ts
const GENRE_CAP = 3;
type CatalogEdition = CatalogWorkPage["editions"][number];

function topGenres(editions: CatalogEdition[]): string[] {
  const counts = new Map<string, number>();
  for (const edition of editions) for (const genre of edition.genres) counts.set(genre, (counts.get(genre) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, GENRE_CAP).map(([genre]) => genre);
}

function bestRating(editions: CatalogEdition[]): WorkPage["work"]["rating"] {
  let best: WorkPage["work"]["rating"] = null;
  for (const edition of editions) {
    const value = validBookRating(edition.rating);
    if (value !== null && edition.ratingCount > 0 && (!best || edition.ratingCount > best.count)) best = { value, count: edition.ratingCount };
  }
  return best;
}

function earliestYear(editions: CatalogEdition[]): number | null {
  const years = editions.flatMap((edition) => (edition.year === null ? [] : [edition.year]));
  return years.length > 0 ? Math.min(...years) : null;
}
```
and in `getPage`'s returned `work`:
```ts
          genres: topGenres(work.editions),
          rating: bestRating(work.editions),
          year: earliestYear(work.editions),
          pages: mineEdition?.pages ?? work.editions.find((edition) => edition.pages !== null)?.pages ?? null,
```

- [ ] **Step 8: Run, expect PASS** — `cd packages/shared && npm run build && npm test`, then `cd backend && npm run typecheck && npm test`. Fix any other backend fixture that builds a `CatalogWorkPage` or `WorkPage` literal (search `rg -n "editions: \[" backend/src`).

- [ ] **Step 9: Commit**
```bash
git add backend/src/modules/books packages/shared/src/works/types.ts backend/src/modules/works && git commit -m "Give the work page genres, rating, year and pages from its editions" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Shared book screen model

**Files:**
- Create: `packages/shared/src/works/bookScreen.ts`
- Create: `packages/shared/src/works/bookScreen.test.ts`
- Modify: `packages/shared/src/works/index.ts`

**Interfaces:**
- Consumes: `WorkPage` (Task 1).
- Produces:
```ts
export type BookScreenTabKey = "about" | "highlights" | "community";
export type BookScreenMenuKey = "style" | "cover" | "rejectCover" | "replaceCover";
export type BookScreenReaderRow = { username: string; avatarUrl: string | null; readerGlyph?: IdentityKey; status: string; linksToProfile: boolean };
export type BookScreenModel = {
  title: string; author: string; genres: string[]; meta: string | null;
  primary: "owner" | "add";
  status: { label: string; options: Array<{ value: 0 | 1 | 2; label: string; selected: boolean }> } | null;
  feeling: { label: string; options: Array<{ rating: FinishRating; label: string; selected: boolean }> } | null;
  tabs: Array<{ key: BookScreenTabKey; label: string }>;
  menu: BookScreenMenuKey[];
  about: { summary: string | null; preview: string | null; editions: WorkEdition[]; editionsPreview: WorkEdition[] } | null;
  highlights: Array<Record<string, unknown>>;
  community: { countsLabel: string; groups: Array<{ key: string; title: string | null; rows: BookScreenReaderRow[] }>; games: Array<{ key: string; title: string; detail: string; path: string }> } | null;
};
export function bookScreenModel(page: WorkPage | null, book: Record<string, unknown> | null, viewer: { isAdmin: boolean }): BookScreenModel;
export function bookMetaLine(work: Pick<WorkPage["work"], "rating" | "year" | "pages">): string | null;
```
`page === null` means the unresolved `/book/<key>` fallback; `book === null` means not owned (or signed out).

- [ ] **Step 1: Write the failing tests** — `bookScreen.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { bookMetaLine, bookScreenModel } from "./bookScreen.js";
import type { WorkPage } from "./types.js";

const edition = (n: number) => ({ bookId: `e${n}`, title: "Dune", language: "en", year: 1965 + n, isbn: null, mine: n === 1 });
function page(overrides: Partial<WorkPage["work"]> = {}): WorkPage {
  return {
    work: { id: "w", title: "Dune", author: "Frank Herbert", summary: "Spice.", coverUrl: null, editions: [1, 2, 3, 4, 5].map(edition), genres: ["Science Fiction"], rating: { value: 4.27, count: 2310 }, year: 1965, pages: 412, ...overrides },
    mine: null,
    readers: { followed: [{ username: "ana", avatarUrl: null, readStatus: 2, published: false }], others: [{ username: "bo", avatarUrl: null, readStatus: 1, published: true }], counts: { readers: 2, finished: 1 } },
    games: { tierlists: [{ id: "t", name: "Best SF", owner: "app", path: "/vote/abc" }], arenas: [], quizzes: [] }
  };
}
const owned = (extra: Record<string, unknown> = {}) => ({ Title: "Dune (mine)", Attribution: "F. Herbert", ReadStatus: 1, highlights: [{ BookmarkID: "h1", Text: "Fear is the mind-killer." }, { BookmarkID: "h2", Text: "  " }], ...extra });
const keys = (model: ReturnType<typeof bookScreenModel>) => model.tabs.map((tab) => tab.key);

test("owner: status control, three tabs, style and cover in the menu", () => {
  const model = bookScreenModel(page(), owned(), { isAdmin: false });
  assert.equal(model.primary, "owner");
  assert.deepEqual(keys(model), ["about", "highlights", "community"]);
  assert.deepEqual(model.tabs.map((tab) => tab.label), ["About", "Highlights (1)", "Community (2)"]);
  assert.deepEqual(model.menu, ["style", "cover"]);
  assert.equal(model.status!.label, "Reading");
  assert.deepEqual(model.status!.options.map((o) => [o.label, o.selected]), [["To read", false], ["Reading", true], ["Finished", false]]);
  assert.equal(model.feeling, null);
  assert.equal(model.highlights.length, 1);
});

test("finished owner gets a feeling control, unset reads as a question", () => {
  const unset = bookScreenModel(page(), owned({ ReadStatus: 2 }), { isAdmin: false });
  assert.equal(unset.feeling!.label, "How did it land?");
  assert.ok(unset.feeling!.options.every((o) => !o.selected));
  const loved = bookScreenModel(page(), owned({ ReadStatus: 2, Rating: 4 }), { isAdmin: false });
  assert.equal(loved.feeling!.label, "Loved it");
  assert.deepEqual(loved.feeling!.options.filter((o) => o.selected).map((o) => o.rating), [4]);
});

test("not owned: add to library, no highlights tab, no menu", () => {
  const model = bookScreenModel(page(), null, { isAdmin: false });
  assert.equal(model.primary, "add");
  assert.equal(model.status, null);
  assert.deepEqual(keys(model), ["about", "community"]);
  assert.deepEqual(model.menu, []);
});

test("admins get the cover moderation items whether or not they own the book", () => {
  assert.deepEqual(bookScreenModel(page(), null, { isAdmin: true }).menu, ["rejectCover", "replaceCover"]);
  assert.deepEqual(bookScreenModel(page(), owned(), { isAdmin: true }).menu, ["style", "cover", "rejectCover", "replaceCover"]);
});

test("unresolved: hero from the library book, highlights only, no about or community", () => {
  const model = bookScreenModel(null, owned({ _genres: ["Science Fiction"] }), { isAdmin: false });
  assert.equal(model.title, "Dune (mine)");
  assert.equal(model.author, "F. Herbert");
  assert.equal(model.meta, null);
  assert.deepEqual(keys(model), ["highlights"]);
  assert.equal(model.about, null);
  assert.equal(model.community, null);
  assert.equal(model.primary, "owner");
});

test("hero and about come from the work when there is one", () => {
  const model = bookScreenModel(page(), owned(), { isAdmin: false });
  assert.equal(model.title, "Dune");
  assert.deepEqual(model.genres, ["Science Fiction"]);
  assert.deepEqual(model.about!.editionsPreview.map((e) => e.bookId), ["e1", "e2", "e3"]);
  assert.equal(model.about!.editions.length, 5);
  assert.equal(model.about!.preview, null);
});

test("community lists followed then others and the games", () => {
  const { community } = bookScreenModel(page(), null, { isAdmin: false });
  assert.equal(community!.countsLabel, "2 readers · 1 finished");
  assert.deepEqual(community!.groups.map((g) => [g.title, g.rows.map((r) => r.username)]), [["People you follow", ["ana"]], ["Other readers", ["bo"]]]);
  assert.deepEqual(community!.games.map((g) => [g.title, g.detail, g.path]), [["Best SF", "Tier list · Scripta", "/vote/abc"]]);
});

test("meta line drops what is missing and disappears when nothing is known", () => {
  assert.equal(bookMetaLine({ rating: { value: 4.27, count: 2310 }, year: 1965, pages: 412 }), "★ 4.3 · 2.3K ratings · 1965 · 412 pages");
  assert.equal(bookMetaLine({ rating: { value: 5, count: 1 }, year: null, pages: null }), "★ 5.0 · 1 rating");
  assert.equal(bookMetaLine({ rating: null, year: null, pages: 90 }), "90 pages");
  assert.equal(bookMetaLine({ rating: null, year: null, pages: null }), null);
});
```

- [ ] **Step 2: Run, expect FAIL** — `cd packages/shared && node --import tsx --test src/works/bookScreen.test.ts` → module not found.

- [ ] **Step 3: Implement** — `bookScreen.ts`. The reader/game rows are moved verbatim from `mobile/src/features/works/workScreenModel.ts` (`readerRow`, `readerGroups`, the `kinds` game rows):

```ts
import { genresForBook } from "../library/bookGenres.js";
import { statusLabel } from "../library/covers.js";
import { FINISH_FEELINGS, type FinishRating } from "../library/finish.js";
import type { IdentityKey } from "../readerCards/index.js";
import { gameOwnerLabel, readerCountsLabel, readerStatusLabel, summaryPreview } from "./labels.js";
import type { WorkEdition, WorkGameRef, WorkPage, WorkReader } from "./types.js";

type Book = Record<string, unknown>;
export type BookScreenTabKey = "about" | "highlights" | "community";
export type BookScreenMenuKey = "style" | "cover" | "rejectCover" | "replaceCover";
export type BookScreenReaderRow = { username: string; avatarUrl: string | null; readerGlyph?: IdentityKey; status: string; linksToProfile: boolean };

const GENRE_CAP = 3;
const EDITIONS_PREVIEW = 3;
const STATUSES = [0, 1, 2] as const;
const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

export function bookMetaLine(work: Pick<WorkPage["work"], "rating" | "year" | "pages">): string | null {
  const parts = [
    work.rating ? `★ ${work.rating.value.toFixed(1)} · ${compact.format(work.rating.count)} ${work.rating.count === 1 ? "rating" : "ratings"}` : null,
    work.year === null ? null : String(work.year),
    work.pages === null ? null : `${work.pages} pages`
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}

const readerRow = (reader: WorkReader): BookScreenReaderRow => ({ username: reader.username, avatarUrl: reader.avatarUrl, readerGlyph: reader.readerGlyph, status: readerStatusLabel(reader.readStatus), linksToProfile: reader.published });

function readerGroups({ followed, others }: WorkPage["readers"]) {
  const groups = [
    { key: "followed", heading: "People you follow", rows: followed.map(readerRow) },
    { key: "others", heading: "Other readers", rows: others.map(readerRow) }
  ].filter((group) => group.rows.length > 0);
  return groups.map(({ key, heading, rows }) => ({ key, title: groups.length > 1 ? heading : null, rows }));
}

function gameRows(games: WorkPage["games"]) {
  const kinds: Array<[string, string, WorkGameRef[]]> = [["tierlist", "Tier list", games.tierlists], ["arena", "Tournament", games.arenas], ["quiz", "Quiz", games.quizzes]];
  return kinds.flatMap(([key, label, list]) => list.map((game) => ({ key: `${key}-${game.id}`, title: game.name, detail: `${label} · ${gameOwnerLabel(game.owner)}`, path: game.path })));
}

const withCount = (label: string, count: number) => (count > 0 ? `${label} (${count})` : label);

export function bookScreenModel(page: WorkPage | null, book: Book | null, viewer: { isAdmin: boolean }) {
  const highlights = Array.isArray(book?.highlights) ? (book.highlights as Book[]).filter((h) => String(h.Text ?? "").trim() !== "") : [];
  const readStatus = book ? (book.ReadStatus === 1 || book.ReadStatus === 2 ? book.ReadStatus : 0) : null;
  const rating = typeof book?.Rating === "number" ? book.Rating : null;
  const work = page?.work;
  const tabs: Array<{ key: BookScreenTabKey; label: string }> = [
    ...(page ? [{ key: "about" as const, label: "About" }] : []),
    ...(book ? [{ key: "highlights" as const, label: withCount("Highlights", highlights.length) }] : []),
    ...(page ? [{ key: "community" as const, label: withCount("Community", page.readers.counts.readers) }] : [])
  ];
  const menu: BookScreenMenuKey[] = [...(book ? (["style", "cover"] as const) : []), ...(viewer.isAdmin ? (["rejectCover", "replaceCover"] as const) : [])];
  return {
    title: work?.title ?? String(book?.Title ?? "Untitled"),
    author: work?.author ?? String(book?.Attribution ?? "Unknown author"),
    genres: work ? work.genres : book ? genresForBook(book).slice(0, GENRE_CAP) : [],
    meta: work ? bookMetaLine(work) : null,
    primary: book ? ("owner" as const) : ("add" as const),
    status: readStatus === null ? null : { label: statusLabel(readStatus), options: STATUSES.map((value) => ({ value, label: statusLabel(value), selected: value === readStatus })) },
    feeling: readStatus === 2 ? {
      label: FINISH_FEELINGS.find((feeling) => feeling.rating === rating)?.label ?? "How did it land?",
      options: FINISH_FEELINGS.map((feeling) => ({ rating: feeling.rating as FinishRating, label: feeling.label as string, selected: feeling.rating === rating }))
    } : null,
    tabs,
    menu,
    about: work ? { summary: work.summary, preview: work.summary ? summaryPreview(work.summary) : null, editions: work.editions, editionsPreview: work.editions.slice(0, EDITIONS_PREVIEW) } : null,
    highlights,
    community: page ? { countsLabel: readerCountsLabel(page.readers.counts), groups: readerGroups(page.readers), games: gameRows(page.games) } : null
  };
}

export type BookScreenModel = ReturnType<typeof bookScreenModel>;
export type { WorkEdition };
```

Drop the trailing `export type { WorkEdition }` if `index.ts` already re-exports it from `types.js` (it does — remove it). Add `export * from "./bookScreen.js";` to `packages/shared/src/works/index.ts`. If `genresForBook`/`statusLabel`/`FINISH_FEELINGS` are reachable from `../library/index.js` instead of the file paths above, import from wherever `labels.ts`-style siblings already import library code (`rg -n "from \"../library" packages/shared/src/works`).

- [ ] **Step 4: Run, expect PASS** — `cd packages/shared && node --import tsx --test src/works/bookScreen.test.ts && npm run typecheck && npm test && npm run build`.

- [ ] **Step 5: Commit**
```bash
git add packages/shared/src/works && git commit -m "Add the shared book screen model" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Web library book actions as a hook

Pure refactor: `LibraryPage` behaves exactly as before.

**Files:**
- Create: `frontend/src/hooks/useBookActions.ts`
- Modify: `frontend/src/pages/LibraryPage.tsx:195-313`
- Modify: `frontend/src/hooks/useLibrary.ts`

**Interfaces:**
- Produces:
```ts
export function useBookActions(): {
  saveStyle(book: Book, style: PerCardStyle | undefined): Promise<void>;
  setStatus(book: Book, status: ReadStatus): Promise<boolean>;
  setRating(book: Book, rating: FinishRating): Promise<boolean>;
  addNote(book: Book, text: string): Promise<boolean>;
  deleteNote(book: Book, bookmarkId: string): Promise<boolean>;
  restoreRead(book: Book, before: ReadSnapshot): Promise<boolean>;
  saveCover(book: Book, image: GalleryImage): Promise<void>;
  removeCover(book: Book): Promise<void>;
};
export function useLibrary(options?: { enabled?: boolean }): ...;
```

- [ ] **Step 1: Move** `handleSaveBookStyle`, `handleSetBookStatus`, `handleSetRating`, `handleAddNote`, `handleDeleteNote`, `handleRestoreRead`, `handleSaveBookCover`, `handleRemoveBookCover` (LibraryPage.tsx:195-313) verbatim into `useBookActions.ts` as inner functions of the hook, renamed to the names above, using `useQueryClient`, `useLibrary().updateLibrary`, `useLibrarySaver`, `useToast` exactly as `LibraryPage` obtains them. Carry over the imports they need from `LibraryPage`'s import list. Return the eight functions.

- [ ] **Step 2: Rewire LibraryPage** — `const bookActions = useBookActions();` and replace every `handleX(` call with `bookActions.<name>(`. Remove imports `LibraryPage` no longer uses (oxlint will list them).

- [ ] **Step 3: `useLibrary` enabled option** — `export function useLibrary({ enabled = true }: { enabled?: boolean } = {})` and pass `enabled` to `useQuery`.

- [ ] **Step 4: Verify** — `cd frontend && npm run typecheck && npm run lint && npm test`. All pass, no behaviour change.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/hooks/useBookActions.ts frontend/src/hooks/useLibrary.ts frontend/src/pages/LibraryPage.tsx && git commit -m "Move library book actions into useBookActions" -m "The merged book screen needs the same mutations outside LibraryPage." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Web merged book screen

**Files:**
- Create: `frontend/src/components/book/BookScreen.tsx`
- Create: `frontend/src/pages/BookKeyPage.tsx`
- Modify: `frontend/src/components/OptionsMenu.tsx`
- Modify: `frontend/src/pages/WorkPage.tsx`
- Modify: `frontend/src/App.tsx` (signed-in routes block, ~line 80)
- Modify: `frontend/src/pages/LibraryPage.tsx` (card `onClick` ~697, detail sheet block ~714-732, `detailBookKey`/`searchParams.get("book")` ~91, ~402-403)
- Modify: `frontend/src/pages/HomePage.tsx:86`
- Delete: `frontend/src/components/BookDetailSheet.tsx`, `frontend/src/components/work/WorkPageView.tsx`

**Interfaces:**
- Consumes: `bookScreenModel`, `BookScreenModel` (Task 2); `useBookActions`, `useLibrary({ enabled })` (Task 3); `WorkPage` (Task 1).
- Produces: `BookScreen({ page, book, signedIn, onAdd, onShare, onBack, backTo }: { page: WorkPage | null; book: Record<string, unknown> | null; signedIn: boolean; onAdd: () => void; onShare: (() => void) | null; onBack: (() => void) | null; backTo: string })`.

- [ ] **Step 1: `OptionsMenu` trigger** — add an optional `trigger?: ReactNode` prop rendered inside the button instead of `<GearIcon />` when given (`{trigger ?? <GearIcon />}`), and let `MENU_WIDTH` grow for longer labels by switching the dropdown style from `width: MENU_WIDTH` to `minWidth: MENU_WIDTH` and positioning from the trigger's left edge when the trigger is wider than the menu (`left: Math.max(8, rect.right - MENU_WIDTH)`). Existing callers pass no `trigger` and look the same.

- [ ] **Step 2: `BookScreen.tsx`** — one component, laid out per the spec's Layout section:

```tsx
export function BookScreen({ page, book, signedIn, onAdd, onShare, onBack, backTo }: Props) {
  const { data: isAdmin = false } = useQuery({ queryKey: ["books-admin"], queryFn: fetchIsAdmin, staleTime: Infinity, enabled: signedIn });
  const model = bookScreenModel(page, book, { isAdmin });
  const [tab, setTab] = useState<BookScreenTabKey>(model.tabs[0]!.key);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [allEditions, setAllEditions] = useState(false);
  const [styling, setStyling] = useState(false);
  const [pickingCover, setPickingCover] = useState(false);
  const [finishing, setFinishing] = useState<ReadSnapshot | null>(null);
  const actions = useBookActions();
  const confirm = useConfirm();
  ...
}
```

Pieces, all inside `<main className="mx-auto max-w-5xl px-5 py-8">` with `<BackLink backTo={backTo} onBack={onBack} />` then a header row holding Share (when `onShare`) and the ⋯ `OptionsMenu` (when `model.menu.length > 0`, trigger `"⋯"`, items mapped from `model.menu`: `style` → `setStyling(true)`, `cover` → `setPickingCover(true)`, `rejectCover`/`replaceCover` → the two functions moved verbatim from `BookDetailSheet.tsx:45-71` with their `coverFile` input, `coverVersion` and `coverError` state).

- Two-column body: `grid gap-6 sm:grid-cols-[220px_1fr]`; left column `sm:sticky sm:top-6 self-start` with the cover (`CoverImage key={coverVersion}` fed by `book` when owned, else the `coverBook` memo from `WorkPageView.tsx:21-24`), title, author, genre chips (`rounded-full border px-2 text-xs text-(--color-text-dim)`), `model.meta`.
- Right column: primary row, then the tab buttons (styled like `BookDetailSheet.tsx:134-152`'s status group, `aria-pressed` on the active one), then the active tab.
- Primary row, owner: two `OptionsMenu`s with text triggers `{model.status.label} ▾` and, when `model.feeling`, `{model.feeling.label} ▾`. Status items skip `selected` options; picking one runs
  ```ts
  const before = readSnapshot(book); const wasFinished = book.ReadStatus === 2;
  if ((await actions.setStatus(book, value)) && value === 2 && !wasFinished) setFinishing(before);
  ```
  Feeling items call `actions.setRating(book, rating)` for non-selected options. Not owned: a full-width accent "Add to library" button calling `onAdd`.
- About tab: summary with Show more (from `WorkPageView.tsx:44-52`), "Editions" list of `allEditions ? model.about.editions : model.about.editionsPreview` with `editionLabel` and "Yours", plus `Show all {n}` button when `editions.length > editionsPreview.length && !allEditions`.
- Highlights tab: the list from `BookDetailSheet.tsx:191-219` over `model.highlights`, with `handleDeleteNote` using `confirm` then `actions.deleteNote(book, id)`; "No highlights yet." when empty.
- Community tab: `model.community.countsLabel`, the `ReaderList` component moved from `WorkPageView.tsx:106-140` adapted to `BookScreenReaderRow` (profile link when `signedIn && row.linksToProfile`), then "Games" with the game links from `WorkPageView.tsx:85-97` over `model.community.games`, or "No public games use this book yet.".
- Overlays at the end: `PerCardStylePanel` (props as `LibraryPage.tsx:752-763`, `seedStyle` from `effectiveCardStyle(resolveLibraryStyle(library.data.style), seriesGroupByBookKey(books, groups).get(key)?.style)` using `useLibrary()` data), `CoverPickerModal` (as `LibraryPage.tsx:766-773`, wired to `actions.saveCover/removeCover`), `FinishSheet` (as `LibraryPage.tsx:736-746`, `books` from the library, `onSetRating={actions.setRating}`, `onAddNote={actions.addNote}`, `onRestoreRead={actions.restoreRead}`). Render owner overlays only when `book`.

The `book` passed in is always the live library object, so the screen re-renders after each save through the `["library"]` query.

- [ ] **Step 3: `WorkPage.tsx`** — `const { data: library } = useLibrary({ enabled: Boolean(session) });`, `const book = page?.mine ? library?.data.books.find((b) => bookKey(b) === page.mine!.bookKey) ?? null : null;`. Signed out, `onAdd` navigates to `/login`. Render `<BookScreen page={page} book={book} signedIn={Boolean(session)} onAdd=… onShare={() => void share()} onBack={onBack} backTo={backTo} />` in place of `WorkPageView`; keep the loading, not-found, error, canonical redirect and `AddBookSheet` code as is.

- [ ] **Step 4: `BookKeyPage.tsx`** and route — inside the signed-in routes in `App.tsx`, add `<Route path="/book/:key" element={<BookKeyPage />} />`. The page:
```tsx
export function BookKeyPage() {
  const { key = "" } = useParams<{ key: string }>();
  const { data: library, isLoading } = useLibrary();
  const workId = library?.works?.[key];
  const book = library?.data.books.find((b) => bookKey(b) === key) ?? null;
  if (workId) return <Navigate to={`/work/${workId}`} replace />;
  if (isLoading) return <main className="mx-auto max-w-5xl px-5 py-8"><p className="text-sm text-(--color-text-dim)">Loading…</p></main>;
  if (!book) return <main className="mx-auto max-w-5xl px-5 py-8"><EmptyState title="Book not found" /></main>;
  return <BookScreen page={null} book={book} signedIn onAdd={() => {}} onShare={null} onBack={() => navigate(-1)} backTo="/dashboard/library" />;
}
```
(`useParams` decodes the segment; `navigate = useNavigate()`.)

- [ ] **Step 5: Entry points** — add `export function bookHref(key: string, works: Record<string, string> | undefined) { const id = works?.[key]; return id ? `/work/${id}` : `/book/${encodeURIComponent(key)}`; }` to `frontend/src/lib/libraryView.ts`. `LibraryPage` card `onClick` → `navigate(bookHref(bookKey(book), library?.works))`; delete `detailBookKey`, `detailKey`, `detailBook`, the `BookDetailSheet` block and the `?book=` cleanup. `HomePage.tsx:86` → `navigate(bookHref(bookKey(book), library?.works))` using the library `HomePage` already loads (if it doesn't, call `useLibrary()` there). Delete `BookDetailSheet.tsx` and `WorkPageView.tsx`.

- [ ] **Step 6: Verify** — `cd frontend && npm run typecheck && npm run lint && npm test`. Then browser check (main session or implementer with the built-in browser, dev stack per `docs/dev-workflow.md`): owned finished book, owned reading book, not-owned book, signed-out `/work/:id`, at 390px and 1280px wide. Status change to Finished opens the finish sheet; ⋯ → Card style and Change cover open their panels; Show all editions; Community links.

- [ ] **Step 7: Commit**
```bash
git add -A frontend && git commit -m "Merge web book details and work page into one book screen" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Mobile merged book screen (public parts)

**Files:**
- Create: `mobile/src/features/works/BookScreen.tsx`
- Modify: `mobile/src/features/works/WorkScreen.tsx`
- Modify: `mobile/src/features/library/hooks/useLibrary.ts:26-28`
- Delete: `mobile/src/features/works/workScreenModel.ts`, `mobile/src/features/works/workScreenModel.test.ts` (keep `workPath` — move it into `WorkScreen.tsx` or wherever its callers import from: `rg -n "workPath" mobile/src`)

**Interfaces:**
- Consumes: `bookScreenModel` (Task 2).
- Produces: `BookScreen({ page, book, model, signedIn, onAdd }: { page: WorkPage | null; book: Record<string, unknown> | null; model: BookScreenModel; signedIn: boolean; onAdd: () => void })` — renders hero, primary row, `Segmented` tabs and tab content inside one `ScrollView`. The caller computes `model` with `bookScreenModel(page, book, { isAdmin: false })` so the header ⋯ (Task 6) and the body share it. Owner pieces (status/feeling menus, ⋯ items, note delete) arrive in Task 6; in this task the owner primary row renders nothing.

- [ ] **Step 1: `useLibrary` enabled** — `export function useLibrary({ enabled = true }: { enabled?: boolean } = {})`, pass `enabled` to `useQuery`.

- [ ] **Step 2: `BookScreen.tsx`** — move the JSX from `WorkScreen.tsx:69-164` and restructure:
  - Hero centred: `BookCover` (`width={112} height={168}`), title (`typography.heading`, centred), author, a wrapping row of genre chips (`borderWidth: 1, borderRadius: radii.pill ?? 999, paddingHorizontal: spacing.sm`, `typography.caption`, `colors.textDim`), `model.meta` caption.
  - Not owned: `Button label="Add to library" variant="primary" onPress={onAdd}`.
  - Tabs: `Segmented accessibilityLabel="Book sections" options={model.tabs.map((t) => ({ value: t.key, label: t.label }))} value={tab} onChange={setTab}` (hide when only one tab).
  - About: the summary + Show more block and Editions lines from `WorkScreen.tsx`, over `model.about.editionsPreview` / `editions`, with a `Button variant="secondary" label={`Show all ${n}`}`.
  - Community: counts caption, reader rows (existing `Pressable`/card code from `WorkScreen.tsx:116-138`, `linksToProfile && signedIn` gates the profile link), then "Games" cards (`WorkScreen.tsx:143-155`) over `model.community.games`.
  - Highlights tab: the list from `BookDetail.tsx:93-123` over `model.highlights`, without the Delete action (Task 6 adds it).
  - Styles: reuse `WorkScreen`'s `styles` entries; add `heroCentered: { alignItems: "center", gap: spacing.xs }`, `chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, justifyContent: "center" }`.

- [ ] **Step 3: `WorkScreen.tsx`** — keep fetch, canonical redirect, error and skeleton states, share and `AddBookSheet`. Header keeps Share. Find the owned book: `const signedIn = inTabs; const { data: library } = useLibrary({ enabled: signedIn }); const book = page.mine ? library?.data.books.find((b) => bookKey(b) === page.mine!.bookKey) ?? null : null;`. Compute `const model = bookScreenModel(page, book, { isAdmin: false });` and render `<BookScreen page={page} book={book} model={model} signedIn={signedIn} onAdd={() => setAdding(true)} />` in the `ScrollView`'s place (BookScreen owns the ScrollView).

- [ ] **Step 4: Verify** — `cd mobile && npm run typecheck && npm test`.

- [ ] **Step 5: Commit**
```bash
git add -A mobile/src/features/works mobile/src/features/library/hooks/useLibrary.ts && git commit -m "Render the mobile work page as the merged book screen" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Mobile owner controls

**Files:**
- Modify: `mobile/src/features/works/BookScreen.tsx`
- Modify: `mobile/src/features/works/WorkScreen.tsx` (header ⋯)

**Interfaces:**
- Consumes: `useLibraryActions()` → `setStatus`, `setRating`, `deleteNote`; `readSnapshot` from `@scripta/shared`.
- Produces: `BookScreen` gains owner behaviour; `bookMenuItems(model, key): MenuItem[]` local helper in `BookScreen.tsx`, exported for `WorkScreen`'s header and the Task 7 fallback.

- [ ] **Step 1: Primary row** — when `model.status`:
```tsx
<View style={styles.primaryRow}>
  <Menu title="Reading status" items={model.status.options.map((o) => ({ label: o.label, selected: o.selected, onPress: o.selected ? undefined : () => void changeStatus(o.value) }))}>
    <View style={[styles.menuButton, { borderColor: colors.accent, backgroundColor: colors.accentSoft }]}><Text style={[typography.body, styles.strong, { color: colors.accent }]}>{model.status.label} ▾</Text></View>
  </Menu>
  {model.feeling ? (
    <Menu title="How it landed" items={model.feeling.options.map((o) => ({ label: o.label, selected: o.selected, onPress: o.selected ? undefined : () => void setRating(book, o.rating) }))}>
      <View style={[styles.menuButton, { borderColor: colors.border }]}><Text style={[typography.body, { color: colors.text }]}>{model.feeling.label} ▾</Text></View>
    </Menu>
  ) : null}
</View>
```
`changeStatus` is the logic from `book/[key]/index.tsx:28-33`:
```ts
async function changeStatus(status: ReadStatus) {
  const before = readSnapshot(book);
  const wasFinished = book.ReadStatus === 2;
  const saved = await setStatus(book, status);
  if (saved && status === 2 && !wasFinished) router.push(`/book/${encodeURIComponent(bookKey(book))}/finished?before=${encodeURIComponent(JSON.stringify(before))}` as never);
}
```
Use whatever accent-soft colour token the theme has (`rg -n "accentSoft|accentMuted" mobile/src/ui/theme*`); if none, use `colors.surface`. Styles: `primaryRow: { flexDirection: "row", gap: spacing.sm }`, `menuButton: { flex: 1, minHeight: 44, borderWidth: 1, borderRadius: radii.md, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.md }`. The trigger is a plain `View`, never a `Pressable` (see the `Menu` comment in `ui/components.tsx`).

- [ ] **Step 2: Highlights delete** — restore the `isNote` Delete text with `confirmDeleteNote` from `BookDetail.tsx:13-18`, calling `deleteNote(book, bookmarkId)`.

- [ ] **Step 3: ⋯ menu** —
```ts
export function bookMenuItems(model: BookScreenModel, key: string): MenuItem[] {
  const to = (suffix: string) => () => router.push(`/book/${encodeURIComponent(key)}/${suffix}` as never);
  return model.menu.flatMap((item) => (item === "style" ? [{ label: "Card style", onPress: to("style") }] : item === "cover" ? [{ label: "Change cover", onPress: to("cover") }] : []));
}
```
In `WorkScreen`'s `headerRight`, after Share: when `book` and the items are non-empty, `<Menu title={work.title} items={bookMenuItems(model, page.mine!.bookKey)}><IconButton framed accessibilityLabel="Book actions" name="more" /></Menu>` using the `model` `WorkScreen` already computes.

- [ ] **Step 4: Verify** — `cd mobile && npm run typecheck && npm test`.

- [ ] **Step 5: Commit**
```bash
git add -A mobile/src/features/works && git commit -m "Add status, feeling, notes and card tools to the mobile book screen" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Mobile routes — `/book/<key>` redirect, fallback, Arena stack

**Files:**
- Move: `mobile/src/app/(app)/(home,library)/book/` → `mobile/src/app/(app)/(home,arena,library)/book/`
- Modify: `mobile/src/app/(app)/(home,arena,library)/book/[key]/index.tsx`
- Modify: `mobile/src/app/(app)/(home)/_layout.tsx:15`, `mobile/src/app/(app)/(library)/_layout.tsx:30`, `mobile/src/app/(app)/(arena)/_layout.tsx`
- Delete: `mobile/src/features/library/components/BookDetail.tsx`

- [ ] **Step 1: Move the folder** — `git mv "mobile/src/app/(app)/(home,library)/book" "mobile/src/app/(app)/(home,arena,library)/book"`. Fix any relative imports inside (they use `@/` aliases, so likely none).

- [ ] **Step 2: Layouts** — in `(home)/_layout.tsx` and `(library)/_layout.tsx`, change the `book/[key]/index` screen to `options={{ title: "" }}` (full screen, no sheet). In `(arena)/_layout.tsx` add the four book screens with the same options the other two layouts use:
```tsx
const sheet = useSheetOptions();
...
<Stack.Screen name="book/[key]/index" options={{ title: "" }} />
<Stack.Screen name="book/[key]/style" options={{ ...sheet, title: "Card style" }} />
<Stack.Screen name="book/[key]/cover" options={{ ...sheet, title: "Cover" }} />
<Stack.Screen name="book/[key]/finished" options={{ ...sheet, title: "Finished" }} />
```

- [ ] **Step 3: `index.tsx`** —
```tsx
export default function BookRoute() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const { book, loading, workId } = useBook(key);
  useEffect(() => {
    if (workId) router.replace(`/work/${workId}` as never);
  }, [workId]);
  const model = book ? bookScreenModel(null, book, { isAdmin: false }) : null;
  return (
    <Screen bottom top={false}>
      <Stack.Screen options={{ headerShown: true, title: "", headerRight: model && key ? () => <HeaderActions><Menu items={bookMenuItems(model, decodeURIComponent(key))}><IconButton framed accessibilityLabel="Book actions" name="more" /></Menu></HeaderActions> : undefined }} />
      {loading || workId ? <Skeleton height={180} /> : !book || !model ? (
        <ErrorState title="Book not found" body="It may have been removed from your library." actionLabel="Back" onAction={() => router.back()} />
      ) : (
        <BookScreen page={null} book={book} model={model} signedIn onAdd={() => {}} />
      )}
    </Screen>
  );
}
```

- [ ] **Step 4: Delete** `BookDetail.tsx`; `rg -n "BookDetail\b" mobile/src` must return nothing.

- [ ] **Step 5: Verify** — `cd mobile && npm run typecheck && npm test && npx expo-doctor` (expo-doctor only flags; don't chase `@latest` drift).

- [ ] **Step 6: Commit**
```bash
git add -A mobile/src && git commit -m "Route mobile book taps to the merged screen and reach book tools from the Arena tab" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Device pass** — dispatch `device-checker` (after `node scripts/dev-status.mjs --json` shows the emulator free) with: owned reading book from Library (status menu → Finished opens finish sheet; feeling menu; ⋯ → Card style, Change cover; Highlights delete note), a not-owned book from a Community/Arena path (Add to library; About Show all editions; Community games), a book opened from the Arena tab reaching ⋯ → Card style in the Arena stack, and an unresolved library book if the fixture has one. Android menus must open on first tap. Fix findings before merge.

---

## Self-review notes

- Spec coverage: routing (Tasks 4, 7), data (1), who-sees-what (2), layout (4, 5, 6), components/deletions (4–7), error handling (existing paths preserved in 4/5; admin alert moved in 4), testing (1, 2, 4 browser, 7 device).
- Web `/book/:key` fallback is signed-in only (inside the auth routes), matching the spec's "new signed-in web route".
