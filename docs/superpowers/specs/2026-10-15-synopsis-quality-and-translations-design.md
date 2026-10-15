# Synopsis quality and translation grouping — design

Builds on catalog genres (`2026-10-14-catalog-genres-design.md`) and on two specs on branch `claude/genre-review`: genre review and catalog genre backfill (`2026-10-15-genre-review-design.md`, `2026-10-15-catalog-genre-backfill-design.md`). It reuses their TypeSafe budget, work queue, details hook and admin layout, and builds after them.

## Goal

Fix two catalog problems, following the owner's rule for this work: **code first, Claude calibrates, Jev does the job.**

1. **Synopses that aren't synopses.** Some stored summaries are praise quotes, author biographies, product text or fragments such as "Text: Portugese". Readers see them as the book's synopsis.
2. **Translations in their own work.** A Portuguese edition often sits in a work of its own instead of with its original. *Passeio ao Farol* is apart from *To the Lighthouse*, and *O Meu Pé de Laranja Lima* from *My Sweet Orange Tree*. The edition strip, readers and genres don't join up.

Production on 2026-10-15:
- 77,927 editions in 77,343 works.
- 18,333 Portuguese editions have no Open Library work key, and 17,788 of those have no author either.
- 4,578 summaries contain "Título original". The publisher feed drops that line from the synopses it parses today, but older rows and some layouts kept it.
- Summaries by source: publisher 19,794, ISBNdb 235, Open Library 2, none 46.

This covers two kinds of work:
- **The catalog backlog.** Owner-run scripts, the same shape as the genre backfill: code rules, then Jev up to `--max`, after Claude has calibrated Jev's thresholds on a labelled production sample.
- **New books** from imports and add-book. When a held book's details lookup finishes, a book whose synopsis or work isn't settled yet is queued, and Jev answers in the background. A daily sweep catches misses. Nothing waits inside a request.

## Non-goals

- **Genres, in every form.** That includes the shelf and tag vocabulary in `normalizeBookGenres`, which went to the genre work.
- **Repairing garbled titles** such as "fÃ©" and "N©o". Separate task.
- **Other languages.** Only Portuguese editions are grouped. Open Library's `translation_of` field isn't used.
- **Replacing a hidden synopsis** with one from another source.
- **Demand, tone and pace scores.** They were measured on 2026-10-15, but nothing uses them yet.
- **Mobile admin UI.** The pages are web-only, like the genre review.

## Decisions

1. **Code first, Claude calibrates, Jev does the job.** Claude labels samples to set and check thresholds. It doesn't judge the backlog itself. Doubts go to a review page, not to a Claude pass.
2. **Synopsis judgments are keyed by the text**: a hash of it, not the book. A text reused on several editions is judged once, and a changed text is judged again.
3. **Keyed works may merge, for translations only.** This narrows Decision 3 of the keyless-works design ("Keyed works never merge"). Open Library stays the authority over its own keys: lookups by key follow the merge to the original.
4. **Every merge is recorded**, and translation merges can be undone.

## Data model (`covers.sqlite`)

```
books  + summary_hash    TEXT   -- SHA-1 of the summary, NULL when there is none
       + original_title  TEXT   -- from the publisher feed or the summary text
works  + summary_hash    TEXT

synopsis_judgments(text_hash TEXT PRIMARY KEY, model TEXT NOT NULL, usable REAL NOT NULL,
                   kind TEXT NOT NULL, asked_at TEXT NOT NULL)
work_match_judgments(work_id TEXT PRIMARY KEY, model TEXT NOT NULL, into_work_id TEXT,
                     confidence REAL, asked_at TEXT NOT NULL)
work_merges(id INTEGER PRIMARY KEY, from_work TEXT NOT NULL, into_work TEXT NOT NULL,
            source TEXT NOT NULL, confidence REAL, moved_book_ids TEXT NOT NULL,
            repointed_work_ids TEXT NOT NULL, merged_at TEXT NOT NULL, undone_at TEXT)
jev_rejections(task TEXT, subject TEXT, status INTEGER, reason TEXT NOT NULL,
               attempts INTEGER NOT NULL, last_at TEXT NOT NULL, PRIMARY KEY (task, subject))
```

