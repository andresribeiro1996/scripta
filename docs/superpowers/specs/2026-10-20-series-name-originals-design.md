# Series names posing as original titles

## Problem

On 2026-10-20 the translation backlog's free ("code") step joined 2,540 Portuguese works to their originals on production. Most joins are right. Some are not: the edition's original title held the series name instead of the book's own original, or the edition was one volume of a series. Separate books collapsed into one work as a result.

| Collapsed work | Joined into it |
|---|---|
| *Princess Poppy*, Janey Louise Jones | 29 different children's books |
| *CHERUB*, Robert Muchamore | 8 volumes (*O Anjo da Guarda*, *Tsunami*, …) |
| *Alix Senator*, Valérie Mangin | 6 volumes, titled "Alix Senator, Vol. N – …" |
| Ferrante, *L'amica geniale* | *História do Novo Nome*, *História de Quem Vai e de Quem Fica* |

**Cause.** `planMatch` (`backend/src/modules/books/translationJudgments.ts`) settles in code when:
- the original title's pattern finds exactly one other work,
- the original title has no volume marker,
- and the surname matches.

A bare series name has no volume marker, and nothing looks at the edition's own title. So volumes join the one work titled like the series.

## Decisions (user, 2026-10-20)

- Let the paid matching (Jev) that is running finish.
- Fix the free matcher so it never joins on an original title that several clearly different books share.
- Repair the wrong joins: undo the collapsed series, and leave real translations joined.

## Design

### Guard 1: series-like original titles

An original title is **series-like** for an author when Portuguese editions (`language` `pt` or `pt-*`) carry it with **3 or more distinct main titles**.
- Grouping is by `originalKey(original)` plus `surnameOf(author)`. The key is `normalizeTitle(mainTitle(t))` plus `titleNumbers(mainTitle(t))`, the comparison `sameMainTitle` uses.
- A claim's distinct title is `originalKey(edition.title)`. Editions whose own main title equals the original are left out.
- Claims are `books.original_title`, or the summary's "Título original" (`originalTitleIn`) when the column is empty. They are read in memory, and nothing is written.

Production check, read-only, 2026-10-20:
- **Flagged:** *Princess Poppy* (30 titles), *CHERUB* (8), *Isadora Moon* (13), *L'amica geniale* (3), *Diary of a Wimpy Kid*, *Dork Diaries*, *Mr. Men* and about 200 more. 200 groups in all.
- **Not flagged:** *Le Petit Prince* (Portuguese titles are all *O Principezinho*), *Die Verwandlung* (2) and *The Historian* (2).
- **Known false positive:** classics with 3 Portuguese re-translations under different titles (*A Room of One's Own*, *A Christmas Carol*). They stay separate works, which is the state before 2026-10-20.

When the evidence's original title is series-like, `planMatch` returns `none`: no code join, and no paid question either, since Jev would see the same misleading evidence.

### Guard 2: volume titles never settle in code

When the edition's own title has a volume marker (`hasVolumeMarker(evidence.title)`), `planMatch` never returns `code`. It falls through to `ask`, so the paid model judges it. This catches *Alix Senator, Vol. N – …*. A split edition of one novel (*Os Pilares da Terra, Vol. 1*) still gets joined if the model agrees.

### Building the rule

The claims index comes from one repository read: about 47k rows, and one build took about 180 ms in review.
- **Batch callers** build it once per call and pass it down: the backlog dry run, the code steps, the paid backlog step (`runTranslationBacklog` → `matchWork`) and the calibration sample (`calibration.ts`).
- **The live held-works path** (`judgeWorkMatch`, fed by the sweep and `onDetailsChecked`) builds it lazily, after its early returns, and caches it for about 10 minutes, as `heldCache` does.
- `planMatch` takes the rule as a required argument, so no caller can skip it.

### Repair: list, review, then undo

A rule alone would undo correct joins too: the false-positive classics, and split editions caught by the volume check. So the repair has three steps.
1. **List:** `backend/scripts/undo-series-merges.mjs --list` writes, for every target work that received at least one active `code` join matching Guard 1 or Guard 2, the target's editions (title, language, ISBN, original title) and each joined work (`from_work`, its editions, merge source). It writes nothing to the database. On 2026-10-20 that is 19 targets from Guard 1 and about 13 from Guard 2.
2. **Review:** a Claude subagent reads the list and decides, per joined work, undo or keep, with a one-line reason. That follows the user's standing delegation for review queues. The user can veto before step 3. The result is a JSON file of `from_work` ids to undo.
3. **Undo:** `--undo <file>` undoes exactly those `code` or `jev` joins with `repo.undoMerge(fromWork, at)`, in global newest-first order. A chain X→A→T has to be undone from the newest join. For each restored work it records `{ model: "code", intoWorkId: null }`, so no sweep or plain backlog run joins it again. It reports what it undid and any `WorkMergeError` failures. Manual joins are never undone by this script. Jev joins are undone only when the review lists them; on 2026-10-20 the paid run added 1,549 Jev joins, and a series collapse can come from either step.

## Out of scope

- Fetching missing originals from Open Library. That's a separate plan, and it must use both guards.
- Using series-like original titles as series names for search. A follow-up; Guard 1's groups are a ready source.
- Shelves (`library_books.work_id`) that kept pointing at a collapsed work after it was undone. Check after the repair.

## Deploy

- Backend only: no migration, no new variables.
- Order: wait for the running backlog to finish, since a deploy kills it. Deploy, then `--list`, the review, and `--undo`.
