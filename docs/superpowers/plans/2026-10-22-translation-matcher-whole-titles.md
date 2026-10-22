# Translation Matcher Whole Titles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The translation code step joins only on the original's whole title, `mainTitle` stops cutting at `". "`, Guard 1 counts colon-subtitled titles apart, title candidates are filtered by surname, and the fill and the arrivals drain share the matcher's grouping and whole-title rule.

**Architecture:** `domain/translation.ts` gains `wholeTitle`, `sameWholeTitle`, `titlePatterns` and `sharedOriginals`. Guard 1 keeps a private coarse stem so `originalKey` and `titlePattern` are unchanged. `titleCandidates` returns edition titles, so `planMatch` and the fill's present check compare whole edition titles. `seed/originalsFill.ts` and `originalArrivals.ts` drop their local copies.

**Tech Stack:** TypeScript, Fastify backend, `node:sqlite`, `node:test` via `tsx --test`, `@scripta/shared`.

**Spec:** `docs/superpowers/specs/2026-10-22-translation-matcher-whole-titles-design.md`

## Global Constraints

- `originalKey` and `titlePattern` outputs must not change. `ORIGINAL_KEY_VERSION` stays `1`, and the pinned tests in `translation.test.ts` stay as they are.
- Guard 1 is never loosened. Its group key, its claim filter and its group name keep today's cut at `" — "`, `" – "`, `" - "` and `". "`. Only the distinct-title count key changes, to a refinement of today's.
- `sharedOriginals` keeps #323's bucket exactly. It skips the same claims: not Portuguese, no original key, a title with no words, or a title whose stem key equals the original's. It counts `normalizeWords(claim.title)` and `normalizeWords(claim.originalTitle)`, and is shared at 2 or more.
- Existing joins are never re-planned. Nothing in this branch writes to production or adds a migration.
- No comments in code. No new test files. Every test touched is already listed in `backend/package.json`.
- Rebuild shared before any backend run: `npm run build --workspace @scripta/shared`.
- Verify per task with `node scripts/gate.mjs` before committing.

## Review Focus

- **An original whose whole title is empty after normalising** (`":"`, `"()"`) never settles in code, and `titlePatterns` returns `[]`. Task 1 tests `titlePatterns("   ")` and `sameWholeTitle("()", "")`.
- **A candidate whose author has no usable surname** (no word of three or more letters, such as "Li Bo") is never vouched for, so the work goes to Jev, as today. Task 2 adds the test.
- **A title candidate whose work title is Portuguese**, but which holds an edition with the original's whole title, is matched through that edition. Task 2's edition-title test and its fill test cover it.
- **A Portuguese title that matched its original only through the `". "` cut** ("Os Maias. Episódios" / "Os Maias") is no longer `original`. It is planned like any other work, and Guard 1 still skips it as a self-claim. Task 1 tests both.
- **Bracketed volume notes** ("To the Lighthouse (Book 1)") still never settle in code or pass `pickOriginal`: the volume marker is checked on the raw title. Task 2 tests the code step.


## Amendments after the branch reviews (commit 4c0b65a8; the spec is current)

These supersede the task text below where they differ:
- `titlePatterns` returns three patterns, not two. The third is the words pattern `ta:<wholeTitle(t)>|*|<titleNumbers(t)>`, so `titlePatterns("Dune: Messiah")` is `["ta:dune|*|", "ta:dune messiah|*|"]`. A second work that carries the whole title in other punctuation then forces `ask`.
- `sameMainTitle` keeps today's stem cut (`originalKey` equality). The Task 1 asserts `sameMainTitle("Mr. Mercedes", "Mr. Holmes") === false` and the strict Os Maias assert are replaced by `sameMainTitle("Os Maias. Episódios da Vida Romântica", "Os Maias") === true`. The fill's and the drain's buckets were replaced for the reason given in Task 1, not because `sameMainTitle` changed.
- The fill's `present` counts only a whole-title edition. A stem-only match no longer stops the lookup.

---

### Task 1: Whole titles, `mainTitle`, Guard 1's count and the shared grouping

