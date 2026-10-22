# Translation matcher: whole titles

The translation code step (`planMatch` → `code`) joins a Portuguese work to its original's work without asking Jev. It finds candidates through `title_key`, which drops a colon part (`normalizeTitle`), and through `mainTitle`, which also cuts at `". "` and dashes. PR #323 worked around this inside `seed/originalsFill.ts` (a `subtitle` skip, a local bucket, a local `sameWholeTitle`). This change moves the fixes into the shared matcher in `domain/translation.ts` and `translationJudgments.ts`.

## Problems

1. **Colon subtitles.** `titlePattern("Dune: Messiah")` matches a catalog "Dune". When that is the only candidate, code joins the sequel into the first book. The reverse also happens: a bare "Fairy Oak" original is the only candidate for a "Fairy Oak: Il segreto delle gemelle" claimant.
2. **`mainTitle` cuts at `". "`.** "Mr. Mercedes" becomes "Mr", and "Les rois maudits. Le roi de fer" becomes the series name.
3. **Guard 1 undercount.** Guard 1 counts distinct Portuguese titles by `originalKey(title)`. That key drops the colon part, so "Crónicas: Aurora", "Crónicas: Crepúsculo" and "Crónicas: Noite" count as one title, and their series-name original is never flagged.
4. **No surname filter on title candidates.** A second author's book with the same title makes two candidates, and the work goes to `ask` forever.
5. **Two copies of the claim grouping.** `originalsFill.ts` and `originalArrivals.ts` (#325) each keep a local copy of Guard 1's grouping, the #323 bucket.
6. **#323 known issue 1.** The fill's `present` check compares the candidate *work* titles (`matchCandidates`). Picture a killed run: the fetched original landed in a Portuguese work through its Open Library key. That work's title is Portuguese, so a second shelved copy is never listed in `presentWorks` and is never joined.

## Decisions

### Whole title

- `@scripta/shared` exports `withoutBrackets` (`library/bookMatch.ts`). It is already used by `normalizeTitle` and `titleNumbers`.
- `domain/translation.ts` exports `wholeTitle(title) = normalizeWords(withoutBrackets(title))`.
- It also exports `sameWholeTitle(a, b)`: true when `wholeTitle(a)` is not empty and equals `wholeTitle(b)`.
- Bracketed words are series or edition notes ("(A Song of Ice and Fire, #1)", "(edição de bolso)"), so they don't count.
- Every other word does: colon, dash and `". "` parts on either side.
- This replaces `sameWholeTitle` in `seed/originalsFill.ts`, which compared against `mainTitle(original)`. Every caller moves to the new one:
  - `pickOriginal`;
  - the fill's existing-row check;
  - the fill's present check;
  - the arrivals drain's target check.

### Code step (`planMatch`)

- **Candidates by title.** Canonical works with an edition whose `title_key` matches either of two patterns:
  - `titlePattern(original)`, unchanged: the stem pattern, cut at a colon, a dash or `". "`;
  - the original's own key pattern, `ta:<normalizeTitle(original)>|*|<titleNumbers(original)>`.
- `titlePatterns(original)` returns both, deduplicated, stem first. The stem pattern keeps Jev's candidate list a superset of today's. The whole-key pattern finds "Mr. Mercedes" under its own key.
- **Code joins only when all of these hold:**
  - exactly one candidate work holds an edition with `sameWholeTitle(edition.title, original)`;
  - the surname of that work's author is named in the work's evidence (author, work author, summaries);
  - neither the original nor the Portuguese work's own title (`evidence.title`) has a volume marker, as today. A candidate's bracketed series note ("#1") does not count.
- The surname filter applies before counting. Another author's book with the same title no longer forces `ask`.
- **The `ask` candidate list** is the title candidates from both patterns, then the author candidates, capped at `MAX_CANDIDATES`, as today.
- **`original` and `none` are unchanged.** `original` is decided by `sameMainTitle`. `none` comes from Guard 1 or from having no candidates.

### `mainTitle`

- `mainTitle` cuts only at `" — "`, `" – "` and `" - "`.
- `". "` is ISBD's title/part separator and also ends abbreviations, so it is not a subtitle mark.
- Its users:
  - `sameMainTitle`: the `original` check, and the fill's `noOriginal`;
  - the fill's `subtitle` skip and its lookup title;
  - the drain's subtitle rule.
- "Mr. Mercedes" is no longer skipped as a subtitle, and it is looked up under its whole title.

### Guard 1 (non-negotiable: never loosened)

- **Unchanged:**
  - the grouping key: `originalKey(original)` plus the surname;
  - the claim filter: skip a claim whose title key equals its original key, which is exactly today's `sameMainTitle` with the old cut;
  - the group name.
- These all use a private stem, which still cuts at `" — "`, `" – "`, `" - "` and `". "`. So `originalKey` is unchanged, `ORIGINAL_KEY_VERSION` stays 1, and #325's stored `original_key` and its `titlePattern`/`arrivalKey` equivalence test still hold.
- **Changed: what counts as a distinct title.** The count key is `${originalKey(title)}#${wholeTitle(stem(title))}`, which refines today's `originalKey(title)`, so a group never counts fewer titles than today.
  - Colon parts now count: "Crónicas: Aurora" and "Crónicas: Crepúsculo" are two titles.
  - Brackets, dash parts and `". "` parts still don't. "[EBOOK] O Principezinho", "O Principezinho (edição de bolso)" and "O Principezinho - Edição Interativa" stay one title.
- **Rejected:** counting dash parts too. The Portuguese editions of classics carry edition notes after a dash ("- Edição Interativa", "- Edição Especial 25 Anos"). On production that flagged the groups behind correct joins of classics, and Guard 1 answers `none`, not Jev. The dash-volume undercount Guard 1 already had stays. That is a follow-up that needs an edition-note rule first.

### Shared grouping

- The private `claimGroups` in `translation.ts` is the one grouping. Each group collects three things:
  - the Guard 1 count key (`titles`);
  - `wholeTitles`, which is `normalizeWords(claim.title)`;
  - `originals`, which is `normalizeWords(claim.originalTitle)`.
- `translation.ts` exports `sharedOriginals(claims): SeriesLike`. It is true when a group has at least 2 `wholeTitles` or at least 2 `originals`.
- These are #323's bucket counts, kept exactly. A claim whose title has words but no title key (": Rumo ao Farol") still counts for `wholeTitles` and `originals`, as it did in the bucket. It never counts in Guard 1's `titles`, as today. On production, counting shared originals by Guard 1's denoised key would stop treating many groups as shared. Among them are dash-subtitled volumes ("Série - Volume Dois") whose series-name original the fill would then fetch and join.
- `seed/originalsFill.ts` and `originalArrivals.ts` drop their local copies and use `sharedOriginals`. The fill keeps checking it per lookup group, after `present`, as today.

### Repository

- `titleCandidates(pattern)` returns `Array<{ id: string; title: string }>`: the distinct pairs of canonical work id and edition title whose `title_key` matches.
- `planMatch` and the fill's present check read edition titles from it. That fixes #323 known issue 1: the fetched original's own edition carries the whole title wherever it landed.
- It uses the same `idx_books_title_work` range as before. Pulling `b.title` costs one row read per matching edition.

## Measured before changing join behaviour

All rules were replayed read-only on production against every active code join, every undone code join and every Jev join. The counts and titles are in the session report, not in the repo.

- **No existing join changes.** Merged works are never re-selected, so the rules only decide future plans: new works, `--recheck-none`, the fill and the drain.
- **The whole-title rule** is the only rule that would have blocked past code joins. Those are joins whose original carries a colon, dash or `". "` subtitle the catalog title lacks, or the reverse. Most are correct; some join a sequel or a volume into a series work. From now on such works go to Jev.
- **Unchanged `titlePattern`, the surname filter, `sameMainTitle` without the `". "` cut, and the new Guard 1 count** blocked none of them. Guard 1 lost no group and gained only real series.
- **Jev joins:** the new code step picks the same target as Jev on nearly every one it can settle.

## Not in scope

- Re-planning or undoing existing joins. Listing and reviewing the code joins that dropped a subtitle is a follow-up.
- `normalizeTitle`, the `title_key` format and `originalKey`. There is no migration.
- The fill's and the drain's `subtitle` skip. Open Library's `title` lacks the subtitle, so a whole-title pick can't match there.
- The arrivals drain finds claimants by the stored stem key (`original_key`). An arriving "Mr. Mercedes" (arrival key `mr mercedes|`) therefore never reaches claimants stored under `mr|`. Those are joined by the fill or the backlog. That is a miss, not a wrong join, and it is a follow-up for #325's hook.
- Guard 1's dash-volume undercount (see above).
