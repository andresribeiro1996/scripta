# Genre review and Jev triggers — design

Follows catalog genres (`docs/superpowers/specs/2026-10-14-catalog-genres-design.md`, PRs #260 and #261). The one-off catalog passes are in `2026-10-15-catalog-genre-backfill-design.md`.

## Goal

- Jev runs when a library brings in a book that has no genres, not on a 10-minute timer.
- A per-caller daily budget bounds it.
- It stops asking about a book TypeSafe keeps rejecting.
- Books TypeSafe rejected, and books Jev was unsure about, appear on an admin page where the owner labels them.

Today:
- The job runs at boot and every 10 minutes, whether or not anything new arrived.
- A book TypeSafe rejects is asked again every run, with no limit.
- Nothing caps daily requests. The worst case is about 36,000 a day, retries included.
- A 422 pauses the whole job for a day, even when only one book caused it.
- Books Jev answered "none", answered below 0.5, or marked only as possible are reviewed only through the manual genre pass (export, Claude, import).

Four pieces:

1. **Triggers:** an in-process queue fed when a held book's details lookup finds no genres, plus one sweep a day.
2. **Bounds:** a daily request budget per caller, and three strikes per book.
3. **Review queue:** an admin-only endpoint that lists held books needing review and applies the owner's decisions.
4. **Admin page:** a web page over that queue.

## Non-goals

- **Mobile.** Mobile has no admin UI, and this adds none.
- **Email.** Rejections are not emailed. The key-rejection alert stays as it is.
- **The catalog backlog.** Books no library holds are labelled by the one-off passes in the backfill spec, not by the queue or the sweep.
- **Replacing the manual genre pass.** The export and import scripts keep working, and share code with the queue.
- **Reviewing source genres.** Genres from Open Library, ISBNdb, publisher feeds or search never appear on the page.

## 1. Triggers

### Queue

- A held book is one that at least one library holds (`library_books.work_id`, canonicalised).
- The books service gets a hook that fires when a details lookup finishes for an edition and leaves its work with no genres other than Jev's. That covers the client's `GET /books/details` and the details backfill.
- The hook adds the work to a genre queue when:
  - it is held, checked through the library's existing holders lookup, passed in by `app.ts` like `heldWorkIds`;
  - it has no judgment;
  - it has fewer than 3 strikes.
- **The queue:**
  - is in memory and de-duplicated by work id;
  - runs at most 4 requests at a time;
  - takes budget from the `genres` source before each request.
- **The request path never waits on it.** Adding to the queue is synchronous and constant-time. Classification runs after the response.
- **When the queue stops early, it keeps its works:**
  - with the budget spent, it pauses until the next UTC midnight;
  - after an outage, it pauses for 10 minutes;
  - after a 401, it pauses for a day.
  - A restart loses the queue; the sweep picks those works up again.
- **Each answer:**
  - is stored and applied at once (save line 0.5), through the same code as today;
  - reaches the owner's library on their next load, through the re-check on load.

An import of new books: the enrichment hook asks `/books/details` for each book with no genres. Each lookup that finds none queues its work. Jev answers within seconds to minutes, and the next load picks the answers up.

### Sweep

- One sweep runs at boot and once every 24 hours. It replaces the 10-minute timer.
- It runs today's selection: held works with no genres, a finished details lookup, no judgment and fewer than 3 strikes. It feeds them through the same queue.
- It catches what the queue lost: a restart, an outage, or a work whose lookup ran before this change.

The job, queue and sweep start only when `TYPESAFE_API_KEY` is set, as today.

## 2. Bounds

### Daily budget per caller

- A new catalog table `typesafe_usage(day TEXT, source TEXT, requests INTEGER NOT NULL, PRIMARY KEY (day, source))` counts requests. `day` is the UTC date, `YYYY-MM-DD`.
- Every HTTP request to TypeSafe counts, including retries of 429 and 529.
- Each caller has a source name and a limit:

| Source | Limit | Used by |
|---|---|---|
| `genres` | 1,000 a day (`GENRE_DAILY_BUDGET`) | the queue and the sweep |
| `genres-backlog` | the `--max` given to the run | the catalog pass in the backfill spec |

- Other features that call TypeSafe (the synopsis and translation work being designed separately) add their own source and limit. They read and write the same table.
- **Taking budget:**
  - The classifier gets a `spend()` function from its caller, and calls it before every request.
  - For a daily limit, `spend()` is one atomic upsert that succeeds only while that source's count for the day is below the limit.
  - Concurrent workers can't overspend.
- **When budget runs out:**
  - `spend()` throws `GenreBudgetSpentError`, and the request is not made.
  - Nothing is stored for that work, and it is not counted against the book.
  - It is logged once at info level, with no alert.
  - The queue keeps its works and pauses until the next UTC midnight.

### Three strikes

A failure belongs to the book when TypeSafe answered but the answer can't be used for that book:
- a 4xx status other than 401 and 429;
- an option id the adapter doesn't know, a missing field, or JSON that doesn't parse.

Everything else is an outage and belongs to nobody: 5xx including 529, 429 after its retries, network errors and timeouts.

- **Recording:**
  - A new catalog table `genre_rejections(work_id TEXT PRIMARY KEY, status INTEGER, reason TEXT NOT NULL, attempts INTEGER NOT NULL, last_at TEXT NOT NULL)` records a book's failures. `status` is null for an answer that couldn't be used.
  - Each book failure adds one attempt and replaces the status, reason and time with the latest.
  - A work with 3 or more attempts is no longer queued or selected (`GENRE_REJECTION_LIMIT = 3`).
  - A successful answer deletes the work's rejection row.
- **Effect on the run:**
  - A book failure doesn't stop the queue; the next work goes ahead.
  - An outage stores nothing for the failed request and pauses the queue for 10 minutes. The work stays queued.
  - A 401 alerts and pauses the queue and sweep for a day, as today.
  - A 422 is now a book failure; it no longer pauses anything.
- The adapter keeps its retry rules and reports failures as today. The caller classifies them; the adapter doesn't.

## 3. Review queue

### Who is listed

Held works, canonicalised, in four groups:

| Group | Condition |
|---|---|
| `rejected` | a `genre_rejections` row with 3 or more attempts |
| `none` | a Jev judgment with `genre` null |
| `unsure` | a Jev judgment with a genre and confidence below 0.5 |
| `possible` | genres, all of them possible (Jev, confidence 0.5 to under 0.8) |

- "Jev judgment" means a judgment whose model is not `manual`. A work the owner labelled "no genre" is never listed.
- A work with any genre other than a possible one is never listed.
- A work is in exactly one group; the table's order decides ties.
- Order: works someone finished first, then by number of holders, then by title. At most 200 works.

### Each item

- work id, title, author, cover URL;
- the longest synopsis, cut to 300 characters;
- holders, and whether anyone finished it;
- the group and its evidence:
  - `rejected`: status, reason, attempts, last time;
  - `none`: confidence;
  - `unsure` and `possible`: Jev's genre and confidence.

The response carries no user ids.

### Endpoints

Both are admin-only. They follow the books routes' existing pattern: `authGuard`, then `service.isAdmin`, and 403 for anyone else.

`GET /books/genre-review` returns `{ items, total }`. `total` counts every listed work, before the 200 cap.

`POST /books/genre-review/:workId` takes exactly one of these bodies:
- `{ "genres": ["…"] }`: 1 to 3 distinct genres from `BOOK_GENRES`. They are written as manual labels to every edition whose genres are empty, from Jev, or manual. This is the genre pass's fill rule, through the same code.
- `{ "genres": [] }`: no genre. It stores the manual "none" judgment, as the genre-pass import does.
- `{ "retry": true }`: deletes the work's rejection row and its Jev judgment, keeping a manual one. Then it queues the work.

Answers:
- 200 with `{ workId, editions }`, the editions changed (0 for "no genre" and "retry");
- 400 for a body that doesn't match, an unknown genre, a duplicate, or more than 3;
- 404 for a work id not in the catalog;
- 403 for a non-admin.

A merged work id resolves to its canonical work.

### Shared logic

- The list query and the three actions live in the books module, beside `genrePass.ts`.
- The import's label handling and the "set genres" and "no genre" actions share one function.

## 4. Admin page

- A web route `/admin/genres`, admin-only. A non-admin sees the app's not-found page.
- The account menu shows a "Genre review" link only when `GET /books/admin` says the viewer is the admin.
- The four groups appear in table order, each with a heading and its count.
- Each row shows the cover, title, author, synopsis excerpt, holders and the evidence:
  - "Rejected 3× · HTTP 400 · <reason>";
  - "Jev: none (0.91)";
  - "Jev: Poetry? (0.34)";
  - "Possibly History (0.62)".
- Each row has:
  - genre chips to pick up to 3, preselected with Jev's genre for `unsure` and `possible`, and a Save button;
  - "No genre";
  - "Retry", on `rejected` rows only.
- A row leaves the list once its action succeeds. A failed action shows the error on the row and keeps it.
- The page uses the existing design tokens and the book screen's chip styles.
- A synopsis review page planned elsewhere can sit beside it under `/admin/`. This spec adds only the genres page and its menu link.

## Error handling

- **Book failures** are recorded, never thrown. They don't stop the queue.
- **Outages and a 401** behave as in catalog genres: an outage stores nothing, and a 401 alerts and pauses for a day.
- **The budget** can't be overspent by concurrent workers.
- **The queue hook** never throws into a request. It only adds an id to a set.
- **No new catch** on the endpoints beyond the errors they map: validation gives 400, an unknown work gives 404.
- **The import and the page** validate before writing, and write in one transaction.

## Testing

- **Queue:**
  - a details lookup that leaves a held work with no genres queues it;
  - a non-held work, a judged work and a 3-strike work are not queued;
  - duplicates collapse;
  - at most 4 requests are in flight;
  - the request that triggered the lookup doesn't wait on classification;
  - a spent budget, an outage and a 401 pause the queue for the right time and keep its works.
- **Sweep:**
  - runs at boot and every 24 hours;
  - selects as today, minus 3-strike works.
- **Budget:**
  - every request counts, including retries;
  - the 1,001st `genres` request of a day is refused without a fetch;
  - another source's usage doesn't count against `genres`;
  - the count survives a new repository on the same database;
  - a new UTC day starts at zero;
  - a spent budget holds the queue, stores nothing and alerts nobody.
- **Strikes:**
  - a 400 or an unknown option adds an attempt, and the queue continues;
  - 3 attempts stop queueing;
  - a 5xx, timeout, or 429 after retries adds no attempt;
  - a 422 adds an attempt and doesn't pause;
  - a 401 still pauses and alerts;
  - a success clears the rejection.
- **Review queue:**
  - each group's condition;
  - the exclusions;
  - one group per work;
  - order and the 200 cap with the full total;
  - merged works.
- **Actions:**
  - set genres follows the fill rule and repeats as a no-op;
  - no genre stores the manual judgment;
  - retry clears the rejection and the Jev judgment, keeps a manual one, and queues the work;
  - validation, unknown work, and 403.
- **Import:** the existing genre-pass tests pass through the shared function.
- **Web:**
  - the page renders each group's evidence;
  - Save, No genre and Retry call the endpoint and remove the row;
  - the menu link shows only for the admin.

## Rollout

1. Merge. Deploy when the owner asks. The new tables are created at boot.
2. With `TYPESAFE_API_KEY` unset, nothing calls TypeSafe. The page lists only the doubts left by the manual pass.
3. Once the key is set, check `typesafe_usage` after the first day. The `genres` source should stay at or below 1,000.
