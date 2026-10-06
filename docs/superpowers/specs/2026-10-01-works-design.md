# Works: one book above its editions

Date: 2026-10-01
Status: direction approved in conversation (works above editions,
translations are the same work, every edition records its language);
revised 2026-10-02 after the plan review and the book-merge-seed session's
constraints

## Problem

The catalog (`backend/src/modules/books`, `covers.sqlite`) is edition-first:
one `books` row per ISBN, plus `book_keys` aliases (`isbn:…`,
`ta:<title>|<author>`). Nothing says that the Portuguese and English editions
of *Atomic Habits*, or the hardcover and paperback of *Dune*, are the same
book. The consequences today:

- the title key is used like a work key but holds edition titles, so
  translations never meet;
- reader overlap ("you both read…") needs per-library match keys
  (`library_match_keys`) and still misses other editions;
- tier lists, tournaments and quizzes vote on `bookKey` strings, so two
  editions of one book are two entries;
- merging duplicates rewrites keys in four modules (`rekeyBooks`).

PR #100 started the groundwork. `books.ol_work_key` (nullable, `OL…W`) is
filled by the seed, the Portuguese publisher importer, catalog search and the
details backfill, and is never overwritten. `docs/work-model-notes.md` holds
the design notes this spec follows.

## Decisions

1. **A work is the book itself.** An edition is one ISBN (format, publisher,
   translation). Every catalog edition belongs to exactly one work.
2. **Open Library's grouping defines works**, translations included:
   *Hábitos Atômicos* and *Atomic Habits* are one work. Open Library's work
   key is the work's identity when known.
3. **Keyless editions get works of our own**, one per edition in this phase.
   Titles and `ta:` keys never choose a work: edition titles differ by
   language, and the title key caused a real collision bug (fixed
   2026-10-01). Superseded on 2026-10-04 by
   `2026-10-04-keyless-works-design.md`: `ta:` aliases still never choose a
   work, but a stored title key groups keyless works.
4. **Covers stay per edition.**
5. **Every edition records its language** as a BCP 47 tag (`en`, `pt-PT`,
   `pt-BR`, `es`, …), or `NULL` when no source says.
6. **Nothing user-visible changes in this phase.** Works are groundwork for
   reader overlap by work (library rows), games voting on works (phase E),
   and one-place merges.

## Data model (`covers.sqlite`)

```
works
  id            TEXT PRIMARY KEY            -- uuid
  ol_work_key   TEXT UNIQUE                 -- OL…W, NULL for a work only we know
  title         TEXT NOT NULL               -- from the first titled edition
  author        TEXT NOT NULL
  merged_into   TEXT REFERENCES works(id)   -- set when this work turns out to be another
  created_at    TEXT NOT NULL

books (the editions table; keeps its name)
  + work_id          TEXT REFERENCES works(id)   -- NULL only until the backfill reaches it
  + language         TEXT                        -- BCP 47
  + work_checked_at  TEXT                        -- last background lookup of its work key
```

`book_keys` and `cover_images` are unchanged, since they already hang off
editions. Renaming `books` to `editions` is churn with no behaviour change,
so it isn't done.

## Assigning works

- **An edition created with an `ol_work_key`** joins the work with that key,
  created on first sight. The search hits and the importer pass the key into
  `createBook` instead of setting it right after, so they leave no throwaway
  work behind.
- **An edition without one** gets a work of its own.
- **A key arriving later** (`setWorkKey`, still fill-only):
  - If no work holds that key and the edition's own work has only this
    edition, the key goes onto that work.
  - If another work already holds the key, the edition moves there and its
    old work gets `merged_into` the keyed one, so anything that stored the
    old id still resolves.
  - An edition the backfill hasn't reached yet joins the keyed work directly.

  Only keyless works are ever merged, and keyed works never lose editions, so
  merges never chain.
- **Empty identities.** The importer creates editions with an empty title and
  author when its feed has no author, and `fillIdentity` fills them later.
  A work made from such an edition starts empty too. `fillIdentity` fills the
  work's empty title and author in the same transaction, and so does a titled
  edition joining an empty keyed work.
- **ISBN-less lookups** already land on an existing edition through its `ta:`
  alias, so they share that edition's work.
- **Concurrency.** The importer and the seed write `covers.sqlite` from other
  processes while the API runs. Every read-then-write here (create, set key,
  backfill batch) is one `BEGIN IMMEDIATE` transaction. A deferred `BEGIN`
  fails at once with "database is locked" when another process commits
  between the read and the write; `busy_timeout` doesn't cover that case.
- **Backfill.** A startup step assigns works to editions with `work_id IS
  NULL`. It runs off the boot path, 250 editions per transaction, yielding
  between batches, and retries every 10 minutes if a batch fails. After the
  seed there will be about 65,000 rows; a synthetic run took 3.1 s in total,
  with batches of 14–22 ms.
- **Missing Open Library keys.** These are looked up in the background
  (`/isbn/{isbn}.json` → `works[0].key`), in the normal Open Library lane at
  one lookup every 2 s, users' accounts first. The lookup only visits editions
  the details backfill has already checked, which already stores work keys.
  It is built only if, after the rest is live, enough keyless editions remain
  to be worth it (see the plan).

## Language

Filled only from sources that state it:

1. **Open Library's edition record** (`languages: [{ key: "/languages/por" }]`).
   These are MARC codes (`por`, `eng`, `spa`, `fre`, `ger`, …), mapped to
   two-letter tags; an unmapped code stays `NULL`. This is the most specific
   source, so it **replaces** a language the others filled.
2. **The seed.** It uses each entry's Open Library edition languages when
   present, otherwise the list's language. Fill-only.
3. **The Portuguese publisher importer.** `pt` for ISBNs registered in
   Portugal only, and `NULL` otherwise. Fill-only.

For Portuguese, the region comes from the ISBN's registration group, which
names the publisher's country:
- `978-972` and `978-989` give `pt-PT`;
- `978-85` and `978-65` give `pt-BR`;
- anything else stays `pt`.

Brazilian and European editions are different translations, so the region
matters. No language is guessed from title text, and a reader's own Kobo
`Language` field is not copied into the shared catalog.

In this phase, the seed's existing rows get a language only when the seed is
re-run. User editions that the details backfill keyed get one only through
the background lookup, if it is built.

## Not in this phase

- **Grouping keyless editions by title plus author.** Built in
  `2026-10-04-keyless-works-design.md`.
- **Library rows and reader overlap by work**
  (`2026-10-01-library-rows-design.md`).
- **Games storing `work_id`** instead of `bookKey`: phase E.
- **A UI for merging works by hand.** `merged_into` only makes it possible.
- **Quotes per work**, from Wikiquote (see `docs/work-model-notes.md`).

## Verification

- **Repository tests:**
  - two editions with one key share a work;
  - a keyless edition gets its own;
  - a late key lands on the edition's own work when no work holds it;
  - a late key joins an existing keyed work and leaves `merged_into`;
  - `setWorkKey` stays fill-only;
  - the backfill assigns every edition, yielding between batches;
  - `fillIdentity` fills an empty work;
  - a concurrent commit from another connection no longer fails a create;
  - language mapping (`por`/`eng`, the Portuguese ISBN groups, unknown
    codes), fill-only for the seed and importer, and replace for Open
    Library.
- **Production check after deploy** (the user runs it, read-only):
  - editions without `work_id` reach 0;
  - no edition's key disagrees with its work's;
  - counts of works, merged works, untitled works, looked-up editions, and
    editions per language.
