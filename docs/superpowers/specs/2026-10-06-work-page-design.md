# Work page

One page per catalog work, on web and mobile. It shows the book, your copy, other readers, and the public games that use it.

## Why

- **Roadmap:** the E1 roadmap promised "a route per work on web and mobile: details, editions, your history, community references, basic stats". E2 finished the groundwork. Library books and game entries all resolve to canonical work ids, and the library document carries `works`.
- **Social direction:** since 2026-09-30, the app is meant to be social (see `2026-09-30-social-loop-design.md`). Today a book is a dead end: its view shows only your own copy, and nothing in games or murals links to it.
- **The page's job:** both a reference page for the book and the place to see who else reads it. Both halves get equal weight.

## Decisions

| Topic | Decision |
|---|---|
| Sections | Book, your copy, readers, games, in that order. |
| Readers | People you follow first, then published readers. |
| Access | Public link at `/work/<id>`. Signing in adds your copy and followed readers. |
| Shape | One composed endpoint, `GET /works/:id`. |
| Not in v1 | Stats across readers (arena rating, "often ranked with"), popular highlights, quotes, reader overlap by work, murals moving to works. |

## Backend

A new `works` module (`backend/src/modules/works/`) owns no database. It registers `GET /works/:id`. The route reads the viewer optionally, with `getOptionalAuthenticatedUser`, like the community profile routes. It builds the response from one by-work method per owning module.

| Module | New method | Returns |
|---|---|---|
| books | `getWorkPage(id)` | `undefined` for an unknown id. Otherwise `{ id, title, author, summary, coverUrl, editions, aliasIds }`. |
| library | `holdersOfWorks(workIds)` | `Array<{ userId, readStatus }>`, one entry per user holding any of the ids. |
| library | `copyOfWork(userId, workIds)` | `undefined`, or `{ bookKey, readStatus, rating, highlightCount }`. |
| community | `visibleReaders(viewerId \| null, userIds)` | `{ followed, others }`. Each entry is a `ReaderProfile` with `userId`, `readerGlyph` and `published`. |
| tierlists, arena, quizzes | `publishedByWorks(workIds, limit)` | Public game summaries, newest first. |

How the parts work:

