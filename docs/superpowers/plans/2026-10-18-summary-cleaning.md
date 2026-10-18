# Summary Cleaning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every book summary is cleaned by one shared function before it is stored, and the summaries already stored are re-cleaned by a one-off backfill. The backfill keeps every synopsis decision, except the Jev hides the spec drops.

**Architecture:**
- `@scripta/shared` gains `htmlToText`/`decodeHtmlEntities` (`library/htmlText.ts`) and `cleanSummary` (`library/summaryCleaning.ts`).
- Adapters turn their raw format into text. The books repository runs `cleanSummary` on its two summary writes, so text and hash always agree.
- A seed module plus script (`summaryCleanup.ts`, `scripts/clean-summaries.mjs`) re-cleans stored rows and carries `synopsis_judgments` to the new hashes.

**Tech Stack:** TypeScript, `node:test` + tsx, `node:sqlite`. Backend consumes `@scripta/shared` from `dist`.

**Spec:** `docs/superpowers/specs/2026-10-18-summary-cleaning-design.md`

## Global Constraints

- No comments in code (root `AGENTS.md`). The why goes in commit messages.
- No new dependencies.
- `@scripta/shared` code is platform-neutral: no Node-only APIs (`packages/AGENTS.md`). Rebuild it (`npm run build --workspace @scripta/shared`) before any backend typecheck or test.
- Backend `npm test` names its files explicitly. Add every new backend `*.test.ts` to `backend/package.json`'s `test` script.
- `cleanSummary` is idempotent: `cleanSummary(cleanSummary(x) ?? "") === cleanSummary(x)` for every non-null result.
- Values from the spec and code:
  - `SYNOPSIS_HIDE_BELOW = 0.15` and `SYNOPSIS_MIN_LETTERS = 40`. Import both from `backend/src/modules/books/domain/synopsis.ts`; don't copy them.
  - `MIN_SYNOPSIS = 80` in `publisherFeed.ts`.
  - Short-line limit: 80 characters.
  - Wrapped-prose line length: 45 characters or more.
  - Wrapped-prose run: 3 or more units.
