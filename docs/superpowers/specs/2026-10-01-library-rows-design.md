# Library rows: books, highlights and groups as rows

Date: 2026-10-01
Status: direction approved in conversation (phase B of the data-model work);
spec awaiting review

## Problem

Each account's library is one JSON value in `library_documents.data` (up to
10 MiB after the load-safety cap): every book, every highlight, the groups and
the style. So:

- **Every save rewrites everything.** Marking one book read sends, parses,
  re-derives and stores the whole document, then parses it again to echo it.
- **Every public view parses everything.** Four routes read the owner's whole
  document per request: `GET /library/shared/:token`,
  `GET /community/profiles/:username/library`, `GET /murals/shared/:token`,
  and `GET /community/profiles/:username` when the profile has a shelf
  mural. The two library routes also run a covers-DB lookup per book.
- **Derived data needs its own machinery**: `library_derived` and
  `library_match_keys` exist only because the document can't be queried.

## The path

| Phase | What | Clients |
|---|---|---|
| **B (this spec)** | The server keeps rows in step with the document on every save, and every read except the owner's own full fetch uses rows | unchanged |
| C | Per-book writes (status, add a book, add a note) edit rows directly; the whole-document save stays for installed builds | new endpoints, additive |
| D | Rows are the source of truth; the document is assembled only for old clients, then retired | after old builds update |
| E | Games reference `work_id` (see the Works spec) | — |

Phase B is the derive-at-save pattern `library_match_keys` already uses, made
complete. It fixes the read side now without touching either client.

## Phase B data model (`library.sqlite`)

```
library_books
  user_id, position          PRIMARY KEY      -- index in data.books
  book_key                   TEXT NOT NULL    -- bookKey(), what groups, murals and games reference
  title, author, isbn, image_id, series, series_number,
  read_status, percent_read, rating, date_last_read,
  sort_order, cover_url, cover_image_id,       -- _order, _coverUrl, _coverImageId
  genres                     TEXT             -- JSON array, as stored
  highlight_count            INTEGER
  row_hash                   TEXT             -- of the book's JSON, to skip unchanged books
  index (user_id, book_key), index (user_id, read_status)

library_highlights
  user_id, position, highlight_id  PRIMARY KEY  -- BookmarkID
  text, annotation, type, created_at

library_groups
  user_id, group_id          PRIMARY KEY
  type, name, position, book_keys  TEXT        -- JSON array, as stored

library_summary              -- replaces library_derived
  user_id                    PRIMARY KEY
  name, style                -- the document's own fields, as stored
  glyph, reader_card, shelf_theme   -- computed at save, as JSON
  book_count, finished_count, in_progress_count, highlight_count
  source_updated_at          -- the document version these rows came from
```

`library_match_keys` stays as it is in this phase; reader overlap moves to
`work_id` with the Works phase.

## Writing

- Rows change in the same transaction as the document, on every path that
  writes it (`saveLibrary`, `addBook`, `mergeBooks`), exactly where
  `library_match_keys` is written today.
- **Only changed books are rewritten.** Each book's JSON is hashed; books whose
  `row_hash` and position are unchanged are skipped, so marking one book read
  writes one book row and none of the highlights. A fresh import writes
  everything once: 5,000 books with 50,000 highlights measured 0.27–0.29 s.
  That is a known stall at import, the same order as today's import save;
  the stall log will show whether it needs splitting.
- The startup step that re-derives stale rows today covers the new tables,
  and the version gate becomes `user_version !== LIBRARY_DERIVED_VERSION`, so
  a rolled-back build rebuilds too.
- Account deletion clears all four tables.

## Reading

| Route | Today | Phase B |
|---|---|---|
| `GET /library/shared/:token`, `GET /community/profiles/:username/library` | parse the whole document, redact, one covers lookup per book | `SELECT` the public columns from `library_books` plus `library_summary` / `library_groups`; covers for books without one in one batched lookup through the books module's public API |
| `GET /murals/shared/:token`, profile shelf mural | parse the whole document, index every book | point lookups for the referenced `book_key`s and highlight ids; currently-reading by `read_status = 1`; stats, shelf theme and reader card from `library_summary` |
| `GET /library` (owner) | parse the document, then serialise it again | send the stored JSON text inside the response without parsing it |
| `PUT /library` echo | parse the document just written | reuse the JSON text just written |

Response shapes are unchanged. The public library routes still return every
book (installed builds expect that), but as rows without highlights and
without per-book lookups. An opt-in `?limit=&cursor=` for paging is phase C.

## Privacy

The public column list is the same allowlist `toPublicLibraryBook` enforces
today (title, author, ISBN, image id, read status, series number, order,
cover). Highlights leave the server only for a mural quote block that names
them, as today. Tests pin both.

## Verification

- Repository tests: rows match a document after insert, edit, reorder, delete
  and merge; an unchanged save writes no book rows; deletion clears everything.
- Route tests: each route in the table returns the same JSON as before for the
  same document (golden comparison against today's output).
- Timing test: a public library view of a 10 MiB document does no
  `JSON.parse` of the document (spy), and finishes under a fixed budget.