**Files:**
- Modify: `packages/shared/src/library/bookMatch.ts`
- Modify: `backend/src/modules/books/domain/translation.ts`
- Test: `backend/src/modules/books/domain/translation.test.ts`
- Modify: `backend/src/modules/books/seed/originalsFill.ts`
- Test: `backend/src/modules/books/seed/originalsFill.test.ts`
- Modify: `backend/src/modules/books/originalArrivals.ts`
- Test: `backend/src/modules/books/originalArrivals.test.ts`
- Modify: `backend/README.md`

The fill and the drain switch to `sharedOriginals` in this task. Their local buckets filter self-claims with `sameMainTitle`, which changes with `mainTitle`. That would break `originalsFill.test.ts` "claims in other languages or equal to their own original do not count as a second title", because "Orlando. Uma biografia" would no longer read as naming its own original.

**Interfaces:**
- Produces, from `@scripta/shared`: `withoutBrackets(value: string): string`. The existing function becomes exported, with an unchanged body.
- Produces, from `domain/translation.ts`:
  - `mainTitle(title: string): string` cuts only at `/ — | – | - /`.
  - `wholeTitle(title: string): string` is `normalizeWords(withoutBrackets(title))`.
  - `sameWholeTitle(a: string, b: string): boolean` is true when `wholeTitle(a)` is not `""` and equals `wholeTitle(b)`.
  - `titlePatterns(title: string): string[]` is `[titlePattern(title), keyPattern(title)]` with `null`s dropped and duplicates removed, in that order. `keyPattern(t)` is `ta:${glob(normalizeTitle(t))}|*|${glob(titleNumbers(t))}`, or `null` when `normalizeTitle(t)` is `""`.
  - `sharedOriginals(claims: OriginalClaim[]): SeriesLike`. `originalArrivals.ts` no longer exports one.
- Unchanged outputs: `titlePattern`, `originalKey`, `seriesLikeOriginals` (except the count key), `seriesLikeGroups`'s `originalTitle`.

- [ ] **Step 1: Write the failing tests in `translation.test.ts`**

Replace the `mainTitle` test, and add the other tests below. Import `sameWholeTitle`, `sharedOriginals`, `titlePatterns` and `wholeTitle` alongside the existing imports.

```ts
test("the main title stops at the first dash, and a full stop is part of the title", () => {
  assert.equal(mainTitle("Lipstick Traces — A Secret History of the Twentieth Century"), "Lipstick Traces");
  assert.equal(mainTitle("Autobiographie d'un poulpe - et autres récits"), "Autobiographie d'un poulpe");
  assert.equal(mainTitle("Brave New World"), "Brave New World");
  assert.equal(mainTitle("Mr. Mercedes"), "Mr. Mercedes");
  assert.equal(mainTitle("Les rois maudits. Le roi de fer"), "Les rois maudits. Le roi de fer");
});
```

- In the `sameMainTitle` test, add `assert.equal(sameMainTitle("Mr. Mercedes", "Mr. Holmes"), false)` and `assert.equal(sameMainTitle("Os Maias. Episódios da Vida Romântica", "Os Maias"), false)`.
- `test("the whole title keeps every word but bracketed ones")`:
  - `sameWholeTitle("A Game of Thrones (A Song of Ice and Fire, #1)", "A Game of Thrones")` → `true`;
  - `("Dune: Messiah", "Dune")` → `false`, and `("Dune", "Dune: Messiah")` → `false`;
  - `("The Road — A Novel", "The Road")` → `false`;
  - `("To the Lighthouse — A Novel", "To the Lighthouse: A Novel")` → `true`;
  - `("Mr. Mercedes", "Mr Mercedes")` → `true`;
  - `("L’Étranger", "L'Étranger")` → `true`;
  - `("", "")` → `false`, and `("()", "")` → `false`;
  - `wholeTitle("[EBOOK] O Principezinho")` → `"o principezinho"`.
- `test("title patterns are the stem pattern, then the original's own key when it differs")`:
  - `titlePatterns("To the Lighthouse")` → `["ta:to the lighthouse|*|"]`;
  - `titlePatterns("Dune: Messiah")` → `["ta:dune|*|"]`;
  - `titlePatterns("Mr. Mercedes")` → `["ta:mr|*|", "ta:mr mercedes|*|"]`;
  - `titlePatterns("To the Lighthouse — A Novel")` → `["ta:to the lighthouse|*|", "ta:to the lighthouse a novel|*|"]`;
  - `titlePatterns("Harry Potter 2")` → `["ta:harry potter 2|*|2"]`;
  - `titlePatterns("   ")` → `[]`.