- Removal rules are anchored: a whole short line, or a known block running to the end. When unsure, leave text in. Verse line breaks stay.
- Every `manual` and `rule` judgment survives the backfill. A Jev hide (model neither `manual` nor `rule`, `usable < SYNOPSIS_HIDE_BELOW`) on changed text is dropped (owner's decision, 2026-10-18).
- The background synopsis sweep only judges works someone holds (`synopsisJudgments.ts:103-104`). Dropped and unjudged hashes on other works wait for `synopsis-backlog.mjs`, which the runbook runs right after the backfill. A changed text that cleans to a fragment gets a `rule` hide from the backfill itself, unless it has a `manual` judgment.
- **Deviation from the spec's step order:** `cleanSummary` runs `cleanCatalogText` *before* mapping C1 controls. `stripNonSortingMarkers` and `repairMojibake` read U+0080–U+009F as bytes, so mapping first would corrupt them.
- A line that is only a Markdown rule (`---`, `***`, `----------`) is removed, not used as a cut-to-end marker (spec step 5).
- **Addition to the spec:** stripping "Título original X" lines would lose evidence that `fillOriginalTitlesFromSummaries` and translation grouping read (`sqliteBooksRepository.ts:161,378,918`). So the repository's `mergeDetails` and the backfill both fill a NULL `books.original_title` from the raw text, using `originalTitleIn` from `backend/src/modules/books/domain/translation.ts`, before they store the cleaned text.

## Review Focus

1. **A summary that is only chrome or metadata.** It must become NULL: a cleaned `null` at ingest keeps the stored text, and the backfill sets `summary`, `summary_hash` and `summary_source` to NULL. Pinned in Task 2 and Task 4.
2. **Real prose starting with a label word** ("Formato de bolso, …", "Edição revista …", "Data de 1922 …") must survive. Pinned in Task 2.
3. **Text with newlines and only inline tags** (`<i>`, `<b>`, ISBNdb and stored rows) must keep its line breaks. Only block tags or `<br>` switch to HTML whitespace rules. Pinned in Task 1.
4. **A row edited between the backfill's scan and its write** must be skipped, not overwritten. Pinned in Task 4.
5. **A whitespace-only change** keeps the same hash. Its judgment, a Jev hide included, must stay untouched and not be counted as dropped. Pinned in Task 4.

---

### Task 1: Shared HTML-to-text

**Files:**
- Create: `packages/shared/src/library/htmlText.ts`
- Create: `packages/shared/src/library/htmlText.test.ts`
- Modify: `packages/shared/src/library/index.ts`
- Modify: `backend/src/modules/books/seed/publisherFeed.ts`
- Modify: `backend/src/modules/books/adapters/isbndb/isbndbCatalog.ts`
- Test: `backend/src/modules/books/adapters/isbndb/isbndbCatalog.test.ts`
- Test: `backend/src/modules/books/seed/publisherFeed.test.ts`

**Interfaces:**
- Produces:
  - `decodeHtmlEntities(text: string): string`
  - `htmlToText(html: string): string`
  - Both are exported from `@scripta/shared`.

- [ ] **Step 1: Write the failing tests** in `htmlText.test.ts`:

```ts
test("block tags make paragraphs and br makes a line", () => {
  assert.equal(htmlToText("<p>Um.<br>Dois.</p><p>Três.</p>"), "Um.\nDois.\n\nTrês.");
});
test("source whitespace in HTML collapses to one space", () => {
  assert.equal(htmlToText("<p>Uma frase\n   partida no código.</p>"), "Uma frase partida no código.");
});
test("text with no block tags keeps its newlines", () => {
  assert.equal(htmlToText("Linha um,\nlinha dois.\n\nOutro parágrafo &amp; fim."), "Linha um,\nlinha dois.\n\nOutro parágrafo & fim.");
  assert.equal(htmlToText("Parágrafo um com <i>x</i>.\n\nParágrafo dois."), "Parágrafo um com x.\n\nParágrafo dois.");
});
test("comments and processing instructions go", () => {
  assert.equal(htmlToText("<p><!--StartFragment-->Texto.<!-- fim --></p><?xml:namespace prefix = o />"), "Texto.");
});
test("double-escaped markup decodes fully", () => {
  assert.equal(htmlToText("&amp;lt;b&amp;gt;Título&amp;lt;/b&amp;gt; e mais"), "Título e mais");
});
test("escaped tags are removed after decoding", () => {
  assert.equal(htmlToText("&lt;i&gt;Resurrection&lt;/i&gt;, the last novel"), "Resurrection, the last novel");
  assert.equal(htmlToText("<p>I &lt;3 books</p>"), "I <3 books");
});
test("script, style and table cells", () => {
  assert.equal(htmlToText("<style>p{}</style><script>x()</script><table><tr><td>A</td><td>B</td></tr></table>"), "A B");
});
test("entities", () => {
  assert.equal(decodeHtmlEntities("&#8211; &#x2014; &hellip; &euro; &sect; &times; a&shy;b &nbsp;x &#99999999;"), "– — … € § × ab  x &#99999999;");
});
```

- [ ] **Step 2: Run them and see them fail.** Run `node --import tsx --test src/library/htmlText.test.ts` in `packages/shared`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement `htmlText.ts`.**
  - Move `decodeEntities`, `NAMED_ENTITIES`, the code-point guards, `BLOCK_TAG`, `CELL_TAG` and the `script`/`style` removal out of `publisherFeed.ts`. Extend the named table with `euro`, `sect`, `times`, and `shy` mapped to `""`.
  - The tag pass strips real tags (`/<\/?[a-z][a-z0-9]*\b[^<>]*>/i`), comments (`<!--…-->`), and `<?…>`/`<!…>` declarations, so `<3` survives.
  - Entity decoding repeats until the text stops changing, with a bound of a few passes.
  - `htmlToText`:
    - If the input has no block tag and no `<br>`: strip inline tags, decode entities, run the tag pass again if decoding produced a tag, normalise each line's spaces, and keep newlines.
    - Otherwise:
      1. Collapse all source whitespace to single spaces.
      2. Turn `br` into `\n`, and block tags into `\n\n`.
      3. Turn cells into a space, and strip the remaining tags.
      4. Decode entities.
      5. Repeat the tag pass if decoding produced a tag.
      6. Collapse runs of spaces within each line, trim lines, turn 3+ newlines into 2, and trim.
  - Export both functions from `library/index.ts`.

- [ ] **Step 4: Switch the callers.**
  - `publisherFeed.ts`:
    - `textLines(html)` becomes `htmlToText(html).split("\n").map(trim).filter(nonEmpty)`, which gives the same lines as today.
    - Every remaining `decodeEntities` call becomes `decodeHtmlEntities`: `publisherFeed.ts:170,189,225`, `wooAttribute` and `parseWooProducts`.
  - `isbndbCatalog.ts`: `plainText(value)` returns `htmlToText(value) || null` for strings, and its `ENTITIES` table goes.
  - Update the ISBNdb test's expected summary to `'Set on the desert planet Arrakis.\nPaul & Jessica "flee".\n\nThe spice must flow.'`. `</p><p>` is now a paragraph.

- [ ] **Step 5: Run the tests and see them pass.**
  - `npm run build --workspace @scripta/shared && npm test --workspace @scripta/shared`
  - `npm run typecheck --workspace backend && npm test --workspace backend`
  - Expected: all PASS. `publisherFeed.test.ts` passes unchanged.

- [ ] **Step 6: Commit** with message `Share HTML-to-text between the publisher feed and ISBNdb`.

---

### Task 2: `cleanSummary`

**Files:**
- Create: `packages/shared/src/library/summaryCleaning.ts`
- Create: `packages/shared/src/library/summaryCleaning.test.ts`
- Modify: `packages/shared/src/library/mojibake.ts`
- Modify: `packages/shared/src/library/bookMetadata.ts`
- Modify: `packages/shared/src/library/index.ts`
- Modify: `backend/src/modules/books/seed/publisherFeed.ts`
- Modify: `backend/src/modules/works/service.ts`
- Test: `packages/shared/src/library/bookMetadata.test.ts`

**Interfaces:**
- Consumes: `htmlToText`, `decodeHtmlEntities` (Task 1), and `cleanCatalogText`.
- Produces:
  - `cleanSummary(text: string): string | null`
  - `STRICT_METADATA_LABEL: string` and `LOOSE_METADATA_LABEL: string`. These are regex source fragments.
  - `fromWindows1252Controls(text: string): string`, in `mojibake.ts`.
  - `plainDescription` is deleted, and `openLibraryDescription` returns `cleanSummary(description)`.

- [ ] **Step 1: Write the failing tests** in `summaryCleaning.test.ts`. Each `[input, expected]` pair asserts `cleanSummary(input) === expected`, and also idempotence (`cleanSummary(expected) === expected`). The texts are synthetic.

```ts
const P = "Uma rapariga parte de Lisboa à procura do irmão desaparecido e descobre uma cidade que não conhecia.";
const cases: Array<[string, string, string | null]> = [
  ["presença details block", `${P}\n\nDetalhes\n\nTítulo Original THE LOST BROTHER\n\nCategoria Ficção\n\nSub-categoria Romance\n\nSérie Lisboa\n\nNº de Páginas 320\n\nData de Lançamento 03/2024\n\nDimensões 230 x 150 x 20 mm\n\nFormato Capa Mole\n\nPeso 420g\n\nAutores Ana Lima\n\nCitações\n\nCríticas\n\nPrémios`, P],
  ["favourites chrome", `${P}\n\nAdicionar aos Favoritos\n\nAdicionar aos FavoritosJá se encontra nos favoritos`, P],
  ["labels without colon", `${P}\n\nTítulo original Island\n\nTradução Maria Dias\n\n3.ª reimpressão Outubro 2024\n\nPáginas 464\n\nFormato 13 x 21 cm\n\nEAN 9789898327123\n\n[data_lancamento]2024-05-01`, P],
  ["open library tail", "First paragraph.\r\n\r\n----------\r\nAlso contained in:\r\n - [Novels][1]\r\n\r\n  [1]: https://openlibrary.org/works/OL1W", "First paragraph."],
  ["open library source lines", "Buona lettura,\r\nGli editori\r\n([source][1])\r\n\r\n  [1]: https://example.org/x", "Buona lettura,\nGli editori"],
  ["from url", "It lasts.\r\n\r\n(From https://en.wikipedia.org/wiki/X)", "It lasts."],
  ["source url", "It lasts.\n\nSource: http://www.example.org/works/", "It lasts."],
  ["leftover html", "<b>Entre o passado e o futuro.</b> <p></p> Chegou a altura.", "Entre o passado e o futuro.\n\nChegou a altura."],
  ["c1 punctuation", "Disse\u0085 e saiu \u0097 sem olhar para \u0093trás\u0094.", "Disse… e saiu — sem olhar para “trás”."],
  ["mojibake", "JosÃ© partiu de manhÃ£ cedo para a cidade.", "José partiu de manhã cedo para a cidade."],
  ["glued sentence", "They expect the summers will go on forever.In this novel, time passes.", "They expect the summers will go on forever. In this novel, time passes."],
  ["leading label", "SINOPSE Plano Nacional de Leitura, livro recomendado para o 1.º ano.", "Plano Nacional de Leitura, livro recomendado para o 1.º ano."],
  ["leading label with colon", "Sinopse: Uma viagem longa pelo interior do país.", "Uma viagem longa pelo interior do país."],
  ["inline tag between paragraphs", "Parágrafo um com <i>Dune</i>.\n\nParágrafo dois.", "Parágrafo um com Dune.\n\nParágrafo dois."],
  ["double-escaped html", "&amp;lt;b&amp;gt;Entre o passado e o futuro.&amp;lt;/b&amp;gt;", "Entre o passado e o futuro."],
  ["leading label line", "Resumo\n\nO leitor curioso encontra aqui a resposta.", "O leitor curioso encontra aqui a resposta."],
  ["hyphenated wrap", "Um silêncio rigoro-\n\nso, feito de planos contínuos.", "Um silêncio rigoroso, feito de planos contínuos."],
  ["wrapped prose", "Esta é a história de um rapaz que vivia numa ilha pequena, com os\n\nseus barcos de papel e a sua linda cabra branca, e usava um longo\n\ncasaco que o vento levantava. Um dia decidiu partir e chegou a\n\nLisboa, onde encontrou um amigo.", "Esta é a história de um rapaz que vivia numa ilha pequena, com os seus barcos de papel e a sua linda cabra branca, e usava um longo casaco que o vento levantava. Um dia decidiu partir e chegou a Lisboa, onde encontrou um amigo."],
  ["markdown", "*Mrs. Dalloway* became the **inspiration** for \\[a\\] novel.", "Mrs. Dalloway became the inspiration for [a] novel."],
  ["spaces", "One  sentence\there.\n\n\n\nNext.  ", "One sentence here.\n\nNext."],
];
```

Plus these tests:
- **Unchanged text:**
  - The verse `"Levo no bolso uma pedra do rio\n\ne uma folha que o vento esqueceu,\n\nguardo-as para o inverno."`.
  - The prose `"Formato de bolso, este livro reúne contos de verão."`, `"Edição revista e aumentada, com um novo prefácio do autor."` and `"Data de 1922 o primeiro manuscrito conhecido desta obra."`.
  - `"Visite www.editora.pt/livros.Novidades para mais."`, which would trigger the glued-sentence rule without the URL skip.
  - `"Sinopse da editora."` and `"Resumo de uma vida, contado pela filha."`, which are leading-label words in prose.
  - `"Os E.U.A. e o Sr.Silva."`.
  - `P` itself.
- **Null:** `cleanSummary("Título original Island\n\nPáginas 464")`, `cleanSummary("Adicionar aos Favoritos")` and `cleanSummary("  ")` are all `null`.
- **Fragment kept:** `cleanSummary("Texto curto.")` is `"Texto curto."`. Fragments are kept; hiding them is the judgment's job.
- **Migrated Markdown cases:** move the three `plainDescription` cases from `bookMetadata.test.ts` here, calling `cleanSummary`. They keep their current expectations, with one change: the `([Source][2])` line is now cut (the match ignores case), so the first case ends at `"Followed by: A Storm of Swords"`. Keep the `openLibraryDescription` cases in `bookMetadata.test.ts` unchanged.

- [ ] **Step 2: Run them and see them fail.** Run `node --import tsx --test src/library/summaryCleaning.test.ts` in `packages/shared`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - **`mojibake.ts`:** add `fromWindows1252Controls`. It maps U+0080+i to `WINDOWS_1252_HIGH[i]`, and drops the five undefined positions (U+0081, 008D, 008F, 0090, 009D).
  - **`summaryCleaning.ts`:** `cleanSummary` follows the spec's steps 1–11, except that step 2 runs `cleanCatalogText` and then `fromWindows1252Controls`.
  - **Label rule:**
    - `STRICT_METADATA_LABEL` covers: Título original, Tradução, Tradutor(a), Traduzido, Páginas, Nº/N.º de Páginas, Núm. pág., Dimensões, Encadernação, Formato, Formato Capa, Peso, Categoria, Sub-categoria, Série, Data de Lançamento, Autores, EAN, ISBN, Coleção/Colecção.
    - `LOOSE_METADATA_LABEL` covers: Edição, Data, Ano, Preço, Autor(a). These need a colon, or a value that is a date, number or measurement.
    - A line is removed only when it is 80 characters or less, starts with a label, and doesn't end in `.`, `!`, `?`, `»` or `"`.
  - **Wrap join:**
    - Units are separated by `\n` or `\n\n`.
    - A boundary is joinable when the unit before is 45 characters or more, doesn't end in `.!?:;…»"”)`, and the next unit starts with a letter or digit.
    - A maximal chain of 2 or more joinable boundaries (3 or more units), with at least one lowercase start, joins with spaces.
    - A trailing hyphen after a lowercase letter, followed by a lowercase start, joins with no space, whatever the run length.
  - **Glued-sentence rule:** skip tokens that contain `://` or `www.`.
  - **Ordering:** the `([source][n])` cut ignores case, and runs before Markdown link conversion, which would otherwise turn it into `(source)`.
  - **Leading label:** strip it only when a colon, a dash or the end of the line follows it, or when the label is in capitals (`SINOPSE`, `SOBRE O LIVRO`).
  - **`bookMetadata.ts`:** delete `plainDescription`. `openLibraryDescription` returns `cleanSummary(description)`.
  - **`publisherFeed.ts`:** `METADATA_LABEL` becomes `` `${STRICT_METADATA_LABEL}|${LOOSE_METADATA_LABEL}` ``. The feed's `METADATA_LINE` is otherwise unchanged.
  - **`works/service.ts:93`:** becomes `summary ? cleanSummary(summary) : null`.
  - **Exports:** export `summaryCleaning.ts` from `library/index.ts`.

- [ ] **Step 4: Run the tests and see them pass.**
  - `npm run build --workspace @scripta/shared && npm test --workspace @scripta/shared`
  - `npm run typecheck --workspace backend`
  - `npm test --workspace backend`
  - Expected: all PASS.

- [ ] **Step 5: Commit** with message `Add cleanSummary for every summary source`.

---

### Task 3: Clean on every write

**Files:**
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Modify: `backend/src/modules/books/seed/publisherFeed.ts`
- Test: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`
- Test: `backend/src/modules/books/seed/publisherFeed.test.ts`
- Test: `backend/src/modules/books/translationBacklog.test.ts`

**Interfaces:**
- Consumes: `cleanSummary` (Task 2), `htmlToText` (Task 1), `originalTitleIn` and `summaryHashOf`.
- Produces: no new names. `synopsis` in `publisherFeed.ts` changes to `synopsis(html: string): string | null`.

- [ ] **Step 1: Write the failing tests.**
  - In `sqliteBooksRepository.test.ts`:
    - **`mergeDetails stores the cleaned summary and the hash of the cleaned text`:**
      - Merge `"Sinopse da editora.\r\n\r\nAdicionar aos Favoritos"` as `publisher`.
      - Assert the stored `summary` is `"Sinopse da editora."`, and `summary_hash` equals `summaryHashOf("Sinopse da editora.")`.
    - **`a summary that cleans to nothing keeps the stored one`:**
      - Merge `"Uma sinopse."` as `isbndb`, then `"Adicionar aos Favoritos"` as `publisher`.
      - Assert the summary is still `"Uma sinopse."` with source `isbndb`.
    - **`mergeDetails fills a missing original title from the raw summary`:**
      - Merge `"Uma sinopse longa o bastante.\n\nTítulo original The Island"` as `publisher` on a book with no `original_title`.
      - Assert `original_title` is `"The Island"` and the summary is `"Uma sinopse longa o bastante."`.
      - Merge again with a different original title in the text, and assert the first is kept.
    - **`setWorkSummary stores the cleaned text`:** pass `"Work text.\r\n\r\n----------\r\nAlso contained in:\r\n - X"`, and assert the work summary is `"Work text."` with the matching hash.
  - In `publisherFeed.test.ts`:
    - A Shopify body made of a synopsis paragraph followed by a Presença-style "Detalhes" block of `<p>` lines gives the synopsis only.
    - A Woo description ending in `<p>Adicionar aos Favoritos</p>` gives the synopsis only.
    - `<p>` + three long `<br>`-wrapped prose lines give one joined paragraph.
    - `<p>` + three short `<br>` verse lines, followed by a synopsis paragraph, keep the verse as `\n`-separated lines and the paragraph after `\n\n`.
    - A description that is 70 characters of synopsis plus 30 characters of "Adicionar aos Favoritos" gives `null`. Cleaning runs before the 80-character minimum.

- [ ] **Step 2: Run them and see them fail.** Run `cd backend && npx tsx --test src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts src/modules/books/seed/publisherFeed.test.ts`. Expected: the new tests FAIL.

- [ ] **Step 3: Implement.**
  - **`mergeDetails`:**
    - Compute `const summary = details.summary ? cleanSummary(details.summary) : null`. Bind `$summary` and `$summary_hash` from it.
    - Add `original_title = CASE WHEN ${takesSummary} THEN COALESCE(original_title, $original_title) ELSE original_title END`, with `$original_title = details.summary ? originalTitleIn(details.summary) : null`.
  - **`setWorkSummary`:** clean before hashing. Skip the write when cleaning gives `null`.
  - **`synopsis(html)` in `publisherFeed.ts`:**
    1. `htmlToText(html)`.
    2. Drop lines matching `METADATA_LINE`, `ONLY_FIGURES` or `SHOP_NOTICE`, keeping the `\n` and `\n\n` structure of the lines that remain.
    3. `cleanSummary`.
    4. Return `null` below `MIN_SYNOPSIS`.
  - **Call sites:** Shopify passes `text(product.body_html)`, and Woo passes `text(product.description)` and `text(product.short_description)`. Their `lines` stay for `feedTextDetails` and `originalTitleIn`.
  - **Existing expectations:** update an existing `publisherFeed.test.ts` expectation only where `<br>` now gives `\n` instead of `\n\n`. Say which ones in the commit message.
  - **Legacy-row tests:** `translationBacklog.test.ts:56-57` and `sqliteBooksRepository.test.ts:1716-1722` seed labelled summaries through `mergeDetails`, which now fills `original_title` and strips the line. Seed those summaries with direct SQL `UPDATE books SET summary = ?` instead. The tests then keep covering `fillOriginalTitlesFromSummaries` on rows stored before this change, and their asserted counts stay as they are.

- [ ] **Step 4: Run the tests and see them pass.** Run `npm run build --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend`. Expected: all PASS.

- [ ] **Step 5: Commit** with message `Clean summaries at the storage boundary`.

---

### Task 4: Backfill with judgment carry

**Files:**
- Create: `backend/src/modules/books/seed/summaryCleanup.ts`
- Create: `backend/src/modules/books/seed/summaryCleanup.test.ts`
- Create: `backend/scripts/clean-summaries.mjs`
- Modify: `backend/package.json`
- Modify: `backend/README.md`

**Interfaces:**
- Consumes:
  - `cleanSummary`.
  - `summaryHashOf`, `isFragment`, `SYNOPSIS_HIDE_BELOW` and `SynopsisJudgment`, from `domain/synopsis.ts`.
  - `originalTitleIn`.
  - `reportJson`, from `seed/mojibakeRepair.ts`.
- Produces:

```ts
export interface SummaryChange { table: "books" | "works"; id: string; source: string | null; host: string | null; from: string; to: string | null; oldHash: string | null; newHash: string | null; originalTitle: string | null }
export type JudgmentOutcome = "carried" | "manual-replaced" | "rule" | "jev-hide-dropped" | "kept" | "unjudged";
export interface JudgmentAction { hash: string; outcome: JudgmentOutcome; write: SynopsisJudgment | null }
export interface SummaryCleanupPlan { scanned: { books: number; works: number }; changes: SummaryChange[]; judgments: JudgmentAction[] }
export interface SummaryCleanupApplied { books: number; works: number; emptied: number; skipped: number; originalTitles: number; judgmentsWritten: number }
export function planSummaryCleanup(db: DatabaseSync): SummaryCleanupPlan;
export function applySummaryCleanup(db: DatabaseSync, plan: SummaryCleanupPlan): SummaryCleanupApplied;
export function summaryCleanupReport(plan: SummaryCleanupPlan, applied: SummaryCleanupApplied | null): object;
```

- [ ] **Step 1: Write the failing tests** in `summaryCleanup.test.ts`. Use the env preamble and `:memory:` setup from `mojibakeRepair.test.ts`. Seed rows with direct SQL.
  - **Changed, unchanged and emptied rows:**
    - A publisher book whose summary has a "Detalhes" tail becomes the clean text with the new hash.
    - A clean book is not in `changes`.
    - A book whose summary is only "Adicionar aos Favoritos" ends with `summary`, `summary_hash` and `summary_source` all NULL.
    - A work with `\r\n` and an "Also contained in:" tail is cleaned.
  - **Judgment outcomes** (each checks `plan.judgments` and the `synopsis_judgments` rows after apply):
    - **Jev keep (usable 0.9):** `carried`, with a copy under the new hash, the same `model`, `usable`, `kind` and `asked_at`, and the old row left in place.
    - **Manual hide (usable 0):** `carried`.
    - **Jev hide (usable 0.1) on changed text:** `jev-hide-dropped`, and no row under the new hash.
    - **Rule hide:** `carried`.
    - **Jev keep whose cleaned text is a fragment:** `rule`, written as `{ model: "rule", usable: 0, kind: "fragment" }`.
    - **Manual keep whose cleaned text is a fragment:** `carried`, so the manual keep stays.
    - **Existing judgment on the new hash:**
      - A new hash that already has a Jev judgment while the old one has a Jev judgment: `kept`, existing unchanged.
      - The old one is `manual` and the existing one isn't: `manual-replaced`.
    - **Two books whose different old texts clean to the same new text:** one has a manual hide and the other a Jev keep, and the manual hide wins.
    - **No old judgment:** `unjudged`. If the cleaned text is a fragment, `rule`.
  - **Whitespace-only change** (e.g. `\r\n` to `\n`, same hash) under a Jev hide: the row text updates, `plan.judgments` has no entry for that hash, and the judgment row is untouched.
  - **Original title:** a book with NULL `original_title` whose old summary has "Título original The Island" ends with `original_title = "The Island"`. A book that already has one keeps it.
  - **Crash after the judgments:**
    - Add `CREATE TRIGGER fail BEFORE UPDATE ON books WHEN NEW.id = '<a changed book id>' BEGIN SELECT RAISE(ABORT, 'boom'); END`. `applySummaryCleanup` throws.
    - The carried judgment rows exist anyway, and that book's batch is rolled back.
    - Drop the trigger. A fresh plan plus apply finishes, and the judgments are unchanged.
  - **Edited since the scan:** change a row's summary after `planSummaryCleanup` and before `applySummaryCleanup`. It is counted in `skipped` and left as edited.
  - **Dry run and rerun:** the plan alone writes nothing (`dump()` before equals after). A second plan after apply has empty `changes`.
  - **Report:**
    - `summaryCleanupReport(plan, null)` has `books` and `works` counts (`scanned`, `changed`, `emptied`), `bySource`, `byHost`, the outcome counts, `samples` (at most 3 per host or source, `from` and `to` cut to 300 characters), and `applied: null`.
    - With `applied`, it also has `originals: [{ table, id, summary }]` for every changed row.

- [ ] **Step 2: Run them and see them fail.** Run `cd backend && npx tsx --test src/modules/books/seed/summaryCleanup.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement `summaryCleanup.ts`.**
  - **Plan:**
    - Read `books` (`id`, `summary`, `summary_hash`, `summary_source`, `original_title`, `coalesce(publisher_url, source_url)`) and `works` (`id`, `summary`, `summary_hash`) with a non-empty summary.
    - Clean each one. Keep a change only when `to !== from`.
    - `originalTitle` is `originalTitleIn(from)` only for books with NULL `original_title`.
    - Judgments: group the changes by `newHash`, skipping changes where `newHash === oldHash` or `newHash` is null.
    - For each group:
      1. Look up the judgments on its old hashes, and any existing one on the new hash.
      2. Choose among the old ones: manual, then rule, then latest `asked_at`.
      3. If an existing one is there: `manual-replaced` when the chosen one is manual and the existing one isn't, otherwise `kept`.
      4. Otherwise, if the text is a fragment and the chosen one is missing or non-manual: `rule`.
      5. Otherwise, if the chosen one is a Jev hide: `jev-hide-dropped`.
      6. Otherwise: `carried`, or `unjudged` when there is none.
  - **Apply:**
    - First, in one transaction, `INSERT OR REPLACE` every judgment action that has a `write`. A crash after this point loses no decision: a rerun skips rows already cleaned, and their judgments are already in place.
    - Then work in batches of 500 changes, one `BEGIN IMMEDIATE` transaction per batch.
    - Each update is `... WHERE id = ? AND summary = ?`; when it changes nothing, count `skipped`.
    - Books with an `originalTitle` get `original_title = COALESCE(original_title, ?)`.
    - Emptied books also clear `summary_source`.
  - **Report:** described in Step 1. Print it with `reportJson`.
  - **`clean-summaries.mjs`:** a copy of `repair-mojibake.mjs`'s shape. It parses `--dry-run`, imports the `dist` modules, opens a read-only `DatabaseSync` on a dry run and `openBooksDb()` otherwise, then plans, applies unless it's a dry run, and prints the report.
  - **`backend/package.json`:** add `src/modules/books/seed/summaryCleanup.test.ts` to the `test` script.
  - **`backend/README.md`:** add a "Summary clean-up" section after "Mojibake repair". It covers:
    - what the script changes, including the judgment outcomes and the original-title fill;
    - the order:
      1. Run it after the deploy that ships Task 3, and before any publisher import (`import-publisher-covers`). An import would rewrite publisher rows first, and their judgments would not be carried.
      2. Check the volume's free space with `railway volume list --json`.
      3. Run `--dry-run` and review the samples.
      4. Do the real run, redirecting its output to a local file.
      5. Run `synopsis-backlog.mjs --dry-run`, then for real, so the dropped Jev hides and any unjudged text are judged. The background sweep only covers held works.
    - saving the real run's output, which holds every original text (about 12k texts, so redirect it to a file);
    - holding production deploys while it runs, because a deploy kills the job;
    - the two `railway ssh` commands, in the same form as the mojibake ones, with `node scripts/clean-summaries.mjs`.

- [ ] **Step 4: Run the tests and see them pass.**
  - `npm run build --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend`
  - Then `node scripts/gate.mjs` from the worktree root.
  - Expected: all PASS.

- [ ] **Step 5: Commit** with message `Backfill: re-clean stored summaries and carry synopsis judgments`.
