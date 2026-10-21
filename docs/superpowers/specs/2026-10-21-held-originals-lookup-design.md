# Fetching missing originals for books on shelves

## Problem

The translation job joins a Portuguese work to its original's work, but only when the original is already in the catalog. On 2026-10-20, 241 works sat on readers' shelves (`library_books`), and 60 of them carried an original title that matched no work in the catalog. Those translations stand alone.

The user chose to fetch the missing originals rather than group translations by original title, because for many series the "original title" is really the series name. Shelved books come first because they are few and visible.

## Decisions (user, 2026-10-20)

- **Scope:** only works on readers' shelves.
- **Lookup:** Open Library, by original title and author, one call per second. No ISBNdb.
- **Join:** add the original to the catalog, then the translation job's free code step joins it, with the checks it already runs.
- **The #317 guards must hold.** Fetching an original for a series name would recreate the collapses that 65 undos just repaired.
- **Not now:** extending the lookup to all ~41k distinct originals (about 11.5 h).

## Design

A script, `backend/scripts/fetch-originals.mjs`, with a dry run. Its logic is in `backend/src/modules/books/seed/originalsFill.ts`.

### Selection

1. **Works:** held works (`createWorkHolders(...).heldWorks()`), made canonical, then `portugueseWorksNeedingMatch(held, all, JEV_REJECTION_LIMIT, now)`. That gives every live Portuguese work that is unjudged or has a "none" answer from code or Jev. An owner's `manual` answer stays final, as it does for `--recheck-none`, so works the series repair undid are never selected.
2. **Original title:** the one `planMatch` would use (`evidenceOf(translationEvidence(id)).originalTitle`, which falls back to the summary's "Título original"). The work is skipped when there is none, when `originalKey` of it is null, or when it equals the work's own title (the work is itself an original).
3. **Guard 1:** skipped when `seriesLikeOriginals(repo.originalTitleClaims())` flags the original, called exactly as `planMatch` calls it (`original`, `workAuthor || author`). No lookup is made.
4. **Guard 2:** skipped when the edition's title or the original title has a volume marker (`hasVolumeMarker`). The code step can never join a volume, so fetching for one would only hand Jev a candidate. That candidate is most likely a series name.
5. **Missing:** a work is not looked up when `titleCandidates(titlePattern(original))` finds any work other than itself. Its original is already there, so it is counted as `present`.
   - It goes to the code step in a real run only when one of those candidates carries the whole original title (`sameWholeTitle`, the pick rule's title check, below). Those works are listed in `presentWorks`, in the dry run as well.
   - The pattern drops a colon subtitle, so a held "Dune: Messiah" finds "Dune". Without the whole-title check the code step would join the sequel into it.
6. **Author:** skipped when `surnameOf(workAuthor || author)` is null.

Works left are grouped by `originalKey(original)` plus surname, so two shelved copies of one translation share one lookup.

7. **Shared original:** a group is skipped when two or more distinct Portuguese main titles in the whole catalog claim its original for its surname. That is Guard 1's grouping over `repo.originalTitleClaims()`, but at two titles instead of three, and only for the fetch.
   - Titles are told apart by `normalizeWords`, the whole title, not by `originalKey`, which drops a colon subtitle. That way "Crónicas: Aurora" and "Crónicas: Crepúsculo" count as two.
   - Two different Portuguese books naming one original are either two re-translations of a classic or two volumes under a series name, and the fill can't tell which.
   - Guard 1 only stops the second case at three titles. Below that, a fetched original would also let a later backlog run join the unshelved volume into it.
   - The cost: a classic with two differently titled Portuguese translations isn't fetched.
   - The count is local to the fill because `domain/translation.ts` is being changed by another session; exporting a shared grouping helper can follow.

### Lookup

One fielded Open Library search per group: `search.json?title=<main original title>&author=<first author>`, through a script-owned `createThrottle(1000)`. The series-in-search spec already allows one request per second from a script beside the server's.

The first document that passes all of these is the original:
- it has a `/works/OL…W` key;
- its whole title has the same `normalizeWords`, `normalizeTitle` and `titleNumbers` as `mainTitle(original)`:
  - `normalizeTitle` and `titleNumbers` are what the code step's `titlePattern(original)` matches against the new row's `title_key`;
  - `normalizeWords` makes a colon subtitle count, since `normalizeTitle` cuts at `":"`. Without it, "Dune" would pass for "Dune: Messiah", and "Fairy Oak: Il segreto delle gemelle" would pass for the bare series name "Fairy Oak";
- `doc.title` has no volume marker;
- one of its `author_name` values has a `surnameOf` that the Portuguese work's author or work author mentions (`mentionsSurname`).

The title check uses the whole found title on purpose. `sameMainTitle` cuts at `". "`, so "To the Lighthouse. A Novel" would pass for "To the Lighthouse", but its `title_key` doesn't match the code step's pattern.

`mainTitle` cuts the original at `". "` as well, so an original such as "Mr. Mercedes" is searched as "Mr" and never found. The code step's `titlePattern` has the same limit, so the two stay consistent. Fixing it belongs in the matcher, not here. The title and surname checks together are the ones `planMatch` runs after the insert. A found original therefore becomes the work's only title candidate, and the code step joins it unless an arena blocks the join.

A 5xx or a timeout records the original title in `failed` and moves on. A 429 stops the run, as the held-editions fill does. Every step is safe to re-run: a joined work stops being selected, and so does a work whose original is now present.

### Adding the original

`seedBook({ isbn: "", title: doc.title, author: <matched name>, workKey: doc.key }, repo, now, "seed")`:
- **No ISBN.** A search document's `isbn` list holds every edition in every language, so any one of them could be a translation's.
- **No language**, for the same reason. An edition with no language still counts as a candidate for both of the job's queries.
- **`created_by` `seed`.** Like the ranked-works seed, it is an Open Library work added by a script. It is searchable and goes through the normal details and cover queues.
- **`createBook` joins the work that holds the same OL work key, if any.** If that is the Portuguese work itself, the original lands inside it: already joined.

### Joining

After the lookups, `runCodeSteps(deps, workIds)` runs on two sets of works:
- the works whose original was added;
- the `presentWorks`, whose original is already in the catalog under its whole title.

Right before that call, the ids are filtered through `portugueseWorksNeedingMatch` again. An owner's `manual` answer saved while the lookups ran, or a join the server made meanwhile, takes the work out.

It is the backlog's free step, with both guards and the arena check. A code join replaces the old "none" answer (`INSERT OR REPLACE`). Every join shows under "Merged" on `/admin/translations`, where it can be undone.

Passing the `present` works makes a re-run finish what a killed run started: an original added just before the kill is `present` next time. It also joins a shelved work whose original reached the catalog some other way since its "none" answer.

A work the code step leaves for Jev (`ask`, e.g. two title candidates) keeps its earlier answer. The report lists it. `translation-backlog.mjs --recheck-none` reaches it once that answer is 30 days old.

### Cost

- **Open Library:** one call per group, about a minute for 60 works.
- **Write lock:** `runCodeSteps` first runs `fillOriginalTitlesFromSummaries()` over the whole catalog inside one write transaction, as the backlog does. Run the fill off-peak.
- **ISBNdb:** the script makes no ISBNdb or TypeSafe call. The new rows have no ISBN, so their details never reach ISBNdb. Their covers go through the server's background cover queue, whose ISBNdb title lookups are capped by the non-search budget (`isbndbSpend`, `plugin.ts:74`). That is at most one lookup per new row, out of the same daily 4,800.
- **TypeSafe, afterwards:** a joined original's work is now held, so the server's genre and synopsis jobs judge it once, within their daily budgets.

### Output

The dry run opens the database read-only and makes the same lookups. It prints:
- the counts (`held`, `selected`, `noOriginal`, `seriesLike`, `volume`, `present`, `noAuthor`, `sharedOriginal`, `lookups`, `found`, `notFound`);
- `presentWorks`: the works whose original is already there, which the real run hands to the code step;
- `failed`;
- one entry per group: the original title, the author, the Portuguese works (id and title), and the Open Library work it would add (key, title, author), or null.

That list is what the user reads before the real run. The real run also fills `added`, `existing` and the code step's `codeMerges`, `codeBlocked`, `noCandidates` and `ask`, which stay 0 and empty in the dry run.

## Is the join automatic when an original arrives some other way?

No. `createBook`, the search path (`saveHits`), `findOrCreateBook` and the BNP import call no translation hook. A Portuguese work already judged "none" is selected again only in two cases:
- by `--recheck-none`, 30 days after its answer;
- when `fillIdentity` fills its own empty title or author.

So an original that arrives through a search waits up to 30 days and a manual backlog run. This fill's `present` pass catches shelved works whenever it runs, but nothing does it on arrival. That is a follow-up, not part of this plan.

## Out of scope

- Works not on shelves, and the ~41k distinct originals.
- The `originalTitleIn("Título original:")` → ":" bug. Another session is fixing it. A ":" original has a null `originalKey`, so this fill skips it.