- `test("Portuguese titles that differ after a colon count apart, so their series-name original is series-like")`:
  - `seriesLikeOriginals` over `claim("Crónicas: Aurora", "Chronicles", "Ana Silva")`, `"Crónicas: Crepúsculo"` and `"Crónicas: Noite"` answers `true` for `("Chronicles", "Ana Silva")`.
- `test("edition notes in brackets or after a dash or full stop are not another title")`:
  - claims `"O Principezinho"`, `"[EBOOK] O Principezinho"`, `"O Principezinho (edição de bolso)"`, `"O Principezinho - Edição Interativa"` and `"O Principezinho. Edição especial"`, all for `"Le petit prince"` by `"Antoine de Saint-Exupéry"`;
  - `seriesLikeOriginals` answers `false`.
- `test("a title counts apart wherever today's key tells it apart")`:
  - claims `"Um: Dois Três"`, `"Um Dois: Três"` and `"Quatro"` for `"Chronicles"` by `"Ana Silva"` answer `true`;
  - claims `"Os Maias. Episódios"`, `"Os Maias"` and `"Os Maias. Outra"` for `"Os Maias"` by `"Eça de Queirós"` answer `false`, because each claim's stem key equals the original's.
- Copy the five `sharedOriginals` tests from `originalArrivals.test.ts:62-89` into `translation.test.ts`, with the same names, claims and assertions. Use a local `shareClaim(title, originalTitle, author = "Virginia Woolf", language = "pt-PT")` helper for their `OriginalClaim`s.
- `test("a bracket note on a Portuguese title still makes another title for a shared original")`: `sharedOriginals([shareClaim("Passeio ao Farol", "To the Lighthouse"), shareClaim("[EBOOK] Passeio ao Farol", "To the Lighthouse")])` answers `true` for `("To the Lighthouse", "Virginia Woolf")`, as #323's bucket did.
- `test("a Portuguese title with words but no title key still counts for a shared original")`: `sharedOriginals([shareClaim("Passeio ao Farol", "To the Lighthouse"), shareClaim(": Rumo ao Farol", "To the Lighthouse")])` answers `true`. `seriesLikeOriginals` over those claims plus `"Um Farol"` answers `false`, because Guard 1 still drops the keyless title.
- `test("a full stop after the original's own title still names it, for both rules")`: claims `"Rumo a Orlando"` and `"Orlando. Uma biografia"` for `"Orlando"` by `"Virginia Woolf"`. `sharedOriginals` answers `false` for `("Orlando", "Virginia Woolf")`.

- [ ] **Step 2: Run them and see them fail**

Run: `npm run build --workspace @scripta/shared && cd backend && npx tsx --test src/modules/books/domain/translation.test.ts`
Expected: FAIL. The new exports are missing, and `mainTitle("Mr. Mercedes")` returns `"Mr"`.

- [ ] **Step 3: Implement the change**

In `bookMatch.ts`, export `withoutBrackets`. In `translation.ts`:
- Add a private `stem(title)` that splits on `/ — | – | - |\. /` and trims: today's `mainTitle`.
- `originalKey`, `titlePattern` and the group name in `claimGroups` use `stem`.
- `mainTitle` splits on `/ — | – | - /`.
- `claimGroups` computes `original = originalKey(claim.originalTitle)`, `title = originalKey(claim.title)` and `words = normalizeWords(claim.title)`.
  - It skips a claim that is not Portuguese, has `original === null`, has `words === ""`, or has `original === title`. That last check is today's `sameMainTitle` filter.
  - Every kept claim adds `words` to the group's `wholeTitles: Set<string>`, and `normalizeWords(claim.originalTitle)` to its `originals: Set<string>`.
  - Only a claim with `title !== null` also adds to `titles` and `workIds`. `titles` is keyed by `` `${title}#${wholeTitle(stem(claim.title))}` ``, first title kept. That keeps Guard 1 at today's claims, and the bucket at #323's.
