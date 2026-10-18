# Summary cleaning — design

## Goal

Book summaries read badly in the app. Readers see shop page chrome, metadata lists, Markdown, line breaks in the middle of sentences and broken characters. The fix:

1. **One shared cleaner**, `cleanSummary` in `@scripta/shared`. Every summary goes through it before it is stored, whatever its source.
2. **Publisher-specific rules** inside that cleaner, for the shop page leftovers that make up most of the problem.
3. **A one-off backfill** that re-cleans the summaries already stored. It moves each summary's synopsis judgment to the cleaned text's hash, so no keep/hide decision is lost and Jev isn't asked again.

## Why

Summaries are cleaned once, when they come in. There are three unrelated cleaners, one per source, and nothing at render time:

| Source | Cleaner | What it misses |
|---|---|---|
| Open Library | `plainDescription` (`packages/shared/src/library/bookMetadata.ts`) | HTML, entities, `\r\n`, mojibake. "Also contained in:"/"Contains:" lists, "Source: url" and "(From https://…)" lines |
| ISBNdb | private `plainText` (`backend/src/modules/books/adapters/isbndb/isbndbCatalog.ts`) | Every entity except six (`&#8211;`, `&hellip;` stay literal). Markdown. Leading "SINOPSE" labels |
| Publisher feeds | private `textLines` + `synopsis` (`backend/src/modules/books/seed/publisherFeed.ts`) | Metadata lines without a colon. Shop chrome. `<br>` becomes a paragraph break. Escaped HTML is decoded after the tags are stripped, so it survives as tags |

Web (`whitespace-pre-wrap`) and mobile (`<Text>`) show the stored text exactly as it is. So a fix at the source plus a backfill fixes what readers see.

Rows stored before a cleaner existed or improved never got re-cleaned. `works.summary` is written only while it is NULL (`setWorkSummary`), so its stored Open Library text still carries `\r\n`, `----------` rules and `[1]: url` lines.

### Production on 2026-10-18 (read-only check)

Summaries readers can see (not hidden by a synopsis judgment):

| Scope | Shown | Hidden | Shown with any issue |
|---|---|---|---|
| Publisher editions | 17,994 | 1,840 | 11,914 |
| ISBNdb editions | 259 | 75 | 115 |
| Editions with no source | 44 | 2 | 23 |
| Open Library editions | 11 | 0 | 7 |
| Works | 111 | 8 | 78 |

Publisher shop leftovers, counted per shop over all publisher rows:

- **"Adicionar aos Favoritos"** (often twice), at the end: Relógio d'Água 1,716, Gradiva 1,345, Guerra e Paz 1,123, Divergência 187.
- **Presença "Detalhes" block** to the end: Título Original, Categoria, Sub-categoria, Série, Nº de Páginas, Data de Lançamento, Dimensões, Formato Capa, Peso, Autores, then the empty tab headings Citações, Críticas, Prémios. It appears on 4,104–4,167 of Presença's 4,167 rows.
- **Label lines without a colon**, such as "Título original Island", "Tradução Virgínia Motta", "3.ª reimpressão Outubro 2024", "Páginas 464", "Formato 13 x 21 cm" and "EAN 978…": Antígona, Orfeu Negro, INCM.
- **Template placeholder** "[data_lancamento]YYYY-MM-DD": about 1,170 rows.
- **Line breaks in the middle of sentences** (a lowercase letter or comma, a break, then a lowercase letter): about 700 rows across every shop. About 200 rows have three or more. Presença and Exclamação hard-wrap prose, and Exclamação also hyphenates ("rigoro-\n\nso"). Poetry excerpts (Afrontamento, Abysmo, INCM, Orfeu Negro) legitimately break lines.

Other patterns among shown summaries:

