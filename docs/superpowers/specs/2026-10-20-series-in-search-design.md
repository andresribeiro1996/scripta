# Series names in search

## Why

On 2026-10-20 the user searched "malazan" in the Search tab and got 2 books. The catalog holds most of the Malazan Book of the Fallen, both the English editions and Saída de Emergência's Portuguese ones. But catalog search only matches words in a book's title and author, and only 2 stored titles happen to include "Malazan". The catalog stores no series names at all.

## Goals (user, 2026-10-20)

- **Search matches series names** as well as title and author, so typing "malazan" in the catalog search finds:
  - every book in the Malazan series,
  - any book with "malazan" in its title,
  - any book whose author matches.
- **Ranking:** results stay ranked by how well each matches, as now. A series match sits alongside title and author matches. There is no reading-order sorting.
- **Search results show the series** on a line under the title: "Malazan Book of the Fallen · 1".
- **Publisher collections count as series, but are labelled as collections,** so they don't look like a story: "Bang! collection · 248" (Saída de Emergência's fantasy collection).
- **A book's page shows its series.** Tapping it searches the catalog for that series name.
- **Translations are included** once they are joined to their original's work. *Jardins da Lua* shows for "malazan" once it is part of *Gardens of the Moon*. The translation backlog does that joining; it isn't new work here.

## Non-goals

- A series page listing the books in reading order.
- Sorting results by series position.
- Editing series by hand, or readers suggesting series. That may come later.

## Anti-goals

- **Readers' own Kobo series names must never reach the shared catalog or its search.** The app already promises that one account's library can't surface in another's search (`docs/superpowers/specs/2026-10-13-mobile-search-tab-design.md:177`).
- **A publisher collection must never look like a story series** in results or on the book page.
- **Search must not get slower in a way users notice.** Catalog search runs on every keystroke, debounced (`mobile/src/features/search/SearchScreen.tsx`).
- **Don't rebuild `books_fts`.** It holds about 234k rows, FTS5 can't add a column, and boot is synchronous.

## Constraints

- **Installed apps keep working.** API changes are additive: new optional fields only, and older clients ignore them.
- **Rate limits:**
  - Open Library allows about 1 request per second for the server, plus 1 for a script (`OPEN_LIBRARY_GAP_MS`).
  - ISBNdb has a 4,800-a-day non-search budget. This work should not spend it.
  - Use Wikidata's query service politely: a User-Agent, a few large queries, no hammering.
- **Merges move editions.** Translation, title-key and admin merges and their undos move editions between works, so series data tied to works has to survive merges and undos.

## The how: decided

### Storage (my call)

- **A story series belongs to the work,** so every edition and translation of a book gets it.
- **A publisher collection belongs to the edition it was published in.** "Bang! · 248" is Saída de Emergência's edition, not the English original or another publisher's edition.
- So a work can carry several series entries, and each edition can carry its own collection.

Each entry holds:
- a name;
- a kind, `series` or `collection`;
- a position, which may be empty and is text, since it can be "1", "1.5" or "III";
- its source.

A small separate full-text index holds the series names, so `books_fts` stays as it is. Names from different sources and languages are kept side by side. "Malazan Book of the Fallen" and a Portuguese name would both match their own words.

### Search

Catalog search (`GET /books/search`, with and without `by=work`) returns:
- its current title and author matches, plus
- the editions of works whose series name matches every typed word, with the same rules as today: diacritics ignored, the last word matched as a prefix once it has 3 letters.

Results are grouped by kind of match, and each group keeps its own match-quality order (my call). The groups come in this order: title and author matches as today, then story-series matches, then collection matches. Scores from different indexes can't be compared, so the groups are not mixed. A book found both ways appears once, in its first group. A series name is matched together with its work's author, so "malazan erikson" finds the series too.

A collection-name match ranks below title, author and series matches (my call). The national library gives about 155k books a collection, and generic names ("Clássicos", "Romance", "Obras de …") must not crowd real title hits out of the caps.

With `by=work` the Search tab keeps one row per work, as today, for collection matches too. A work the reader owns that is found by series or collection stays in the catalog results when the reader's library section didn't list it, so it never disappears. The Portuguese editions joined to a work show through that row and the work's edition strip, not as rows of their own. The existing caps hold: 12 editions, or 20 works with `by=work`. Outside search (ISBNdb and Open Library) is unchanged.

### Results and the book page