- `sharedOriginals` looks up `groupOf(originalKey(originalTitle), author)`. It answers `group.wholeTitles.size >= 2 || group.originals.size >= 2`, and `false` when there is no key or no group.
- **`originalsFill.ts`:**
  - Delete the `buckets` map and its loop, and build `const shared = sharedOriginals(claims)`.
  - In the per-group loop, test `shared(group.originalTitle, group.author)` instead of the bucket. It is the same group: `originalKey(mainTitle(o))` equals `originalKey(o)`, and `surnameOf(firstAuthor(a))` equals `surnameOf(a)`.
  - `sharedOriginal` still adds `group.works.length`.
- **`originalArrivals.ts`:** delete `bucketOf` and `sharedOriginals`, import `sharedOriginals` from `./domain/translation.js`, and drop the imports that are no longer used.
- **`originalArrivals.test.ts`:** delete the five `sharedOriginals` tests copied in Step 1, and drop `sharedOriginals` from its import.

- [ ] **Step 4: Run the affected tests and see them pass**

Run: `cd backend && npx tsx --test src/modules/books/domain/translation.test.ts src/modules/books/originalArrivals.test.ts`
Expected: PASS, including the unchanged `originalKey` pin and the `titlePattern`/`arrivalKey` equivalence test.

- [ ] **Step 5: Update the fill test that relied on the `". "` cut**

In `originalsFill.test.ts`, split "an original with a part after a full stop or a dash is skipped, and its volume joins nothing" into two tests:
- `test("an original with a part after a dash is skipped before any lookup")`: "Some Book - A Novel" gives `[report.subtitle, report.lookups] === [1, 0]`.
- `test("an original with a full stop is looked up under its whole title, and a series work is not its original")`:
  - Setup: `"O Rei de Ferro"` by `"Maurice Druon"`, original `"Les rois maudits. Le roi de fer"`; answers are `{ "Les rois maudits. Le roi de fer": [workOf("Les Rois maudits", "Maurice Druon", "OL15W")] }`.
  - `calls` is `[["Les rois maudits. Le roi de fer", "maurice druon"]]`.
  - `[report.subtitle, report.lookups, report.found, report.added, report.codeMerges]` is `[0, 1, 0, 0, 0]`.
  - The work stays its own canonical work.

- [ ] **Step 6: Update `backend/README.md`**

- **Guard paragraph** (the one starting "The code steps and the server's live matching never join on an original title that three or more…"): say that distinct Portuguese titles are counted with their part after a colon. Bracketed notes and parts after a dash or full stop are not counted, so "Crónicas: Aurora" and "Crónicas: Crepúsculo" are two titles, while "[EBOOK] O Principezinho" and "O Principezinho - Edição Interativa" are one.
- **"Fetching missing originals" skip list:** drop "a full stop (`". "`)" from the `subtitle` reasons. Add that an original with a full stop is looked up under its whole title.
- **Arrivals paragraph:** add that an original with a full stop is reached only by the fill and the backlog. Its claimants are stored under the stem key ("mr|" for "Mr. Mercedes"), so an arriving "Mr. Mercedes" doesn't find them.

- [ ] **Step 7: Verify and commit**

Run: `node scripts/gate.mjs`
Expected: every Verify command for `packages/` and `backend/` passes.

```bash
git add packages/shared/src/library/bookMatch.ts backend/src/modules/books/domain/translation.ts backend/src/modules/books/domain/translation.test.ts backend/src/modules/books/seed/originalsFill.ts backend/src/modules/books/seed/originalsFill.test.ts backend/src/modules/books/originalArrivals.ts backend/src/modules/books/originalArrivals.test.ts backend/README.md && git commit -m "Count colon-subtitled titles apart in Guard 1, stop cutting titles at a full stop, and share the claim grouping"
```

---

### Task 2: The code step reads whole edition titles and filters by surname