- **The hash** is the SHA-1 hex of the text, trimmed, with runs of whitespace collapsed to one space. It's written with the summary in `mergeDetails` and `setWorkSummary`, and copied when a work summary is carried. Existing rows are hashed at boot, in pages of 1,000. `books.summary_hash` and `works.summary_hash` are indexed.
- **`model`** is `rule`, `code`, `manual`, or the Jev version that answered (`jev-1.13.0`).
- **`work_match_judgments.into_work_id`** is NULL for "none", for a Portuguese original, and for "no candidates".
- **`work_merges.source`** is `title-key`, `admin`, `code`, `jev` or `manual`. The two id lists are JSON arrays.
- **`jev_rejections.task`** is `synopses` (subject: the text hash) or `works` (subject: the work id). The genre review's `genre_rejections` stays genre-only.

### TypeSafe budget

All usage goes through the genre review's `typesafe_usage(day, source, requests)`, `dailySpend` and `runBudget`:

| Source | Limit | Used by |
|---|---|---|
| `synopses` | 1,000 a day | synopsis queue and sweep |
| `synopses-backlog` | the run's `--max` | `synopsis-backlog.mjs` |
| `works` | 1,000 a day | translation queue and sweep |
| `works-backlog` | the run's `--max` | `translation-backlog.mjs` |

## A. Synopsis quality

### Which texts

Every non-empty `books.summary` and `works.summary`, from any source.

### The rule (code)

A text with fewer than 40 letters (`\p{L}`) is a fragment. It's stored as `model = 'rule'`, `usable = 0`, `kind = 'fragment'`, with no TypeSafe request. More rules are added only when a calibration sample shows a pattern code catches at the hiding bar (section D).

### The Jev request

One request per text, with two questions over `{ book: { title, author }, text }`:
- a yes/no: is the text a description of the book's content?
- a choice of kind: synopsis, author biography, praise, collection, product, contents, other book or fragment.

The wording is in Appendix A. The text is cut to 2,500 characters. The first book or work carrying the text gives the title and author. The answer is stored as `usable` (the yes probability) and `kind`.

### What readers see

A text is **hidden** when its judgment is:
- `rule`;
- `manual` with `usable = 0`;
- Jev with `usable` below **0.3** (`SYNOPSIS_HIDE_BELOW`).

It's **shown** otherwise. That includes Jev answers from 0.3 up to 0.5 (`SYNOPSIS_REVIEW_BELOW`), which are listed for review, and text with no judgment yet.

A hidden text is skipped wherever the server picks a summary:
- **Book details** (`detailsOf`): a hidden `books.summary` counts as absent, so `workSummaryOf` may supply the work's summary under its existing language check. A hidden work summary isn't used.
- **Work page** (`getPage`): the order becomes the reader's own edition, then the work summary, then the first edition with a summary. Each step skips hidden text. Today the work summary comes first; part B needs the change.

Nothing is deleted. A manual Keep shows the text again.

### Triggers

- **New books.** A listener on the genre review's `onDetailsChecked(book)` adds a text to a synopsis queue (`createWorkQueue`, keyed by hash) when all of these hold:
  - the book's work is held (`heldWorks`);
  - the book's summary or its work's summary has a hash with no judgment;
  - the hash has fewer than 3 strikes.

  A queue run applies the rule first. Only text the rule passes spends from `synopses` and goes to Jev.
- **Daily sweep:** held works' texts with no judgment and fewer than 3 strikes, fed through the same queue.

The listener and queue start only when `TYPESAFE_API_KEY` is set. Without the key, new texts wait for the next backlog run, whose rule pass needs no key.

