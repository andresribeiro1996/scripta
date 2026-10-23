# Title-key grouping: whole titles

Keyless works are grouped by `books.title_key` (`groupTitleKeys`, at search save and in the boot, daily and `POST /books/works/group` runs). The key is `ta:<normalizeTitle(title)>|<first author>|<title numbers>`, and `normalizeTitle` cuts every title at the first ":". So different books that share a series, character or set name before a colon, and have the same first author, get the same key. With one exception, today's rules decide on the key alone:

- **One keyed work under the key:** every keyless work with that key joins it, whatever its full title.
- **No keyed work:** every keyless work joins the oldest keyless work with the key.
- **Several keyed works (the crowded-key fold):** a keyless work joins the one whose full title equals its own. This rule already compares full titles.

Today's code still does this: on main (3a9ee8f2), three keyless works "Arsène Lupin: Gentleman Ladrão", "Arsène Lupin: A Agulha Oca" and "Arsène Lupin: O Triângulo de Ouro" become one work, with or without a keyed work under the key. The BNP sync adds Portuguese editions every six hours, and each new one is grouped the same way.

## Review of existing merges

A read-only review of the active `title-key` merges in production is in the session notes, not in the repo. It covered the merges where no merged edition carries the whole title (`sameWholeTitle`) of any of the target's own editions, and Sonnet reviewers judged them in batches of 25 or fewer.
- **Most joined different books:** children's sets and series volumes under one name, or a book and its graphic-novel adaptation.
- **A minority were correct:** taglines, edition notes and short titles, such as "Os Maias: Episódios da Vida Romântica" against "Os Maias".

The undoable-title-key change (branch `claude/bold-dubinsky-3052e6`) makes these merges undoable and keeps grouping from redoing an undone pair.

## Decision: group by title key and whole title

A keyless work joins another work only when the two share a title key **and** a whole title. `wholeTitle(title)` (`domain/translation.ts`) is `normalizeWords(withoutBrackets(title))`, the rule the translation matcher has used since #333. Colon, dash and `". "` parts count. Bracketed series and edition notes don't, so "[EBOOK] X" and "X (edição de bolso)" still group with "X".

For a keyless candidate `c` (today's candidate rules: live, keyless, every edition under one non-empty key, none detached) with key `k`, its whole title `t` is the whole title of the work's own title:

1. **Keyed works holding an edition under `k` whose whole title is `t`:**
   - exactly one: `c` joins it;
   - two or more: `c` is left alone, as the crowded fold does today. The duplicate pass may merge them later, though since #335 it never merges a series-named set or a set of three or more.
2. **No such keyed work:** `c` joins the oldest keyless candidate (`created_at`, then id) with key `k` and whole title `t`. If that is `c` itself, nothing happens.
3. The undone-pair skip and the arena skip apply to every planned pair, as today.

Keyed works are matched through their **edition** titles, not `works.title`. A keyed work's title is its first edition's, which is often in another language. A translation join leaves Portuguese editions inside an English keyed work ("1984" holding "Mil Novecentos e Oitenta e Quatro"), and a later keyless copy of that Portuguese edition must still find it. An edition that an active `title-key` merge moved into the keyed work doesn't count, since a wrongly folded edition would otherwise attract new copies of its title before the undo restores it; editions moved in by any other source (a translation join, `ol-duplicate`, admin) count. This replaces both today's single-keyed rule and the crowded fold. The crowded fold's comparison changes from `normalizeWords(works.title)` to edition whole titles.

**What it costs:** correct folds of a tagline, an edition note or a short title stay separate works, now and in future. A book then shows once per title variant in search, unless the work-key lookup later gives the keyless edition the keyed work's Open Library key, which moves it by key. An edition-note exception ("Edição Limitada", "Ed. Colecionador", "Ebook") would recover some of them, but in the review it also let wrong ones through. It is not part of this change.

**Rejected:**
- **Strict only when both sides have a colon part.** It still folds every "Series: Volume" book into a work titled only with the series name.
- **Strict only for series-like keys (3 or more whole titles under the key).** It still folds two-title keys, and the answer depends on the order in which editions arrive.

## Repository

- `domain/duplicateWorks.ts`: `planTitleFolds` replaces `planCrowdedFolds` and plans every keyless fold under the rules above. It takes `TitleWork` entries (`KeyWork` plus `createdAt`), and `KeyWork` goes. Keyed works come in as one entry per distinct (work, edition title).
- `sqliteBooksRepository.ts`:
  - `GROUPABLE_PAIRS_SQL` and `crowdedFolds` go.
  - `KEYLESS_CANDIDATES_SQL` adds `created_at`.
  - A new `KEYED_EDITIONS_SQL` lists `(title_key, work_id, title)` for each edition under the keys that sits in a live keyed work and isn't detached, through `idx_books_title_work`.
  - `groupTitleKeys` plans with `planTitleFolds` and keeps its skip, limit and transaction.
- `KEYED_WORKS_SQL` and `planDuplicateSets` (the keyed duplicate merge) are unchanged.

## Not in scope

- Re-planning existing merges. The wrong ones the review found are undone with `undo-series-merges.mjs` (see Rollout).
- `normalizeTitle`, the `title_key` format, and `planDuplicateSets`' `normalizeWords` comparison.
- The edition-note exception above.
- A series-name guard for keyless grouping. #335 applies one to keyed duplicates only. Bare series-name titles still fold together when their whole titles match, although several ISBNs titled only with a series name may be different volumes.

## Rollout

1. **Deploy this with the undoable-title-key branch, or after it,** and run the reviewed undos right after that deploy (owner's OK).
   - Not the other way round: under today's rules, the translation step can join a restored Portuguese volume to its keyed original. That original is then the only keyed work under the series key, and every other keyless volume of the series folds into it.
   - A title-key fold made before this change no longer attracts copies of its title, so the window between the deploy and the undo run makes no new folds through it.
2. **Run `POST /books/works/group`, or wait for the daily run,** to fold the restored copies of one volume into one work per whole title. They stay apart from the target they were undone from.
3. **Re-run the read-only listing** for merges made after the deploy. It should list none with a differing colon part. Merges made between the review and this deploy are reviewed the same way.
