# Catalog genres for libraries — design

Follows the reader-card genre floor (`docs/superpowers/plans/2026-10-14-reader-card-genre-floor.md`).

## Goal

Books in people's libraries get genres even when Open Library and ISBNdb have none, which is the case for most Portuguese editions and for obscure books. That includes libraries imported in the future, without anyone running a manual step. Libraries keep getting genres whenever the catalog learns more.

Production on 2026-10-14: 4 libraries, 324 books, 230 with no genre.
- 154 are stored as `_genres: []` after a lookup that found nothing. The client never asks again (`needsGenreMetadata`).
- 76 were never looked up.
- 58 of the 230 already have genres in the catalog.
- 142 distinct works have none anywhere. 73 are Portuguese, 32 have a synopsis, and one library holds 120.

Jev (TypeSafe's typed-classification model) was measured on those 142 works on 2026-10-14, comparing its main genre with Claude's labels:

| Jev confidence | Books | Agrees with Claude |
|---|---|---|
| 0.8 and above | 89 | 97% |
| 0.5–0.8 | 42 | 76% |
| Below 0.5 | 11 | 55% |

Other results:
- Portuguese and other books did about equally well.
- It cost $0.017 in total, at about 0.2 s per book.
- Per-genre yes/no questions over-tagged (56% precision), so only the main genre is used.

Five pieces:

1. **Re-check on load:** libraries pick up catalog genres, and later corrections to them, on every load.
2. **Automatic classification with Jev:** a backend job classifies works libraries hold that still have no genres after Open Library and ISBNdb.
3. **Possible genres:** genres from Jev answers with confidence 0.5–0.8 are saved but flagged as possible. The book screen shows them as such.
4. **Manual genre pass:** the owner exports, Claude classifies, and the owner imports. It covers the current backlog, the works Jev left below 0.5, and the possible genres awaiting review. Manual labels replace Jev's.
5. **Portuguese subject words** in the subject-to-genre rules.

## Non-goals

- **Classification through the Anthropic API.**
- **Jev's per-genre yes/no answers.** They over-tag.
- **Re-asking Jev automatically.** A stored judgment is final. Deleting it makes the job ask again, for example after a model upgrade.
- **Apple Books genres.** On one Portuguese-heavy library's 107 finished books, Apple gave a specific genre for 48. Imports never use Apple's lane. Apple's US store labels Portuguese novels "Romance".
- **Language-aware user tags.** A Portuguese reader's "romance" shelf still becomes Romance.
- **Refreshing stored cards of owners who don't open the app.** Visitors see the new card after the owner's next load.
- **Replacing the per-book `/books/details` enrichment.**

## 1. Re-check on load

### Server

Every response that carries `works` also carries `genres: Record<string, BookGenre[]>`, mapping book key to the catalog genres of that book's work. That covers GET and PUT `/library`, `POST /library/books/merge`, share and unshare, and the 409 `current`. Only books with a `works` entry and non-empty catalog genres appear.

A work's catalog genres are its genres followed by its possible genres (section 3), at most 3 in total. Both follow the rule the book screen uses for `WorkPage.work.genres` (`topGenres` in `works/service.ts`):
- the union of every edition's stored genres, including editions of works merged into it;
- normalised with `normalizeBookGenres`;
- ordered by how many editions carry each.

Both callers share one implementation. The library module reaches it through the books module's public exports, as it already does for `canonicalWorks`. That costs one catalog query per response, keyed by the canonical ids `worksOf` already computes.

### Clients

`@scripta/shared` gains `withCatalogGenres(data: LibraryData, genres: Record<string, BookGenre[]>): LibraryData`. For each book whose key has non-empty catalog genres, it writes `_genres` with those genres and `_genresFrom: "catalog"` when either:
- the book has no genres (`genresForBook(book)` is empty); or
- the book's `_genresFrom` is `"catalog"` and its genres differ from the catalog's. This is how a manual correction reaches libraries.

Rules:
- A book with genres of its own and no marker is never touched. That covers import tags and genres written before this change.
- When nothing changes, it returns `data` itself.

The app-wide enrichment hook (`useGenreEnrichment`, web and mobile) applies catalog genres before it starts a lookup round, never both in one round:
1. When `withCatalogGenres` would change the cached library, the hook saves once through `updateLibrary` and starts no lookups.
2. The save's response re-renders the hook. Filled books no longer match, so the hook moves on to lookup rounds as today.

The hook's own lookup writes also set `_genresFrom: "catalog"`. These saves are whole-document saves, so the stored reader card, dial and shelf theme recompute through the existing path.

## 2. Automatic classification with Jev

### Selection

A catalog work is classified when all of these hold:
- at least one library holds it (`library_books.work_id`, canonicalised);
- none of its editions has genres;
- at least one edition has been through the details lookup (`details_status` is set), so Open Library and ISBNdb had their chance first;
- it has no stored judgment.

### Request

Each work gets one request to `POST https://api.typesafe.ai/v1/systemone`.
- **Model:** pinned to `jev-1.13.0`, the version the thresholds were measured on. Moving to a newer version means re-measuring first.
- **State:** `{ book: { title, author, edition_languages, publishers, synopsis } }`.
  - Missing fields are left out.
  - The synopsis is the longest edition or work synopsis, cut to 1,200 characters.
  - Edition years are left out, because reprint years mislead.
- **Question:** one Choice, `genre`. The options are the 26 `BOOK_GENRES` plus `none` ("no genre fits, or the book cannot be identified"), with the descriptions used in the 2026-10-14 test. The Romance option says it is only for love stories, and that Portuguese "romance" means novel.

### Judgments and the save rule

Every answer is stored as a judgment in the catalog: work id, model, genre (null for `none`), confidence, and when it was asked.

After each run, every judgment with a genre and confidence ≥ 0.5 is applied:
- The genre is written to each edition of the work and its merged aliases whose `genres` is still `'[]'`, with `genres_source = 'jev'`.
- Applying is idempotent.
- The 0.5 save line and the 0.8 confident line are code constants. Changing either takes effect on the next run without re-asking Jev.

`books.genres_source` records where an edition's genres came from:
- `null`: Open Library, ISBNdb or search. Jev and the manual pass never overwrite these.
- `'jev'`: a later Open Library or ISBNdb answer replaces these. `saveDetails` fills editions whose genres are `'[]'` or from Jev, and sets the source back to `null`.
- `'manual'`

Precedence: sources and manual labels beat Jev, and neither overwrites the other.

### Schedule, limits and failures

The job runs with the other catalog backfills: once at boot and every 10 minutes, up to 50 works per run, at most 4 requests in flight.

Failures:
- **429 or 529:** retried with exponential backoff. If it keeps failing, the run ends.
- **401 or 422:** the run stops and reports through the books plugin's existing `alert`, like the ISBNdb key failure.
- **Network errors and timeouts:** they end the run.
- **Nothing is stored for a failed request.** The next run asks again.

Worst case is about 7,200 works a day, which is cents.

### Key

`TYPESAFE_API_KEY` is optional, like `ISBNDB_API_KEY`:
- declared in `config/env.ts`;
- marked `preserve()` in `.railway/railway.ts`;
- a `typesafeConfigured` flag starts the job only when it is set.

Only book metadata is sent: title, author, edition languages, publishers and synopsis. Nothing about users.

## 3. Possible genres

A genre is possible when every edition carrying it got it from a Jev judgment with confidence below 0.8.

- **Work page:** `GET /works/:id` → `WorkPage.work` keeps `genres` for the rest and gains `possibleGenres: string[]`. The two together are capped at 3, with confident genres first.
- **Book screen:** `bookScreenModel` (`@scripta/shared`) passes `possibleGenres` through. Both clients render them after the genres, as "Possibly {genre}".
- **Everywhere else** (reader card, dial, shelf theme, re-check on load), possible genres count like any other genre.

## 4. Manual genre pass

The manual genre pass is a repeatable procedure run by the owner, documented in `backend/README.md` under "Genre pass". The selection and fill logic live in module code with tests. The two scripts only parse arguments, open the databases and print.

### Export

`backend/scripts/genre-pass-export.mjs` is read-only and runs in the container over `railway ssh`. It selects works held by at least one library that either:
- have no genres; or
- have only possible genres, so they await review.

It prints JSON between `---BEGIN---` and `---END---` markers. For each work:
- work id, title and author;
- up to 4 distinct editions (title, language, ISBN, publisher, year);
- the longest synopsis, cut to 1,200 characters;
- whether anyone finished it, and how many libraries hold it;
- Jev's judgment (genre and confidence), when there is one.

It includes no user ids.

### Classify

Classification happens in a Claude session. Each work gets a main genre and up to two more from `BOOK_GENRES`, or none.
- **Romance** only when a love story is the book's main thrust. Portuguese "romance" means *novel*.
- **Classics** for canonical older works. **Literary Fiction** for other literary novels.
- **Historical Fiction**, not Biography & Memoir, for novels about real historical figures. This was Jev's most common confident mistake.
- **None** when no genre in the list fits (pets, art books) or the book is unknown. No guessing from the title alone.
- The owner reviews low-confidence, no-fit and unknown rows, and rows where Claude disagrees with Jev, before importing.

The labels file is a JSON array of `{ workId, genres }`, main genre first.

### Import

`backend/scripts/genre-pass-import.mjs <labels.json>` runs in the container.
- **Validation:** if any genre is not in `BOOK_GENRES`, or any work id is not in the catalog, it rejects the whole file and writes nothing.
- **Fill:** for each work, it writes the genres with `genres_source = 'manual'` to every edition of the work and its merged aliases whose genres are `'[]'`, from Jev, or from an earlier manual pass. A later pass can therefore correct an earlier one. It never overwrites genres from Open Library, ISBNdb or search.
- **Output:** it writes in one transaction, and prints how many works and editions it filled and which works it skipped.

### First pass

The first pass uses the 2026-10-14 export (142 works) with Claude's labels: 125 confident, 12 low-confidence, 3 no-fit, 2 unknown. The owner judges the 18 works where Jev disagreed.

## 5. Portuguese subject words

`normalizeBookGenres` folds accents and case and turns punctuation into spaces, so the additions are plain ASCII. `(s)` marks an optional plural.

| Genre | Adds |
|---|---|
| Science Fiction | ficcao cientifica |
| Historical Fiction | ficcao historica, romance(s) historico(s) |
| Literary Fiction | ficcao literaria |
| Classics | classico(s) |
| Biography & Memoir | biografia(s), autobiografia(s), memorias |
| Comics & Graphic Novels | banda desenhada, quadrinhos |
| Young Adult | juvenil, jovens adultos |
| Children's | infantil, infantis |
| Fantasy | fantasia |
| Mystery | policial, policiais, misterio(s), romance(s) policial / policiais |
| Thriller | suspenses |
| Horror | terror |
| Crime | crimes |
| History | historia (singular only) |
| Philosophy | filosofia |
| Psychology | psicologia |
| Technology | tecnologia, informatica |
| Science | ciencia(s), fisica, quimica, biologia, astronomia |
| Business | economia, gestao, financas, negocios, empreendedorismo |
| Self-Help | autoajuda, auto ajuda, desenvolvimento pessoal |
| Poetry | poesia, poema(s) |
| Religion | religiao, teologia, espiritualidade |
| Travel | viagem, viagens |
| Cooking | culinaria, receitas, gastronomia |

Matching order and edge cases:
- "romance historico" and "romance policial" are matched before the bare `romance` rule.
- A bare "romance" stays Romance, so every canonical genre name still maps to itself.
- "historias" (stories) maps to nothing.

These words reach books through imports (Goodreads shelves, StoryGraph and CSV tags) and through Open Library and ISBNdb subjects. Stored `_genres` and catalog `genres` only ever hold canonical names, so nothing already stored changes.

## Error handling

- **No new catch on the server.** `genres` and `possibleGenres` read the same catalog connection `works` reads, so a database failure fails the request as it already does for `works`. `worksOf` catches only `WorkResolutionError`, which these reads cannot throw.
- **Jev failures** follow section 2. They never write genres, and they never store a judgment.
- **Client saves:** the catalog-genre save goes through `updateLibrary`, which already retries a 409 once. A failed save stops the hook, like a failed enrichment save today.
- **The import** validates the whole file before writing, and writes in one transaction.

## Testing

- **`withCatalogGenres`:**
  - fills books with no genres and marks them;
  - refreshes marked books whose catalog genres changed;
  - leaves unmarked books with genres of their own unchanged;
  - ignores empty catalog entries;
  - returns the same object when nothing applies.
- **Portuguese rules:**
  - table-driven cases from the table above;
  - every `BOOK_GENRES` name maps to itself;
  - "romance" → Romance; "romance histórico" → Historical Fiction; "romance policial" → Mystery; "histórias" → nothing.
- **Jev adapter:**
  - the request has the pinned model, the Bearer key, one Choice with 27 options, and the state fields;
  - `none` maps to null;
  - 429 and 529 retry, then fail;
  - 401 and 422 fail without retrying.
- **Jev job:**
  - selects held works with no genres, a finished details lookup, and no judgment;
  - stores every answer;
  - applies only judgments of 0.5 and above, to empty editions and merged aliases, with `genres_source = 'jev'`;
  - never re-asks a judged work;
  - doesn't start without the key;
  - a failed request stores nothing.
- **Possible genres:**
  - a Jev genre below 0.8 is possible, and at 0.8 or above it is a normal genre;
  - Open Library, ISBNdb, search and manual genres are never possible;
  - the cap of 3 keeps confident genres first;
  - the library envelope includes possible genres.
- **Export selection:** returns held works that have no genres or only possible genres, with Jev's judgment attached.
- **Import:**
  - rejects unknown genres and unknown work ids without writing;
  - fills empty, Jev and earlier manual editions, including merged aliases, with `genres_source = 'manual'`;
  - never overwrites Open Library, ISBNdb or search genres.
- **`saveDetails`:** replaces Jev genres and clears their source, and never touches manual genres.
- **Book screen model:** possible genres pass through separately from genres.
- **Clients:**
  - the enrichment hook saves catalog genres once;
  - both book screens render "Possibly {genre}";
  - covered on both clients, plus a device pass on mobile.

## Rollout

1. Merge. Deploy the backend and web, and publish the mobile OTA by hand (EAS CI minutes return 11-01). `TYPESAFE_API_KEY` is still unset, so the job is off.
2. The owner reviews the first-pass labels and the 18 disagreements, then runs the import.
3. The owner creates a fresh TypeSafe key, because the current one passed through a chat transcript, and sets `TYPESAFE_API_KEY` in Railway. The job starts on the next deploy or restart and handles every later import.
4. **Check:** rerun the 2026-10-14 count. Books "needing classification" should be near zero apart from Jev's below-0.5 answers. A new library's genres should appear within about 20 minutes of import, on the owner's next load.

Success:
- Once the largest library loads after the import, about 104 of its 107 finished books have genres, up from 25.
- A newly imported, mostly Portuguese library gets a genre for about 9 in 10 books without a manual step. That is the 92% of the 2026-10-14 sample with confidence of 0.5 or above.