### Backlog script

`backend/scripts/synopsis-backlog.mjs --max N [--dry-run]`, run by the owner over `railway ssh`, like the genre backlog:

- **Selection:** every hash on `books` or `works` with no judgment and fewer than 3 strikes. Held works first, then oldest first.
- **Order:** the rule pass first, with no requests. Then Jev for the rest, 4 in flight, spending from `synopses-backlog`.
- **`--max`** is required. It's the run's hard limit on HTTP requests, retries included.
- **Dry run:** prints the counts per summary source and how many texts the rule would catch. It writes nothing and makes no requests.
- **Report:** per summary source:
  - texts judged;
  - hidden by the rule;
  - hidden by Jev;
  - doubtful (0.3–0.5);
  - shown.

  Then strikes, outages, requests used and estimated cost.
- **`TYPESAFE_API_KEY` is needed only for the Jev pass.** Without it, the script runs the rule pass, reports that the Jev pass was skipped, and exits.

## B. Translation grouping

### Which works

Live works (`merged_into IS NULL`) whose editions all have a Portuguese `language` (`pt`, `pt-PT` or `pt-BR`), and that have no `work_match_judgments` row.

A work's evidence comes from its editions, oldest first: the first non-empty original title, author, publisher and summary. "The work's author" below means `works.author`.

### Original titles (code)

- **Publisher feed.** `ProductDetails` gains `originalTitle`, the value of a "Título original" line or WooCommerce attribute. The line still stays out of the synopsis. The importer writes it to `books.original_title` when that is empty.
- **Stored summaries.** The value after `T[íi]tulo original` (an optional `:`, `-`, `–` or `—`, then to the end of the line) fills an empty `original_title`. The backlog script does this for all rows, and a queue run does it for the work it handles.
- **Main title.** The text before the first `" — "`, `" – "`, `" - "` or `". "`. Titles are compared the catalog's way: `normalizeTitle` plus `titleNumbers`.
- **A Portuguese original.** When the main original title equals the edition's own title, the work is an original, not a translation. It's stored as `model = 'code'`, `into_work_id = NULL`, and nothing more is done.

### Candidates (code)

Other live works, the work's own excluded:

1. **Title:** a work with an edition whose main title equals the main original title.
2. **Author:** a work whose first author (`firstAuthor`, with accents removed) equals the work's, and that has at least one edition whose language isn't Portuguese. A NULL language counts as not Portuguese.

At most 40: title candidates first, then author candidates with the most editions first.

A work with neither an original title nor an author has no candidates. It's stored as `model = 'code'`, `into_work_id = NULL`. Most of the 17,788 Portuguese editions with no key and no author fall here until a source for their original title exists.

### The code match

A match is settled without TypeSafe when both hold:
- exactly one title candidate exists;
- that candidate's author surname appears, as a whole word with accents removed, in the work's author or in any of its editions' summaries. The surname is the last word of three or more letters in the candidate's first author.

It's merged as source `code` (see "Merging safely").

### The Jev request

When code doesn't settle and there are candidates, one choice question goes to Jev:
- the candidates as options, each "Title — Author (earliest edition YEAR)", plus "none";
- state: `{ edition: { title, author, original_title, publisher, description } }`, with the description cut to 500 characters.

The wording is in Appendix A.

| Answer | Result |
|---|---|
| A work, confidence 0.9 or more (`MATCH_MERGE_AT`) | merge as source `jev` |
| A work, 0.5 (`MATCH_REVIEW_AT`) up to 0.9 | listed for review as `possible` |
| "none", or below 0.5 | nothing |

Every answer is stored in `work_match_judgments`, with the chosen work in `into_work_id` (NULL for "none"), so a work is never asked twice.

### Merging safely

1. **Keyed works may merge.**
   - `mergeWorks` gains an option that accepts a source work with an Open Library key. Only this feature passes it: the code match, the Jev merge, and the review page's Merge.
   - The existing admin route (`POST /books/works/merge`) keeps refusing keyed works.