- Each search result and each work page carries the work's series as an optional field (`name`, `kind`, `position`).
- Search results show the entry that matched the query: a collection match shows its collection, and a title or series match shows the story series, falling back to the edition's collection. The book page shows at most one entry (my call):
    1. the work's best story series by source priority;
  2. otherwise the shown edition's collection.
- **Format:** "Name · 3" for a series, and "Name collection · 248" for a collection. When there's no position, just the name, or "Name collection". A collection whose name already says "collection", "coleção" or "colecção" isn't given the word twice.
- **Where:**
  - the mobile Search tab row,
  - the mobile Add Book form's result rows,
  - the web Add Book modal's result rows,
  - the mobile and web book pages.
- **On the book page,** tapping the series line opens catalog search with the series name as the query. That works in the signed-in mobile app (the Search tab). On the web and the public, signed-out work pages, the line is plain text, because there is no catalog search page there (my call).

### Sources

All are free, and all already flow through the app or have been checked:

1. **Wikidata** has "part of the series" (P179) with the position as a qualifier (P1545). It is joined to the catalog only by ISBN (P212/P957 on the work or its editions) or by Open Library work ID (P648), never by title and author alone (my call). A wrong series line shows to every user, and this week's wrong translation joins came from loose matching. Measured on 2026-10-20: about 13.8k series works carry an Open Library ID, and about 18k ISBN pairs exist. All 10 Malazan books are there, in order. Wikidata can hold more than one Open Library ID for a book, because Open Library has duplicate works, so match on any of them.
2. **The Open Library edition record** has a `series` field. It can be a story series, such as "Malazan Book of the Fallen (3)", which gives a name and a position, or a publisher series, such as "Penguin classics". So it is stored as that edition's collection. It becomes the work's story series only when Wikidata or an Open Library `series:` subject gives the same name (my call). The app already fetches these records in the work-key lookup (`openLibraryCatalog.ts` `fetchEditionRecord`) and drops the field. Capture it from now on.
3. **Open Library subjects** include tags like "series:Malazan Book of the Fallen". The app already reads subjects for genres and search hits; capture the series tag there.
4. **The national library's UNIMARC 225** gives the collection name in `$a` and the number in `$v`, for example "Bang!" and 248. That makes it a `collection`. Capture it in the BNP mapper, so the daily sync and the per-ISBN lookup fill it from now on.
5. **The series-like original titles** from the 2026-10-20 translation guard. These are written only after review, because a classic translated three times under different Portuguese titles looks the same (my call). The fill lists the candidates, a review approves them, as with the series-join repair, and only the approved list is written. The candidates are: 200 groups such as *Princess Poppy*, *CHERUB*, *Isadora Moon* and *Diary of a Wimpy Kid*. They give a `series` with no position, on the works of the editions that claim them.

**Source priority for which series to show** (my call): Wikidata, then the Open Library edition record, then the Open Library subject, then the series-like original title. Collections are ranked on their own, and the national library is their only source for now.

### One-off fills on production

- **Wikidata:** a bulk pull, plus matching against the catalog.
- **National library 225 collections:** a pass over the national library records already imported. Re-harvesting the OAI set without downloading scans took about 1h20 for the dry run.
- **Series-like original titles:** from the claims the guard already reads.
- **Open Library edition records:** fetched again only for works on readers' shelves (241 on 2026-10-20). Fetching them for the whole catalog would take days at 1 per second. From then on, the work-key lookup fills the rest as it runs.

## Left to the builder

- Table and index names. How series rows follow merges and undos: carry them to the target on merge and back on undo, or derive them per edition and roll up per work.
- How exactly a series match and a title match share one ranking.
- Parsing details, such as "Name (3)", "Name #3", "Name, Book Three", and the many forms 225 `$v` takes.
- Whether Wikidata becomes a recurring job or stays a one-off, and how often it refreshes.
- Whether to census publisher feeds for series tags (Presença's `SERIE_…`/`COLECAO_…` tags) and add them as a source.
- The order the work lands in, as long as each step is useful on its own: search plus storage first, then sources one at a time.

## Done looks like

On production, typing "malazan" in the Search tab lists:
- the Malazan books the catalog has, one row per book, each with "Malazan Book of the Fallen · N" under its title, where Wikidata or Open Library gives the series;
- the Portuguese editions joined to those books, shown through the row and its edition strip.

Typing "bang" lists the Bang! collection's books labelled "Bang! collection · N". A book's page shows its series, and tapping it runs that search.
