# Genre review — design

Follows catalog genres (`docs/superpowers/specs/2026-10-14-catalog-genres-design.md`, PRs #260 and #261).

## Goal

The Jev genre job gets a daily budget and stops asking about books TypeSafe keeps rejecting. Those books, and the books Jev was unsure about, appear on an admin page where the owner labels them.

Today:
- A book TypeSafe rejects is asked again every 10 minutes, with no limit.
- Nothing caps the job's daily requests. The worst case is about 36,000 requests a day, retries included.
- A 422 pauses the whole job for a day, even when only one book caused it.
- Books Jev answered "none", answered below 0.5, or marked only as possible are reviewed only through the manual genre pass (export, Claude, import).

Three pieces:

1. **Bounding the job:** a daily request budget, and three strikes per book.
2. **Review queue:** an admin-only endpoint that lists the books needing review and applies the owner's decisions.
3. **Admin page:** a web page over that queue.

## Non-goals

- **Mobile.** Mobile has no admin UI, and this adds none.
- **Email.** Rejections are not emailed. The key-rejection alert stays as it is.
- **Replacing the manual genre pass.** The export and import scripts keep working, and share code with the queue.
- **Prioritising whose books Jev asks about first.** The job never runs inside a request, so imports are unaffected. The order stays as it is today.
- **Reviewing source genres.** Genres from Open Library, ISBNdb or search never appear on the page.

## 1. Bounding the job

### Daily budget

- At most 1,000 TypeSafe requests per UTC day. Every HTTP request counts, including retries of 429 and 529. The limit is the code constant `TYPESAFE_DAILY_BUDGET = 1000`.
- A new catalog table `typesafe_usage(day TEXT PRIMARY KEY, requests INTEGER NOT NULL)` holds the count, so a restart doesn't reset it. `day` is the UTC date, `YYYY-MM-DD`.
- The classifier takes the budget before every request. Taking it is one atomic upsert that succeeds only while the day's count is below the limit.
- With no budget left, the classifier throws `GenreBudgetSpentError` without making the request. The job stores nothing for that work. It ends the run, logs once at info level, and returns the next UTC midnight as its pause-until time.
- A spent budget is not a failure. It sends no alert and does not count against the book.

### Three strikes

A failure belongs to the book when TypeSafe answered but the answer can't be used for that book:
- a 4xx status other than 401 and 429;
- an option id the adapter doesn't know, a missing field, or JSON that doesn't parse.

Everything else is an outage and belongs to nobody: 5xx including 529, 429 after its retries, network errors and timeouts.

- A new catalog table `genre_rejections(work_id TEXT PRIMARY KEY, status INTEGER, reason TEXT NOT NULL, attempts INTEGER NOT NULL, last_at TEXT NOT NULL)` records a book's failures. `status` is null for an answer that could not be used.
- Each book failure adds one attempt and replaces the status, reason and time with the latest.
- A work with 3 or more attempts is no longer selected. `GENRE_REJECTION_LIMIT = 3`.
- A book failure does not end the run. The worker records it and moves to the next work.
- An outage ends the run, stores nothing and is rethrown, as today.
- A 401 still alerts and pauses the job for a day.
- A 422 is now a book failure. It no longer pauses the job.
- A successful answer deletes the work's rejection row, if there is one.

The adapter keeps its retry rules. It reports a book failure as `SourceUnavailableError` with the status, or with a reason and no status, as today. The job classifies the error. The adapter does not.

## 2. Review queue

### Who is listed

Works held by at least one library, canonicalised, in four groups:

| Group | Condition |
|---|---|
| `rejected` | a `genre_rejections` row with 3 or more attempts |
| `none` | a Jev judgment with `genre` null |
| `unsure` | a Jev judgment with a genre and confidence below 0.5 |
| `possible` | genres, all of them possible (Jev, confidence 0.5 to under 0.8) |

- "Jev judgment" means a judgment whose model is not `manual`. A work the owner already labelled "no genre" is never listed.
- A work that has any genre other than a possible one is never listed. That covers source genres, manual genres and confident Jev genres.
- A work is in exactly one group. The order of the table decides ties.
- Order: works someone finished first, then by number of holders, then by title. The list holds at most 200 works.

### Each item

- work id, title, author, cover URL;
- the longest synopsis, cut to 300 characters;
- holders, and whether anyone finished it;
- the group and the evidence for it:
  - `rejected`: status, reason, attempts, last time;
  - `none`: confidence;
  - `unsure` and `possible`: Jev's genre and confidence.

The response carries no user ids.

### Endpoints

Both endpoints are admin-only. They use the books routes' existing pattern: `authGuard`, then `service.isAdmin`, and 403 for anyone else.

`GET /books/genre-review` returns `{ items, total }`. `total` counts every listed work, before the 200 cap.

`POST /books/genre-review/:workId` takes exactly one of these bodies:
- `{ "genres": ["…"] }`: 1 to 3 distinct genres from `BOOK_GENRES`. It writes them as manual labels to every edition whose genres are empty, from Jev, or manual. This is the genre pass's fill rule, through the same code.
- `{ "genres": [] }`: no genre. It stores the manual "none" judgment, exactly as the genre-pass import does.
- `{ "retry": true }`: deletes the work's rejection row and its Jev judgment. A manual judgment is kept. The job asks again on its next run if the work still qualifies.

Answers:
- 200 with `{ workId, editions }`, the number of editions changed (0 for "no genre" and "retry");
- 400 for a body that doesn't match, an unknown genre, a duplicate, or more than 3;
- 404 for a work id not in the catalog;
- 403 for a non-admin.

A merged work id resolves to its canonical work, as in the import.

### Shared logic

- The list query and the three actions live in the books module, beside `genrePass.ts`.
- The import's label handling and the "set genres" and "no genre" actions use one function. The CLI import and the page cannot drift apart.
- Libraries pick up the new genres on their owners' next load, through the re-check on load.

## 3. Admin page

- A web route `/admin/genres`, admin-only. A non-admin who opens it sees the app's not-found page.
- The account menu shows a "Genre review" link only when `GET /books/admin` says the viewer is the admin.
- The page lists the four groups in table order. Each group has a heading and its count.
- Each row shows the cover, title, author, synopsis excerpt, holders and the evidence:
  - "Rejected 3× · HTTP 400 · <reason>";
  - "Jev: none (0.91)";
  - "Jev: Poetry? (0.34)";
  - "Possibly History (0.62)".
- Each row has:
  - genre chips to pick up to 3, preselected with Jev's genre for `unsure` and `possible`, and a Save button;
  - "No genre";
  - "Retry", only on `rejected` rows.
- A row leaves the list once its action succeeds. A failed action shows the error on that row and keeps it.
- The page uses the existing design tokens and chip styles from the book screen.

## Error handling

- **Book failures** are recorded, never thrown. They don't stop the other workers.
- **Outages and a 401** behave as in catalog genres. An outage stores nothing and the next run asks again. A 401 alerts and pauses for a day.
- **The budget** can't be overspent by concurrent workers, because taking it is a single conditional upsert.
- **No new catch** on the endpoints beyond the specific errors they map: validation gives 400, an unknown work gives 404.
- **The import and the page** validate before writing, and write in one transaction.

## Testing

- **Budget:**
  - every request counts, including retries;
  - the 1,001st request of a day is refused without a fetch;
  - the count survives a new repository on the same database;
  - a new UTC day starts at zero;
  - a spent budget pauses the job until the next UTC midnight, stores nothing and alerts nobody.
- **Strikes:**
  - a 400 or an unknown option adds an attempt, and the run continues with the next work;
  - 3 attempts stop selection;
  - a 5xx, timeout or 429 after retries adds no attempt;
  - a 422 adds an attempt and doesn't pause;
  - a 401 still pauses and alerts;
  - a success clears the rejection.
- **Queue:**
  - each group's condition;
  - exclusions: manual none, source, manual and confident genres;
  - one group per work;
  - order and the 200 cap with the full total;
  - merged works.
- **Actions:**
  - set genres follows the fill rule and is a no-op on repeat;
  - no genre stores the manual judgment;
  - retry clears the rejection and the Jev judgment but keeps a manual one;
  - validation errors;
  - unknown work;
  - 403 for a non-admin.
- **Import:** the existing genre-pass tests still pass through the shared function.
- **Web:**
  - the page renders each group's evidence;
  - Save, No genre and Retry call the endpoint and remove the row;
  - the menu link shows only for the admin.

## Rollout

1. Merge. Deploy when the owner asks. The new tables are created at boot.
2. With `TYPESAFE_API_KEY` still unset, the page lists only the doubts left by the manual pass and any rejections. Before the key is set, it may be empty.
3. Once the key is set, check `typesafe_usage` after the first day. It should stay at or below 1,000.