2. **Lookups by key follow merges.** The work-by-key lookup becomes `SELECT COALESCE(merged_into, id) AS id FROM works WHERE ol_work_key = ?`. All its users pick that up: `createBook`, `giveWork` and `setWorkKey`. A new edition carrying a merged work's key lands on the original, not on the merged-away work. The merged work keeps its key.
3. **No summary carried over.** A translation merge doesn't copy the Portuguese work's summary into the original's empty one. The work page order (part A) keeps Portuguese readers on their own edition's synopsis.
4. **Arena check.**
   - **Before any merge this feature makes**, an injected port asks the arena module whether a tournament holds both works or any of their aliases: `worksShareAnArena(a, b)`, one query over the indexed `tournament_slots.work_id`.
   - **If one does,** nothing merges. The pair goes to review as `blocked`, because merging would turn that duel into one book against itself.
   - **The scripts** open the arena database read-only for the same check.
5. **Merge record.**
   - `mergeInto` writes a `work_merges` row for every merge it makes: the daily title-key grouping, the admin route, and this feature.
   - The row records the editions it moved and the works it repointed.
   - It's written in the same transaction as the merge.
6. **Undo** (review page, sources `code`, `jev` and `manual`) works while `from` is still merged into `into`. In one transaction it:
   - clears `from.merged_into`;
   - moves back the recorded editions still on `into`, and any edition on `into` carrying `from`'s Open Library key;
   - points the recorded works back at `from`;
   - sets `undone_at`;
   - stores a `manual` judgment with `into_work_id = NULL`, so the pair isn't merged again.

   Title and author blanks the merge filled on `into` stay filled.