**Files:**
- Modify: `backend/src/modules/books/domain/ports.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Modify: `backend/src/modules/books/translationJudgments.ts`
- Modify: `backend/src/modules/books/seed/originalsFill.ts`
- Modify: `backend/src/modules/books/originalArrivals.ts`
- Test: `backend/src/modules/books/translationJudgments.test.ts`
- Test: `backend/src/modules/books/seed/originalsFill.test.ts`
- Modify: `backend/README.md`

**Interfaces:**
- Consumes: `titlePatterns`, `sameWholeTitle`, `surnameOf` and `mentionsSurname` from Task 1.
- Produces: `BooksRepository.titleCandidates(pattern: string): Array<{ id: string; title: string }>`, the distinct pairs of live work id and edition title. The SQL is `SELECT DISTINCT COALESCE(w.merged_into, w.id) AS id, b.title FROM books b JOIN works w ON w.id = b.work_id WHERE b.title_key GLOB ?`.
- `planMatch`'s signature and `MatchPlan` are unchanged. `seed/originalsFill.ts` no longer exports `sameWholeTitle`, and every caller imports it from `domain/translation.js`.

- [ ] **Step 1: Write the failing `planMatch` tests in `translationJudgments.test.ts`**

- **Change** "one title match whose author's surname the work names is settled by code": the Portuguese edition's `originalTitle` becomes `"To the Lighthouse"`.
- **Change** "a title match the work can't vouch for, or two of them, goes to Jev":
  - Its Keats half now expects `{ kind: "code", intoWorkId: <Keats work> }`. Rename it `test("a title match the work can't vouch for goes to Jev, and another author's book of that title doesn't")`.
  - Add a second "Poems" work by `"John Keats"` (`workKey` `"OL934W"`) to a fresh repo. `planMatch` for the Keats translation is then `ask`, with both Keats works among the candidates.
- **Add** `test("a subtitle on either side leaves the match to Jev")`. Each case is `ask`, with the English work among `candidates`:
  - an English `"Dune"` by `"Frank Herbert"` and a Portuguese `"O Messias de Duna"` with original `"Dune: Messiah"` and author `"Frank Herbert"`;
  - an English `"The Road"` by `"Cormac McCarthy"` and a Portuguese `"A Estrada"` by `"Cormac McCarthy"` with original `"The Road — A Novel"`;
  - an Italian `"Fairy Oak: Il segreto delle gemelle"` by `"Elisabetta Gnone"` and a Portuguese `"Capitão Grisam"` by `"Elisabetta Gnone"` with original `"Fairy Oak"`.
- **Add** `test("an original with a full stop is found under its whole title")`: an English `"Mr. Mercedes"` by `"Stephen King"`, and a Portuguese `"O Senhor Mercedes"` by `"Stephen King"` with original `"Mr. Mercedes"`. The plan is `{ kind: "code", intoWorkId: <English work> }`.
- **Add** `test("bracketed notes don't stop a code join, but a bracketed volume does")`:
  - An English `"A Game of Thrones (A Song of Ice and Fire, #1)"` by `"George R. R. Martin"`, and a Portuguese `"A Guerra dos Tronos"` by `"George R. R. Martin"` with original `"A Game of Thrones"`. The plan is code into the English work.
  - A Portuguese `"Um Farol"` by `"Virginia Woolf"` with original `"To the Lighthouse (Book 1)"`, against an English `"To the Lighthouse"`. The plan is `ask`.
- **Add** `test("the edition's whole title decides, wherever the edition was merged")`:
  - A Portuguese `"Passeio ao Farol"` by `"Virginia Woolf"`, `workKey` `"OL940W"`, original `"To the Lighthouse"`.
  - Then an edition `"To the Lighthouse"` by `"Virginia Woolf"` with the same `workKey`. It lands in the Portuguese work, whose work title stays Portuguese.
  - Then a second Portuguese `"Rumo ao Farol"` by `"Virginia Woolf"` with original `"To the Lighthouse"`.
  - `planMatch` for the second is code into the first work's id.
- **Add** `test("a candidate whose author has no usable surname is not vouched for")`: an English `"Orlando"` by `"Li Bo"`, and a Portuguese `"Orlando, Uma Biografia"` by `"Li Bo"` with original `"Orlando"`. The plan is `ask`, with the English work among the candidates.

- [ ] **Step 2: Write the failing fill test in `originalsFill.test.ts`**

`test("a second shelved copy joins the original that a killed run left inside the first copy's work")`:
- Setup:
  - `first`: `portuguese(repo, "Passeio ao Farol", "Virginia Woolf", "To the Lighthouse", "OL930W")`;
  - an edition `"To the Lighthouse"` by `"Virginia Woolf"` with `workKey` `"OL930W"`, which joins `first`'s work;
  - `second`: `portuguese(repo, "Passeio ao Farol", "Virginia Woolf", "To the Lighthouse")`.
- Run `fillOriginals(deps, [second.work_id!], LIVE)` with no answers.
- `report.presentWorks` is `[{ workId: second.work_id, title: "Passeio ao Farol", originalTitle: "To the Lighthouse" }]`, and `[report.lookups, report.codeMerges]` is `[0, 1]`.
- `second`'s canonical work is `first.work_id`.

`test("an original with a full stop is fetched and joined under its whole title")`:
- A Portuguese `"O Senhor Mercedes"` by `"Stephen King"`, original `"Mr. Mercedes"`; answers are `{ "Mr. Mercedes": [workOf("Mr. Mercedes", "Stephen King", "OL41W")] }`.
- `[report.lookups, report.found, report.added, report.codeMerges]` is `[1, 1, 1, 1]`.

- [ ] **Step 3: Run them and see them fail**

Run: `npm run build --workspace @scripta/shared && cd backend && npx tsx --test src/modules/books/translationJudgments.test.ts src/modules/books/seed/originalsFill.test.ts`
Expected: FAIL for these reasons:
- the Keats case is `ask`;
- "Dune: Messiah", "The Road — A Novel" and "Fairy Oak" are code;
- the "Mr. Mercedes" `planMatch` is not code, and the fill adds that original but `codeMerges` is 0, because the old pattern only searches `ta:mr|*|`;
- the second shelved copy is not listed.

The edition-title, "Li Bo" and bracketed-volume tests already pass. They guard behaviour that must not change.

- [ ] **Step 4: Implement the change**

- **`ports.ts` and the repository:** the new `titleCandidates` type and SQL from Interfaces.
- **`planMatch`:**
  - Title rows are `titlePatterns(original).flatMap(repo.titleCandidates)` without `workId`.
  - `byTitle` is their distinct ids, in order.
  - When there is an original, and neither the original nor the Portuguese work's own title (`evidence.title`) has a volume marker, as today, collect the distinct ids of rows with `sameWholeTitle(row.title, original)`. Keep the `matchCandidates` of those whose author's `surnameOf` is named by `mentionsSurname([workAuthor, author, ...summaries], surname)`. Exactly one gives `{ kind: "code", intoWorkId }`.
  - The `ask` list and the early `none` return are unchanged.
- **`originalsFill.ts`:**
  - Delete the local `sameWholeTitle` and import it from `../domain/translation.js`.
  - The present check reads `titlePatterns(original).flatMap(repo.titleCandidates)` without `workId`. `present` counts when any row exists, and `presentWorks` takes the work when a row has `sameWholeTitle(row.title, original)`.
- **`originalArrivals.ts`:** import `sameWholeTitle` from `./domain/translation.js`.

- [ ] **Step 5: Run the backend suite and see it pass**

Run: `cd backend && npm test`
Expected: PASS. That includes `originalArrivals.test.ts`, `translationBacklog.test.ts`, `calibration` and `seriesMergeRepair` tests, unchanged.

- [ ] **Step 6: Update `backend/README.md`**

- **Translation backlog,** step 2 or the guard paragraph: say "the clear matches" are code-joined. That means exactly one candidate work holds an edition whose whole title, bracketed words aside, is the original title, by an author whose surname the work names. A subtitle the other side lacks, after a colon, dash or full stop, leaves the match to Jev.
- **"Fetching missing originals",** `present`: it goes to the code step only when an edition of another work carries the whole original title, wherever that edition sits.

- [ ] **Step 7: Verify and commit**

Run: `node scripts/gate.mjs`
Expected: all Verify commands pass.

```bash
git add backend/src/modules/books/domain/ports.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts backend/src/modules/books/translationJudgments.ts backend/src/modules/books/seed/originalsFill.ts backend/src/modules/books/originalArrivals.ts backend/src/modules/books/translationJudgments.test.ts backend/src/modules/books/seed/originalsFill.test.ts backend/README.md && git commit -m "Join translations in code only on a whole edition title by a named author"
```

