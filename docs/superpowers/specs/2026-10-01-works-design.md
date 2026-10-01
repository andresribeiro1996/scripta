# Works: one book above its editions

Date: 2026-10-01
Status: direction approved in conversation (works above editions,
translations are the same work, every edition records its language); spec
awaiting review

## Problem

The catalog (`backend/src/modules/books`, `covers.sqlite`) is edition-first:
one `books` row per ISBN, plus `book_keys` aliases (`isbn:…`,
`ta:<title>|<author>`). Nothing says that the Portuguese and English editions
of *Atomic Habits*, or the hardcover and paperback of *Dune*, are the same
book. Consequences today:

- the title key is used like a work key but holds edition titles, so
  translations never meet;
- reader overlap ("you both read…") needs per-library match keys
  (`library_match_keys`) and still misses other editions;
- tier lists, tournaments and quizzes vote on `bookKey` strings, so two
  editions of one book are two entries;
- merging duplicates rewrites keys in four modules (`rekeyBooks`).

PR #100 started the groundwork: `books.ol_work_key` (nullable, `OL…W`), filled
by the seed, the Portuguese publisher importer and Open Library lookups, and
never overwritten.

## Decisions

1. **A work is the book itself**; an edition is one ISBN (format, publisher,
   translation). Every catalog edition belongs to exactly one work.
2. **Open Library's grouping defines works**, including translations:
   *Hábitos Atômicos* and *Atomic Habits* are one work. Open Library's work
   key is the work's identity when known.
3. **Every edition records its language** as a BCP 47 tag (`en`, `pt-PT`,
   `pt-BR`, `es`, …), or `NULL` when no source says.
4. **Nothing user-visible changes in this phase.** Works are groundwork for
   reader overlap by work (library rows), games voting on works, and one-place
   merges.

## Data model (`covers.sqlite`)

```
works
  id            TEXT PRIMARY KEY            -- uuid
  ol_work_key   TEXT UNIQUE                 -- OL…W, NULL for a work only we know
  title         TEXT NOT NULL               -- from the first edition seen
  author        TEXT NOT NULL
  merged_into   TEXT REFERENCES works(id)   -- set when this work turns out to be another
  created_at    TEXT NOT NULL

books (the editions table; keeps its name)
  + work_id     TEXT REFERENCES works(id)   -- NULL only until the backfill reaches it
  + language    TEXT                        -- BCP 47
  index on books(work_id)
```

`book_keys` and `cover_images` are unchanged: they already hang off editions.
Renaming `books` to `editions` is churn with no behaviour, so it isn't done.

## Assigning works

- **An edition with an `ol_work_key`** joins the work with that key, created
  on first sight.
- **An edition without one** gets a work of its own, so `work_id` is never
  empty. When Open Library later supplies its key, the edition moves to that
  work; if its old work is left with no editions, the old work gets
  `merged_into` the new one, so anything that stored the old id still
  resolves.
- **ISBN-less lookups** already land on an existing edition through its
  `ta:` alias, so they share that edition's work.
- **Backfill:** a startup step assigns works to editions with `work_id IS
  NULL`, in batches that yield between them (the seed is ~50,000 rows).
- **Missing Open Library keys** are looked up in the background lane
  (`/isbn/{isbn}.json` → `works[0].key`), at Open Library's rate limit. The
  book-merge-seed session estimated ~14 hours for 50,000 ISBNs; it runs after
  the seed's cover work, never ahead of user requests.

## Language

Filled only from sources that state it, in this order:

1. Open Library's edition record (`languages: [{ key: "/languages/por" }]`).
   Those are MARC codes (`por`, `eng`, `spa`, `fre`, `ger`, …), mapped to
   two-letter tags; an unmapped code stays `NULL`.
2. The seed list, whose language is chosen per list (`por`, `eng`).
3. The Portuguese publisher importer: `pt`.

For Portuguese, the region comes from the ISBN's registration group, which
names the publisher's country: `978-972` and `978-989` give `pt-PT`, `978-85`
and `978-65` give `pt-BR`, anything else stays `pt`. Brazilian and European
editions are different translations, so the region matters. No language is
guessed from title text, and a reader's own Kobo `Language` field is not
copied into the shared catalog.

## Not in this phase

- Library rows and reader overlap by work (`2026-10-01-library-rows-design.md`).
- Games storing `work_id` instead of `bookKey` (a later phase).
- A UI for merging works by hand; `merged_into` only makes it possible.

## Verification

- Repository tests: an edition with a key joins its work; two editions with
  the same key share one work; a keyless edition gets its own work and moves
  when a key arrives, leaving `merged_into` behind; the backfill assigns
  every edition; language mapping covers `por`/`eng`, the Portuguese ISBN
  groups and the unknown case.
- Production check after deploy (the user runs it): count of editions
  without `work_id` is 0 once the backfill finishes; count of works, and of
  editions per language.