7. **Nothing else to recompute.** The edition strip, genres (the union of the editions' genres), readers and the games all resolve the canonical work when read. `library_books.work_id` is left as stored.

### Triggers

- **New books.** A listener on `onDetailsChecked(book)` handles a book with a Portuguese language whose work is held, has no `work_match_judgments` row and has fewer than 3 strikes. It adds the work to a translation queue (`createWorkQueue`).

  A queue run does three things in order:
  1. fills `original_title` from the summary;
  2. runs the code steps (Portuguese original, candidates, code match);
  3. only if those don't settle it and there are candidates, spends from `works` and asks Jev.
- **Daily sweep:** held Portuguese works with no judgment and fewer than 3 strikes, through the same queue.

Like part A, they start only when `TYPESAFE_API_KEY` is set.

### Backlog script

`backend/scripts/translation-backlog.mjs --max N [--dry-run] [--recheck-none]`, run by the owner:

1. **Original titles:** fills `original_title` from stored summaries.
2. **Code steps** for every Portuguese work in scope: Portuguese originals, no-candidate works and code merges. No requests.
3. **Jev** for the rest, held works first, then oldest first. 4 in flight, spending from `works-backlog`, stopping at `--max`.

- **`--recheck-none`** also selects works whose judgment has `into_work_id = NULL`, isn't `manual`, and was stored more than 30 days ago. Their original may have arrived since.
- **Dry run:** prints the count at each step, including the merges code would make and how many works would go to Jev. It writes nothing and makes no requests.
- **Report:**
  - original titles found;
  - Portuguese originals;
  - code merges;
  - merges blocked by an arena;
  - Jev merges, `possible` and none;
  - strikes, outages, requests used and estimated cost.
- **`TYPESAFE_API_KEY` is needed only for step 3.** Without it, the script runs steps 1 and 2, reports that the Jev step was skipped, and exits.

## C. Review pages

### Shared, as in the genre review

- Web only, admin-only. A non-admin sees the not-found page.
- Links in `AdminLinks`, beside "Genre review".
- **Endpoints:**
  - `authGuard`, then `isAdmin`, and 403 for anyone else;
  - the review routes' 300-a-minute rate-limit scope.
- **Lists:**
  - books someone finished first, then by number of holders, then by title;
  - at most 200 items, with `total` counting every listed item before the cap.
- **Rows:** a row leaves the list when its action succeeds. A failed action shows its error on the row and keeps it.
- **Privacy:** no user ids in any response.
- **Answers:**
  - 200 with what changed;
  - 400 for a body that doesn't match;
  - 404 for an unknown hash or work;
  - 403 for a non-admin;
  - 409 when a merge or undo no longer applies.

### `/admin/synopses`

`GET /books/synopsis-review` returns `{ items, total }`. `POST /books/synopsis-review/:hash` takes `{ "decision": "keep" }` or `{ "decision": "hide" }`, stored as a `manual` judgment with `usable` 1 or 0. A manual text is never listed again.

| Group | Condition | Evidence shown |
|---|---|---|
| `hidden` | `rule`, or Jev `usable` below 0.3 | "Rule: under 40 letters", "Jev: praise (0.12)" |
| `doubtful` | Jev `usable` from 0.3 up to 0.5 | "Jev: author bio (0.41)" |

Each item:
- the hash;
- the first book carrying the text (title, author, cover) and how many editions and works carry it;
- the summary source;
- the text, cut to 600 characters;
- holders, and whether anyone finished it.

### `/admin/translations`

`GET /books/translation-review` returns `{ items, total }`. `POST /books/translation-review/:workId` takes exactly one of these bodies:

| Body | Effect |
|---|---|
| `{ "merge": "<intoWorkId>" }` | merges as source `manual`, through "Merging safely" with the arena check (409 if blocked) |
| `{ "reject": true }` | stores a `manual` judgment with `into_work_id = NULL` |
| `{ "undo": true }` | undoes the work's latest live merge (409 if it no longer applies) |

| Group | Condition | Actions |
|---|---|---|
| `possible` | a live work whose judgment is Jev's, with `into_work_id` set and confidence from 0.5 up to 0.9 | Merge, Not a translation |
| `blocked` | a live work whose judgment chose a work (model `code`, or Jev at 0.9 or more) and that wasn't merged: the arena check refused it | Not a translation |
| `merged` | `work_merges` rows with source `code`, `jev` or `manual`, not undone, whose `from_work` is still merged into `into_work`; newest first | Undo |

Each item:
- **The Portuguese work:** cover, title, author, original title, synopsis excerpt, holders.
- **The proposed original:** title, author, earliest edition year, and the edition count with its languages.
- **The evidence:** "Jev 0.74", "Code: original title + author surname" or "Both in an arena".

## D. Calibration

### Questions and thresholds live in code

- **Questions:** the exact wording, options and pinned model sit in `adapters/typesafe/jevSynopsis.ts` and `adapters/typesafe/jevWorkMatch.ts`, beside `jevGenres.ts`.
- **Thresholds** are named constants: `SYNOPSIS_HIDE_BELOW = 0.3`, `SYNOPSIS_REVIEW_BELOW = 0.5`, `MATCH_MERGE_AT = 0.9`, `MATCH_REVIEW_AT = 0.5`.

### Starting values: the 2026-10-14/15 measurements

**Synopsis.** 190 summaries (120 Portuguese publisher, 70 Open Library), labelled by Claude Sonnet:

| Jev `usable` below | Flagged | Right when flagged | Bad texts caught |
|---|---|---|---|
| 0.3 | 37 | 37 (100%) | 57% |
| 0.5 | 46 | 45 (98%) | 69% |

On production samples of 60, Jev put 13% of publisher and 22% of ISBNdb summaries below 0.3.

**Matching**, on 394 Portuguese editions with Open Library work keys as the reference:

| | Result |
|---|---|
| Jev at 0.9 or more | 195 of 203 merges right (96%) |
| Jev at 0.9 or more, Open Library duplicate works removed | about 99%. Six of the eight misses were duplicates; one was an omnibus |
| Ranking: Jev vs Sonnet subagents, each trusted on its 175 most confident | tied at 98.8% |
| With the original title in the state | 93% right, against 87% without |

On a production sample, Jev's high-confidence "misses" were mostly Jev finding the original-language work that the catalog keeps apart. The real mistakes were all at 0.89 or below.

### When

- **Once on production, before the first backlog run of each part.** Synopsis accuracy was measured on public data only, and keyless Portuguese editions have no reference answers.
- **Again** whenever the Jev model version or a question's wording changes.

### Procedure

Runbook in `backend/README.md`, beside the genre pass.

1. **Export.** The owner runs `backend/scripts/jev-calibration-export.mjs --task synopses|translations --n 200` over `railway ssh`. It's read-only, catalog fields only, and prints JSON between `---BEGIN---` and `---END---`.
   - `synopses` samples texts by summary source, including texts the rule hid.
   - `translations` samples proposed matches across decision sources (code, and each Jev band), each with its candidates.
2. **Label.** Claude Sonnet subagents label the sample, at most 25 items each, without seeing Jev's answers, using the wording in Appendix A. Never Haiku. A batch whose answers are all, or nearly all, the same is redone before scoring.
3. **Score.** `backend/scripts/jev-calibration-score.mjs --task … sample.json labels.json` asks Jev about each item, storing nothing. It prints precision and coverage for each decision source: rule, code, and each Jev band.
   - The sample and label files are never committed.
   - Reading them needs the owner's narrow allow rule for this script.
4. **Decide.** A threshold changes only through a PR, with the score table in its description.
   - **Bars:** hiding at least 95% right; automatic merging at least 98% right once Open Library duplicate works are removed.
   - **A Jev band that misses** gets a stricter threshold. A threshold is never loosened without a new labelled sample.
   - **A code rule that misses** is removed.

## Error handling

- **Jev failures** are classified with the genre review's `failureKind`:
  - **book:** one attempt in `jev_rejections`; after 3, the subject isn't queued or selected again;
  - **outage:** stores nothing and pauses the queue for 10 minutes;
  - **key:** alerts and pauses for a day;
  - **budget:** `TypesafeBudgetSpentError` pauses until the next UTC midnight.
- **Merges and undos** each run in one transaction with their `work_merges` row. The arena check runs just before. A merge whose preconditions changed (the work was merged or moved meanwhile) throws `WorkMergeError`: a 409 on the page, skipped by jobs and picked up by the next sweep.
- **Hooks never throw into a request.** They only add an id or hash to a queue.
- **No new broad catch.** The scripts stop on an unexpected error and keep pages already committed. Running one again is safe, because judged items are skipped.

## Testing

- **Synopsis:**
  - the 40-letter rule; hash normalisation; a changed text judged again; a reused text judged once;
  - hidden or shown at each threshold, and after Keep and Hide, in both `detailsOf` and `getPage`;
  - the reader's own edition first on the work page;
  - the queue: fed from `onDetailsChecked` for held works only; the sweep; `synopses` usage; strikes.
- **Original titles:**
  - from feed HTML and WooCommerce attributes, using the existing fixtures;
  - from stored summaries;
  - the main-title cut;
  - a Portuguese original is skipped.
- **Candidates and code match:**
  - title and author candidates; the work itself excluded; the cap and its order;
  - the surname check, in author and in summary;
  - no candidates without an original title and an author.
- **Jev mapping:**
  - merge, `possible` and nothing at each threshold;
  - a judgment stops asking again;
  - `--recheck-none` picks only old, non-manual "none" answers.
- **Merge safety:**
  - an edition arriving with a merged work's key lands on the original, through `createBook`, `giveWork` and `setWorkKey`;
  - no summary carried by a translation merge;
  - the arena check blocks;
  - a `work_merges` row for every `mergeInto` caller;
  - the admin route still refuses keyed works.
- **Undo:**
  - restores editions, including later arrivals with the key, and repointed works;
  - stores the manual judgment;
  - answers 409 when stale.
- **Endpoints:** each group's condition; order; the 200 cap with the full total; each action; 400, 403, 404 and 409; no user ids.
- **Web:** each group's evidence; actions remove the row; links show only for the admin.
- **Scripts:**
  - `--dry-run` writes nothing and makes no request;
  - `--max` stops at exactly N requests, retries included;
  - usage is recorded under the backlog sources;
  - the calibration score prints per-source tables from fixture files.
- **UTC days:** day boundaries are tested with `process.env.TZ = "America/Sao_Paulo"`, per the repo's rule for date tests.

## Order of work

1. **After the genre review merges**, since this needs `typesafe.ts`, `createWorkQueue`, `onDetailsChecked`, `heldWorks` and `AdminLinks`.
2. **Plan A, synopsis quality:**
   - data and hashing;
   - the rule and the Jev adapter;
   - what readers see, including the work page order;
   - the queue and sweep;
   - the backlog script;
   - `/admin/synopses`;
   - the calibration export and score scripts for `synopses`.
3. **Plan B, translation grouping:**
   - original titles;
   - candidates and the code match;
   - the Jev adapter;
   - merge safety, the merge record and undo;
   - the arena port;
   - the queue and sweep;
   - the backlog script;
   - `/admin/translations`;
   - the `translations` calibration task.

B relies on A's work page order (own edition first), so A goes first. A is also the smaller plan and fully reversible.

## Rollout

1. Merge each plan's PRs. The owner deploys; new tables and columns are created at boot, and existing summaries are hashed then.
2. **Before each backlog run:**
   - check the volume's free space (`railway volume list --json`);
   - hold merges to main, because a deploy kills `railway ssh` jobs.
3. **Calibrate each part on production**, then change thresholds by PR if a bar is missed.
4. **Synopses:** dry run, then a run with `--max` at the dry run's figure.
5. **Translations:** dry run, then a run.
6. **Work through both review pages.** Check `merged` for anything to undo.
7. **Check:**
   - about 13% of publisher summaries hidden;
   - merges as the report counted;
   - fewer works per edition than today's 77,343 works for 77,927 editions.

## Appendix A — question wording

**Synopsis, yes/no (`usable`):**
- Instructions: "Is `text` a description of the content of the book in `book`: what the book is about (its story, subject or argument)? Answer yes when the text describes this book's content, even if it also mentions the author or awards. Answer no when the text is mainly something else."
- Yes: "The text describes what this book is about, so it can serve as the book's synopsis."
- No: "The text is mainly an author biography, praise quotes or reviews, a description of a series, collection or publisher, product or shop information, a table of contents, a description of a different book, or too short or fragmentary to say what the book is about."

**Synopsis, choice (`kind`):**
- Instructions: "What is `text` mainly? `text` was stored as the description of the book in `book`."
- `synopsis`: "A description of what this book is about: story, subject or argument"
- `author_bio`: "Mainly a biography of the author"
- `praise`: "Mainly praise, review quotes, awards or sales claims"
- `collection`: "Mainly about a series, a collection or the publisher rather than this book"
- `product`: "Product or shop information: format, materials, a non-book item, prices or shipping"
- `contents`: "A table of contents or list of included pieces"
- `other_book`: "A description of a different book"
- `fragment`: "Too short or fragmentary to tell what the book is about"

**Matching, choice:**
- Instructions: "`edition` is a Portuguese-language edition of a book, possibly a translation. Which of the listed works is the work this edition is an edition of? Titles of the works may be in the original language. Pick none when no listed work is the same book."
- This drops "by the same author" from the wording tested on 2026-10-14/15, because title candidates may have another author. The production calibration (section D) measures the new wording before any backlog run.
- Each candidate: "Title — Author (earliest edition YEAR)".
- `none`: "None of the listed works: the edition is a different book from all of them".