- **`\r\n`**: 77, almost all Open Library texts on works and editions with no source.
- **Open Library Markdown leftovers** (`----------`, `[1]: url`, `([source][1])`, `*Title*`, "Also contained in:" lists): about 45 in total.
- **C1 control characters**: about 300 in publisher text. These are Windows-1252 punctuation read as Latin-1: U+0097 —, U+0096 –, U+0085 …, U+0091–U+0094 ‘ ’ “ ”.
- **Literal HTML**: 87, e.g. `<b>`, `<p align = justify>`, `<i>`, `<a href>`. One of them is a work.
- **Undecoded entities**: 3 (`&nbsp;`, `&#8230;`).
- **Sentences glued without a space** ("forever.In this", "proeza.Não são"): about 250.
- **Leading section labels** ("SINOPSE", "Resumo", "SOBRE O LIVRO"): 28.
- **U+FFFD replacement characters** (lossy, can't be repaired): 3 ISBNdb rows.

## Non-goals

- **Rewriting or summarising text.** The cleaner fixes formatting and removes non-synopsis chrome. It never rephrases.
- **Teasers ending in "…"** and **walls of text with no paragraphs.** Both are left as they are.
- **The 3 rows with U+FFFD.** Leave them; they can be hidden from `/admin/synopses`.
- **The 320-character preview cut** (`summaryPreview`). Possible follow-up.
- **Re-fetching summaries from their sources.** The backfill works on the stored text only.
- **Titles, authors and other fields.** Summaries only.
- **Rendering Markdown or HTML** in the clients. Summaries stay plain text.

## Anti-goals

- **Losing real synopsis text.** A rule that might eat a sentence of the synopsis is worse than leaving chrome in. Every removal rule is anchored: a whole short line that matches a label, or a known shop block running to the end of the text.
- **Breaking poems.** Line breaks inside verse excerpts stay.
- **Losing a decision.** Every `manual` judgment (the owner's, and the 2026-10-16 Claude pass) and every `rule` hide survives the hash change. Jev keeps carry too. Only a Jev hide on changed text is re-asked (below).
- **A Jev bill.** The backfill leaves no hash without a judgment, apart from the Jev hides it deliberately drops for a re-ask.

## Design

### `cleanSummary(text: string): string | null`

A new module in `packages/shared/src/library/`, exported from the package. It is pure, deterministic and **idempotent**: `cleanSummary(cleanSummary(x)) === cleanSummary(x)`. The backfill and the write path depend on this. It takes plain text that may still contain leftovers, and returns the cleaned text, or `null` when nothing remains.

The steps, in order. The exact regexes are the builder's.

1. **Normalise line endings.** `\r\n` and `\r` become `\n`. Tabs and non-breaking spaces become spaces.
2. **Characters.** Map C1 controls U+0080–U+009F to their Windows-1252 characters where one exists, and drop the rest. Then run `cleanCatalogText` (mojibake repair and MARC markers).
3. **HTML.** If the text still contains tags or entities, run it through the shared `htmlToText` (below). Decode first and then strip tags, so escaped HTML (`&lt;b&gt;`) goes too.
4. **Open Library Markdown.** The existing `plainDescription` steps (reference lines, rules, links, emphasis, escapes) move here. `plainDescription` becomes a thin wrapper, or is replaced at its call sites. The trailing-section rules in step 5 are new.
5. **Trailing non-synopsis sections**, cut from a marker line to the end of the text:
   - Open Library: "Also contained in:", "Contains:", a line that is only a Markdown rule, "Source: <url>", "(From <url>)", "([source][n])".
   - Presença: a line that is exactly "Detalhes", when it is followed by a label line in the next few lines.
6. **Whole-line removals.** Each line is short (builder's limit, around 80 characters):
   - Shop chrome: "Adicionar aos Favoritos", "Já se encontra nos favoritos", and the same text glued onto the end of a line.
   - Template placeholders: `[data_lancamento]…`.
   - Metadata label lines, with or without a colon. Título original, Tradução, Tradutor, Páginas, Nº de Páginas, Formato, Formato Capa, Dimensões, Peso, Categoria, Sub-categoria, Série, Data de Lançamento, Autores, EAN, ISBN, Coleção/Colecção.
   - Edition lines like "6.ª EDIÇÃO 2024" or "3.ª reimpressão Outubro 2024".
   - The empty headings Citações, Críticas and Prémios when they are the last lines.
   - Move `METADATA_LABEL` from `publisherFeed.ts` to shared and extend it, rather than keeping two lists. Today it lacks Categoria, Sub-categoria, Série, Formato Capa, Autores, EAN and Nº de Páginas, and it only matches a label followed by a colon, a dash or the end of the line.
   - **My call:** in `cleanSummary` the label rule is narrower than the feed's, because it now runs on every source. A line is removed only when all of these hold: it is short, it starts with a label, and it doesn't end in sentence punctuation (`.`, `!`, `?`, `»`, `"`). The broad labels the feed also matches (Edição, Data, Ano, Preço, Autor) need a colon here, or a value shaped like a date, number or measurement. The feed's own `synopsis()` filter keeps its current reach.
7. **Leading labels.** Remove a first line that is only "Sinopse", "Synopsis", "Resumo", "Descrição", "Description", "Sobre o livro" or "About the book", or that prefix on the first line.
8. **Hard-wrapped prose.** Join a line break that is clearly a wrap, not a verse break:
   - A hyphen at the end of a line followed by a lowercase letter joins with no space ("rigoro-\nso" becomes "rigoroso").
   - A run of three or more consecutive lines that look like wrapped prose is joined with spaces. The lines are long (builder's threshold, around 45 characters or more), most end without sentence punctuation, and the next line starts lowercase.
   - Short-line runs are verse, and stay.
   - The detection is the builder's. Its tests must include one Presença-style wrapped paragraph that joins and one verse excerpt that doesn't.
9. **Glued sentences.** Insert a space in `<two lowercase letters>[.!?]<uppercase><lowercase>`, so "forever.In" becomes "forever. In". Two lowercase letters before the punctuation keep "U.S.A" and initials out.
10. **Whitespace.** Collapse runs of spaces. Trim each line. Three or more newlines become two. Trim the text.
11. **Too little left.** If the result is empty, return `null`. If it has fewer than `SYNOPSIS_MIN_LETTERS` letters, still return the text. New data: the fragment rule hides it, because a new hash has no judgment. Backfill: see the judgment rules below, since a carried judgment would otherwise stop the rule from firing.

**My call:** author bios ("Sobre o autor"), critics' quotes and prizes text stay in. They are content, not formatting. The synopsis judgment already classifies whole texts as `author_bio` or `praise`.

### `htmlToText(html: string): string`

The shared HTML-to-text step, built from `publisherFeed.ts`'s `textLines` and `decodeEntities` and moved into `@scripta/shared`:

- Block tags (`p`, `div`, `li`, headings and so on) become a paragraph break, `\n\n`.
- `<br>` becomes a single `\n`. This is the change from today's behaviour, where `<br>` became a paragraph. It keeps a verse line as a line, and lets step 8 join a wrapped prose line.
- `script` and `style` are dropped. Every numeric entity is decoded, and named entities from one shared table, which grows to cover `&euro;`, `&sect;`, `&times;`, `&shy;`.
- ISBNdb's `plainText` and the publisher feed both use it. ISBNdb keeps its own `plainText` for titles and publishers only if that is simpler (builder's call).

### Where the cleaner runs on new data

**My call:** at the storage boundary, in `sqliteBooksRepository.ts`, on the only two summary writes: `mergeDetails` (where `$summary_hash` is computed, guarded by `takesSummary`) and `setWorkSummary`. The stored text and its hash then always agree, and every source and future source is covered, whatever its adapter does.

If `cleanSummary` returns null in `mergeDetails`, the incoming summary counts as absent, and `takesSummary` keeps the stored one. That is intended: the backfill cleans the stored one.

Adapters keep converting their raw format to text: `htmlToText` for HTML sources, `openLibraryDescription` for Open Library. The publisher feed's `synopsis()` keeps its line filters. **My call:** it runs `cleanSummary` on the joined text *before* its 80-character minimum, so chrome can't carry a page over the bar. The repository cleans again, which is harmless because the cleaner is idempotent.

**My call:** `works/service.ts`'s read-time `plainDescription` call switches to `cleanSummary` and stays. It covers the gap between the deploy and the backfill, and it is cheap.

### The backfill

A script `backend/scripts/clean-summaries.mjs`, the same shape as `repair-mojibake.mjs`. Its logic lives in a tested module under `backend/src/modules/books/seed/`. It:

- runs `--dry-run` first, on a read-only connection, and prints a JSON report;
- without `--dry-run`, applies everything in a single transaction per batch;
- can run again as a no-op, because `cleanSummary` is idempotent.

For every row in `books` and in `works` (including merged works, which are harmless) with a non-empty summary:

1. `cleaned = cleanSummary(summary)`. If `cleaned === summary`, skip the row.
2. Set `summary = cleaned` and `summary_hash = summaryHashOf(cleaned)`. If `cleaned` is null, set both to NULL, and on `books` also set `summary_source` to NULL.
3. **Carry the judgment.** If the old hash has a `synopsis_judgments` row and the new hash has none, insert a copy under the new hash with the same `model`, `usable`, `kind` and `asked_at`. If the new hash already has one, keep it, except that a `manual` judgment on the old hash replaces a non-manual one on the new hash. When several old hashes clean to the same new hash, choose in this order: a manual judgment, then a rule judgment, then the most recent `asked_at`. Two exceptions, applied in this order:
   - **Fragment after cleaning.** If the cleaned text is a fragment (`isFragment`) and the chosen judgment is not `manual`, write a `rule` judgment instead, exactly as `applySynopsisRule` would. A `manual` keep still wins.
   - **Hidden by Jev, text changed.** If the chosen judgment is a Jev hide (model neither `manual` nor `rule`, `usable < SYNOPSIS_HIDE_BELOW`), don't carry it. The new hash is left without a judgment, and the boot sweep re-asks Jev about the cleaned text. **Owner's decision (2026-10-18):** Jev may have hidden the text because of the chrome the cleaning removed. The 2026-10-16 backlog asked about 19,400 texts for about $4, so a couple of thousand re-asks costs well under $1. The report counts these as `jevHidesDropped`.
4. Don't delete old judgment rows. They are keyed by text, cost nothing, and another row may still carry the old text until it is cleaned.

**My call:** `jev_rejections` rows are not carried. The cleaned text may now pass. The few hashes affected go to Jev on the next sweep.

A whitespace-only change keeps the same hash, because `summaryHashOf` already collapses whitespace. Those rows just update their text.

**Report:** for books and works separately:
- rows scanned, changed, and emptied;
- changed rows per `summary_source`, and per publisher host for publisher rows;
- judgments carried, conflicts resolved, rule hides written, Jev hides dropped, and other changed rows whose new hash has no judgment (expected near 0);
- for the dry run, 3 before/after samples per publisher host and per non-publisher source, truncated.

**Running it:** the owner runs it after the deploy that ships the cleaner, as one entry in the post-deploy runbook:
1. A read-only check of the volume's free space.
2. `--dry-run` over `railway ssh`.
3. A review of its samples.
4. The real run. Save its output, because it is the only copy of the original texts.

Hold merges to main while it runs, because a deploy kills the job. The commands go in `backend/README.md` next to "Mojibake repair".

## Tests

- `cleanSummary`: one case per production pattern above, using short synthetic texts shaped like the real ones. Include:
  - each shop's tail, and a Presença "Detalhes" block;
  - an Open Library text with `\r\n`, a rule and an "Also contained in:" list;
  - escaped HTML, C1 punctuation, a glued sentence, a hyphenated wrap, a wrapped prose paragraph and a verse excerpt;
  - a text with "Formato" or "Série" used inside a sentence, which must survive.
- Idempotence over every fixture. Already-clean text comes back unchanged.
- `htmlToText`: `<br>` versus `<p>`, escaped tags, numeric and named entities.
- Each adapter's existing tests still pass. The publisher feed fixtures in `seed/fixtures/` produce the same or cleaner summaries.
- Backfill module: changed, unchanged and emptied rows. Judgment carry. Two old hashes collapsing to one new hash with a manual judgment on one of them. A text that cleans to a fragment under a Jev keep gets a rule hide, and under a manual keep stays kept. A Jev hide on changed text is dropped, and a manual hide on changed text is carried. Dry run writes nothing. A second run is a no-op.
- `npm test` in backend names its test files explicitly. Add the new ones.

## Left to the builder

- The exact regexes and length thresholds, and the hard-wrap detector. Keep them conservative per the anti-goals.
- Whether `plainDescription` stays as a wrapper or its call sites switch to `cleanSummary`.
- Batch size for the backfill transaction.
