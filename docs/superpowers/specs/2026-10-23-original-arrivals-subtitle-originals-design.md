# Original arrivals: plan subtitle originals

The original-arrivals drain (`originalArrivals.ts`, #325) skips a claimant whose original has a part that the stem title drops. That covers a colon part, a dash part (`" — "`, `" – "`, `" - "`) or bracketed words, through the rule `normalizeWords(original) !== normalizeTitle(mainTitle(original))`. #325 decision 3 set this rule, #333 kept it, and #336 left it unchanged, so a "The Trials of Apollo - The Dark Prophecy" claimant is found when that original arrives whole and is then skipped.

On 2026-10-23 the user decided to drop the rule from the drain for every kind of subtitle part.

## Why the rule can go

- **The matcher already requires the whole title.** `planMatch` returns `code` only for the single surname-vouched candidate work that holds an edition with `sameWholeTitle(edition.title, original)` (`translationJudgments.ts`, since #333).
  - `sameWholeTitle` keeps colon, dash and full-stop parts and ignores bracketed words.
  - The drain's target check repeats the whole-title test (it can't fail after a `code` plan) and adds the Open Library key.
  - So the join #325 decision 3 guarded against, a "Dune" edition taken as the original "Dune: Messiah", is already refused without the rule.
- **The rule only delays joins.** The backlog's code step (`runCodeSteps`) and the server's held-work job (`matchWork`) have no subtitle rule. They already make these joins, so the drain's rule only makes such claimants wait for a backlog or held-work run.
- **Measured read-only on production on 2026-10-23.** The counts are in the session report, not in the repo.
  - Dash parts in stored originals are nearly all distinct real subtitles. Edition notes ("Boxed Set", "25th Anniversary Edition") are a small minority.
  - Past code and Jev joins whose original has a subtitle part, into a target that carries the whole title, were almost never undone.
  - No owner "no match" answer would be contradicted by a code join today.

## Rules that do not change

- **Guard 1** (non-negotiable): an original claimed by 3 or more distinct Portuguese titles per author surname is series-like, and `planMatch` returns `none`. Its grouping and count key don't change.
- **Guard 2** (non-negotiable): an edition title with a volume marker never settles in code.
- An owner's `manual` answer is final and never selected.
- **The #323 shared-original rule** still skips a claimant whose stem and surname bucket holds two or more distinct whole Portuguese titles, or two or more distinct originals.
  - Guard 1 counts "Série - Volume" Portuguese titles as one title. So in the drain, the shared rule is what keeps several volumes under one dash series stem from being joined on arrival.
- These checks also stay:
  - the claimant has an evidence original with the stem key `S`, and that original arrived;
  - the claimant's edition author names the arriving surname;
  - writes are code-only;
  - the target holds an Open Library key and an edition carrying the whole original.
- `planMatch`, `mainTitle`, `sameMainTitle`, `originalKey`, `originalWholeKey` and the stored keys are unchanged, and there is no `ORIGINAL_KEY_VERSION` bump.
- The `fetch-originals` fill keeps its own `subtitle` skip. That skip exists because Open Library's `title` lacks the subtitle, so a whole-title pick can't match there; this change doesn't touch it.

## Decisions

- **The drain drops the `subtitle` condition** from its per-work skip. The skip becomes:
  - `!original`;
  - `originalKey(original) !== stem`;
  - `!arrived(original)`;
  - `shared(original, author)`.

  The imports only that condition used (`normalizeTitle` and `normalizeWords` from `@scripta/shared`, `mainTitle`) go with it.
- **For every find path.** It applies to stem finds and whole-key finds, and to colon, dash and bracket parts alike.
  - A narrower rule, skipping only when the original didn't arrive by its whole key, would add a branch.
  - It would also keep colon and bracket claimants waiting for the backlog, with no added safety, since the whole-title check is the same on both paths.
- **No catch-up.** As before, only new arrivals trigger the drain. A claimant whose whole original is already in the catalog is planned only when another arrival under its key triggers it; `planMatch` then searches the whole catalog and may join it there, as the backlog would. Otherwise it waits for the backlog.

## Behaviour after the change

- **Colon:** a "Dune: Messiah" claimant joins when "Dune: Messiah" by Frank Herbert arrives with an Open Library key.
  - When "Dune" arrives and no edition in the catalog carries "Dune: Messiah", the claimant is planned but not joined, and its earlier answer stays. If a "Dune: Messiah" edition is already present, it joins there, as the backlog would.
  - The shared rule groups by the part before the colon. A Herbert claimant of "Dune" next to one of "Dune: Messiah" makes it skip both, as for dash series.
- **Dash:** a "The Trials of Apollo - The Dark Prophecy" claimant joins when that whole title arrives.
  - A second Portuguese volume under the same stem and surname ("O Oráculo Oculto" for "The Trials of Apollo - The Hidden Oracle") makes the shared rule skip both, as today.
- **Edition note:** a "The Hobbit - Illustrated Edition" claimant is planned when "The Hobbit" arrives and is not joined, because the plain title is not its whole title. Jev keeps the question.
- **Brackets:** a "Le Petit Prince (Édition illustrée)" claimant joins when "Le Petit Prince" arrives, because bracketed words don't count in the whole title. The backlog does the same today.
- **`claimants`** in the tick's counts now includes these works.

## Cost

These claimants were already read: their evidence is loaded before the skip. Now each also gets one `planMatch`, the same index-range reads every other claimant gets. That stays proportional to the arriving author's claims of the stem, with no whole-catalog read.

## Tests (`originalArrivals.test.ts`)

These change:
- "an original with a subtitle part is not joined by its main title" (a "Dune: Messiah" arrival) now joins, renamed to say so.
- The dash test ("found when it arrives whole but stays skipped") now joins, renamed to say so.

These are new:
- a "Dune: Messiah" claimant is planned but not joined when "Dune" arrives;
- two Portuguese volumes under one dash series stem are not joined when one volume arrives whole;
- a dash edition-note original is not joined when the plain title arrives;
- a bracketed-note original joins when the title without the note arrives.

## Docs

The drain paragraph in `backend/README.md` ("Every new or changed title key …") no longer says it skips originals with a subtitle part, or that dash originals are still skipped. It says the whole-title rule decides.

## Out of scope

- The fill's `subtitle` skip, Guard 1's dash-volume undercount and the #323 bucket.
- A catch-up over originals already present.
- Reviewing past whole-title joins of subtitle originals.

## Runbook

No production command and no migration. After the batch deploy, joins of subtitle originals show on `/admin/translations` under "Merged", as before, where each can be undone.

**Rollback:** an older build skips these claimants again, and nothing stored changes.