- **Book details (`getWorkPage`):**
  - `id` is canonical: a merged-away id resolves to its target.
  - `aliasIds` is the canonical id plus every work id whose `merged_into` chain ends at it. All later queries take `aliasIds`, because copies and game entries written before a merge still hold the old id.
  - Editions list the `books` rows of every alias: title, language, year, ISBN, `bookId`.
  - `summary` comes from the first edition with one. If `works.summary` exists (open PR #159), it wins.
  - `coverUrl` is the first edition's cached cover.
- **Viewer's copy:**
  - The route sets `summary` and `coverUrl` from the viewer's own edition when that edition has them.
  - `copyOfWork` reads the library document for `rating` (the finish feeling) and the highlight count. It reads `library_books` for the rest.
  - A user with two copies of one work gets the first by library position.
- **Readers:**
  - `library_books` gets `CREATE INDEX idx_library_books_work ON library_books(work_id, user_id)` in `schema.sql`.
  - The route drops the viewer from `holdersOfWorks`. It passes the rest to `visibleReaders`, then joins status back in.
- **Response:**

```ts
type WorkPage = {
  work: { id: string; title: string; author: string; summary: string | null; coverUrl: string | null;
          editions: Array<{ bookId: string; title: string; language: string | null; year: number | null; isbn: string | null; mine: boolean }> };
  mine: { bookKey: string; readStatus: 0 | 1 | 2; rating: string | null; highlightCount: number } | null;
  readers: { followed: Reader[]; others: Reader[]; counts: { readers: number; finished: number } };
  games: { tierlists: GameRef[]; arenas: GameRef[]; quizzes: GameRef[] };
};
type Reader = ReaderProfile & { readerGlyph?: IdentityKey; readStatus: 0 | 1 | 2; published: boolean };
type GameRef = { id: string; name: string; owner: ReaderProfile | "app"; path: string };
```

- **Caps:** at most 50 readers in total (followed first) and 20 games per kind. `counts` covers every reader the viewer may see, not only the 50 returned.
- **Book status:** `editions[].mine` marks the viewer's edition.
- **Merged-away ids:** a request for one answers with `work.id` set to the canonical id.
- **Types:** `WorkPage`, `Reader` and `GameRef` live in `packages/shared/src/works/`. `ReaderProfile` and `IdentityKey` are the existing community and reader-card types, the ones `CommunityAuthor` uses. `GameRef.path` is the public path clients link to: `/vote/<code>` for a tier list, `/arena/<id>` for a tournament, `/play/<code>` for a quiz.

## Visibility

| Section | Signed out | Signed in |
|---|---|---|
| Book | yes | yes |
| Your copy | `null` | your own copy, or `null` |
| `readers.followed` | empty | People you follow who have a published profile or share reading activity (feed setting `reading`). |
| `readers.others` | Published profiles. | Published profiles, minus you and anyone in `followed`. |
| Games | Published only. | Published only. |

Rules:
- **Reader row:** name, glyph and status only. Feeling, dates and highlights are never sent, because none of them is public today.
- **Profile link:** `published: false` means the reader is followed and shares reading activity but has no published profile. Clients show that row without a profile link.
- **Hidden users:** an unpublished user who doesn't share reading activity is never returned and never counted.
- **Counts:** they include only rows this viewer may see.
- **Published games:** tier lists with a `vote_code`, tournaments whose status is not `seeding`, and quizzes with a `vote_code`. These are the same rules the Discover lists use.
- **Promoted lists:** a tier list owned by `__app__` has `owner: "app"`, and clients show it as "Scripta".
- **Quizzes:** the entry links to the play page. The work page names the book, so quiz play itself never links to the work page.
- **Unknown id:** 404 `{ "error": "No book with that id." }`, whether or not the viewer is signed in.
- **Headers:** responses carry `Cache-Control: no-store`. The route gets the same per-IP rate limit as the other unauthenticated reads.

## Clients

**Web:**
- `/work/:id` is a public route in `frontend/src/App.tsx`, outside `RequireAuth`, like `/arena/:id`.
- One query renders the four sections. Reuse `BookSummary`, the People page profile rows and the Discover game cards wherever they fit.
- Signed out, the "Your copy" slot shows a sign-in prompt.
- A merged-away id replaces the URL with `navigate(…, { replace: true })`.

**Mobile:**
- `(home,arena,library)/work/[id]` is a shared stack route, following `u/[username]`. It is built from existing design-system rows and cards. A merged-away id calls `router.replace`.
- `app.json` gets an Android intent-filter `pathPrefix` `/work/`. That is a native config change: it ships with the next store build, while the page itself ships over the air. Until then `/work/` links open on the web.

**Ways in:**
- **Your book:** the book page on mobile (`book/[key]`) and `BookDetailSheet` on web get an "About this book" link. Its work id comes from the library document's `works` map, and the link is hidden when the book has no work.
- **Tier lists:** the results "Book votes" sheet.
- **Arena:** books in the tournament view (bracket and duel cards).
- **Murals:** book blocks. Public books already carry `workId`.
- **Feed events:** `book_added` and `book_finished` events. New events store `workId` in their payload, and older events show no link.
- **Share:** a Share button on the page uses `publicContentUrl("/work/<id>")` and the existing share sheet.
- **Quiz play:** no link, because it would give the answer away.

## Errors

- **Unknown id:** 404. Clients show a "not found" state.
- **Catalog unreachable:** the global `WorkResolutionError` handler answers 503. Clients show a retry state, and the page never renders without its book section.
- **Readers or games fail:** errors from these queries propagate as 500. They are never turned into an empty section, which would read as "nobody has read this".

## Rollout

Three stacked PRs, each merged by the user:

| # | PR | Contents |
|---|---|---|
| 1 | Backend | The `works` module and route, the by-work methods, the `library_books` work index, `workId` in new feed-event payloads, and the shared types. |
| 2 | Web | The `/work/:id` page and the web ways in. |
| 3 | Mobile | The `work/[id]` route, the mobile ways in, and the `app.json` intent filter. |

Nothing rewrites existing data. The new index is additive, and older feed events keep their payloads.

## Verification

- **Module methods:** each by-work method is unit-tested in its own module, including entries stored on a merged-away id. The game methods are also tested with unpublished items, which must never be returned.
- **`works/routes.test.ts`** covers the visibility matrix:
  - signed out;
  - signed in, following a published reader;
  - signed in, following a reader who only shares reading activity;
  - an unpublished reader who doesn't share, who must be absent and uncounted;
  - the viewer's own copy excluded from the readers;
  - counts for each case;
  - no feeling or dates in any reader row;
  - 404, 503, and a merged-away id answering the canonical id.
- **Feed events:** new `book_added`/`book_finished` events carry `workId`.
- **Web and mobile:** render tests for each section, plus the empty, not-found and signed-out states.
- **Device pass:** one `device-checker` pass on the mobile PR covers the work page opened from a book page, from a tier-list sheet and from a feed event.
