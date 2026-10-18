# National Bibliography Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import Portugal's national bibliography (BNP legal deposit, 2002 onward, trade books only) into the books catalog with its cover scans, follow its daily updates inside the server, and ask the BNP first for Portugal ISBN lookups.

**Architecture:**
- **Tasks 1–2:** pure functions read UNIMARC (marcxchange) XML into a `BnpBook`, decide whether it is in scope, and map its UDC codes to genres.
- **Task 3:** gives the repository the few writes the import needs, a cursor table, and the details-queue exclusion.
- **Task 4:** applies one `BnpBook` to the catalog: match or create, fill empty fields, cover rule.
- **Task 5:** harvests OAI windows and reports.
- **Tasks 6–8:** are the three entry points (script, in-server sync, ISBN lookup).
- **Task 9:** checks the scale before the production run.

**Tech Stack:** TypeScript, Fastify, `node:sqlite`, `node:test` via `tsx`, sharp (already used through `encodeCover`).

**Spec:** `docs/superpowers/specs/2026-10-18-national-bibliography-import-design.md`

## Global Constraints

- No new dependencies, and no XML library: the reader is regex over the flat datafield/subfield structure. No comments in code.
- A new `*.test.ts` file must be added to `backend/package.json`'s `test` script.
- Never overwrite a non-empty field. Identity is filled only through `fillMissingIdentity` (`domain/findOrCreate.ts:27`). Details go only through `mergeDetails` (COALESCE plus its summary CASE), `fillOriginalTitle` and `setLanguage`, each of which writes only when the field is empty.
- Never touch a cover whose status is `manual`, or a `good` cover whose image source is not `isbndb`.
- No background job may call an outside source for a book with `created_by = 'bnp'`.
- Catch only `SourceUnavailableError` where a fall-through is intended. Everything else propagates.
- Endpoints, copied exactly:
  - OAI: `https://oai.bnportugal.gov.pt/servlet/OAIHandler`, set `bibliografianacional`, `metadataPrefix=marcxchange`.
  - Per ISBN: `https://urn.porbase.org/isbn/unimarc/marcxchange?id=<isbn>`.
- Pace:
  - OAI pages go one at a time, with no gap needed: each takes about 8 s.
  - Scan downloads have **at most 2 in flight**.
  - All requests go through `seed/siteFetch.ts` (`fetchText`, `fetchBytes`: 30 s timeout, `Atmyshelf/1.0` user agent).
- Dates are UTC `YYYY-MM-DD` strings from `toISOString().slice(0, 10)`. Never use local-time getters.
- Backend verify: `npm run build --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend && git diff --check`.
- One test file: `cd backend && npx tsx --test --test-name-pattern="<name>" <file>`.
- **Fixtures:** recorded once from the live endpoints with the commands in Task 1 and committed. Tests never touch the network.

## Review Focus

1. **A quiet day.**
   - OAI answers an empty window with an empty `<ListRecords>` (seen 2026-10-18), and the standard alternative is `<error code="noRecordsMatch">`.
   - Both must read as zero records. Otherwise the sync never advances.
   - Pinned in Task 1 (reader) and Task 7 (sync advances on an empty window).
2. **A window that dies halfway.**
   - Causes: an expired `resumptionToken` (`badResumptionToken`), a 5xx or a timeout.
   - The window is retried once from its start. If it fails again it is listed in `failedWindows`.
   - `through` and the cursor never move past it.
   - Pinned in Task 5 and Task 7.
3. **The same ISBN twice.** Duplicate records, a sync re-reading the cursor day, and a rerun of a window must not create a second book or upload a second scan. Pinned in Task 4.
4. **The UTC day boundary.** Run the date tests with `process.env.TZ = "America/Sao_Paulo"` set after imports, so that local-date bugs fail. "Today" at 01:00Z must be the UTC date. Pinned in Task 5.
5. **A cover changed between plan and write.**
   - Someone uploads a cover while a scan downloads.
   - `setCoverIf` must keep the upload. The uploaded R2 objects become orphans, which is acceptable.
   - Pinned in Task 4.

---

### Task 1: UNIMARC reader and record mapping

**Files:**
- Create: `backend/src/modules/books/seed/bnpRecord.ts`
- Create: `backend/src/modules/books/seed/fixtures/bnp/oai-page.xml`
- Create: `backend/src/modules/books/seed/fixtures/bnp/oai-empty.xml`
- Create: `backend/src/modules/books/seed/fixtures/bnp/urn-9789720044457.xml`
- Create: `backend/src/modules/books/seed/fixtures/bnp/urn-missing.xml`
- Modify: `backend/src/modules/books/domain/normalize.ts`
- Modify: `backend/src/modules/books/seed/publisherFeed.ts`
- Test: `backend/src/modules/books/seed/bnpRecord.test.ts`
- Test: `backend/src/modules/books/domain/normalize.test.ts`
- Modify: `backend/package.json`

**Interfaces:**
- Produces, from `domain/normalize.ts`:
  - `export function isValidIsbn(raw: string): boolean`. It takes digits and an optional `X`, with hyphens and spaces stripped. True for an ISBN-13 with a correct mod-10 check digit (weights 1/3), or an ISBN-10 with a correct mod-11 check digit (`X` = 10).
  - `checksumOk` and `isbn10Ok` move here from `seed/publisherFeed.ts:59-68` and are exported. `publisherFeed.ts` imports them, unchanged in behaviour.
- Produces, from `seed/bnpRecord.ts`:
```ts
export interface MarcField { tag: string; subfields: Array<[string, string]> }
export interface MarcRecord { id: string | null; datestamp: string | null; deleted: boolean; controls: Record<string, string>; fields: MarcField[] }
export interface BnpBook {
  recordId: string | null;
  isbns: string[];
  title: string;
  author: string;
  translator: string | null;
  originalTitle: string | null;
  publisher: string | null;
  year: number | null;
  pages: number | null;
  languages: string[];
  udc: string[];
  summary: string | null;
  scanUrl: string | null;
}
export function readMarcRecords(xml: string): MarcRecord[];
export function readResumptionToken(xml: string): string | null;
export function readOaiError(xml: string): string | null;
export function mapBnpRecord(record: MarcRecord): BnpBook;
```
- `readMarcRecords`:
  - It accepts both document shapes, the OAI `<record><header>…<metadata><mx:record>` with the `mx:` prefix and the per-ISBN `<collection><record>` with no prefix.
  - `id` is the OAI header identifier, and `datestamp` the header datestamp. Both are null for the per-ISBN shape.
  - `deleted` is true when the header has `status="deleted"`.
  - It decodes `&amp; &lt; &gt; &quot; &apos;` and numeric entities (`&#x98;`, `&#152;`).
  - Every string it returns (ids, datestamps, control and subfield values) is copied with `structuredClone`, as `publisherFeed.ts` does since #295. On Node 24 a regex substring otherwise keeps its whole ~1.3 MB page alive.
  - It returns `[]` for an empty `<ListRecords>`, a `noRecordsMatch` error, and the per-ISBN `<urn-response><error>`.
- `readOaiError` returns the `code` attribute of an OAI `<error>`. It returns `null` when there is no error, and also for `noRecordsMatch`.
- `mapBnpRecord`. Every text value goes through `cleanCatalogText` (`@scripta/shared`), then trim and whitespace collapse.
  - `isbns`: every `010 $a` that passes `isValidIsbn`, mapped through `canonicalIsbn`, deduped, in record order.
  - `title`: the `200 $a` values joined with `" ; "`, then `$h` and `$i` when present, all joined with `". "`. A leading literal non-sorting pair is stripped with `title.replace(/^\?(\S+) \?/, "$1 ")`; the per-ISBN endpoint encodes markers as `?`.
  - `author`: every `700`, then every `701`, whatever their `$4`.
    - Each name is `[$b, $a, $d].filter(Boolean).join(" ")`, with `$f` dates dropped. Names are joined with `", "`.
    - If there are none: the `702` fields with `$4` `070`. If still none: the `702` fields with `$4` `340`. Otherwise `""`.
  - `translator`: the `702` fields with `$4` `730`, formatted the same way. One name as is; several as `"A, B e C"`. `null` when there are none.
  - `originalTitle`: the text after `/^T[íi]t\. orig\.:\s*/` in a `304 $a`, else `null`.
  - `publisher`: the first `210 $c`, with brackets removed and a `distrib.` marker removed. `null` when it matches `/^\[?s\.\s*n\.\]?$/i` or is empty.
  - `year`: `controls`/`100 $a` characters 9–12 when they are four digits, else the first `/(?:1[5-9]|20)\d{2}/` in `210 $d`, else `null`.
  - `pages`: from `215 $a`, but only if it contains `p.`. Bracketed segments are removed and the largest remaining arabic number is taken. `"169, [7] p."` gives 169, `"XII, 300 p."` gives 300, `"2 v."` gives `null`.
  - `languages`: every `101 $a`.
  - `udc`: every `675 $a`.
  - `summary`: the first `330 $a`, or `null`.
  - `scanUrl`: the first `856 $u` containing `winlibimg.aspx`, with `^http:` replaced by `https:`. Otherwise `null`.
  - `recordId`: controlfield `001`.

- [ ] **Step 1: Record the fixtures**

Run from the worktree root. Keep the four files verbatim, except `oai-page.xml`, which you trim as described below.

```bash
F=backend/src/modules/books/seed/fixtures/bnp; mkdir -p $F
O="https://oai.bnportugal.gov.pt/servlet/OAIHandler"
curl -s "$O?verb=ListRecords&metadataPrefix=marcxchange&set=bibliografianacional&from=2026-10-16&until=2026-10-17" > $F/oai-page.xml
curl -s "$O?verb=ListRecords&metadataPrefix=marcxchange&set=bibliografianacional&from=2030-01-01&until=2030-01-02" > $F/oai-empty.xml
curl -s "https://urn.porbase.org/isbn/unimarc/marcxchange?id=9789720044457" > $F/urn-9789720044457.xml
curl -s "https://urn.porbase.org/isbn/unimarc/marcxchange?id=9780000000002" > $F/urn-missing.xml
```

Trim `oai-page.xml`:
- Keep the envelope and the records with identifiers `bibliografianacional/1704776` (Arendt, translator, `304`, no scan) and `bibliografianacional/2047928` (municipal, scan). Keep one more record with an ISBN-10 if the window has one.
- Delete the rest.
- Add `<resumptionToken cursor="0" completeListSize="9">TOKEN-1</resumptionToken>` before `</ListRecords>`.
- If either named record is missing from that window, fetch it with `?verb=GetRecord&metadataPrefix=marcxchange&identifier=oai:oai.bn.pt:bibliografianacional/<id>` and splice its `<record>` in.

- [ ] **Step 2: Write the failing tests**

`normalize.test.ts`:
```ts
test("isValidIsbn checks the check digit of both lengths", () => {
  assert.equal(isValidIsbn("978-972-0-04445-7"), true);
  assert.equal(isValidIsbn("9789720044458"), false);
  assert.equal(isValidIsbn("972-708-948-8"), true);
  assert.equal(isValidIsbn("972-708-948-2"), false);
  assert.equal(isValidIsbn("097522980X"), true);
  assert.equal(isValidIsbn("12345"), false);
});
```

`bnpRecord.test.ts` uses the same env preamble as `seedCatalog.test.ts`. It reads the fixtures with `readFileSync(new URL("./fixtures/bnp/<name>", import.meta.url), "utf8")`.
```ts
test("an OAI page gives its records, header and resumption token", () => {
  const records = readMarcRecords(oaiPage);
  assert.ok(records.length >= 2);
  const arendt = records.find((r) => r.id === "oai:oai.bn.pt:bibliografianacional/1704776")!;
  assert.match(arendt.datestamp!, /^\d{4}-\d{2}-\d{2}/);
  assert.equal(arendt.deleted, false);
  assert.equal(readResumptionToken(oaiPage), "TOKEN-1");
});

test("an empty window, a noRecordsMatch error and a per-ISBN miss read as no records", () => {
  assert.deepEqual(readMarcRecords(oaiEmpty), []);
  assert.equal(readResumptionToken(oaiEmpty), null);
  const noMatch = `<OAI-PMH><error code="noRecordsMatch">none</error></OAI-PMH>`;
  assert.deepEqual(readMarcRecords(noMatch), []);
  assert.equal(readOaiError(noMatch), null);
  assert.equal(readOaiError(`<OAI-PMH><error code="badResumptionToken">x</error></OAI-PMH>`), "badResumptionToken");
  assert.deepEqual(readMarcRecords(urnMissing), []);
});

test("the Arendt record maps names given-first, its translator and original title", () => {
  const book = mapBnpRecord(byId("1704776"));
  assert.deepEqual(book.isbns, ["9789727089482"]);
  assert.equal(book.title, "A promessa da política");
  assert.equal(book.author, "Hannah Arendt");
  assert.equal(book.translator, "Miguel Serras Pereira");
  assert.equal(book.originalTitle, "The promise of politics");
  assert.equal(book.publisher, "Relógio d'Água");
  assert.equal(book.year, 2007);
  assert.equal(book.pages, 169);
  assert.deepEqual(book.languages, ["por"]);
  assert.ok(book.udc.includes("321.01"));
  assert.equal(book.scanUrl, null);
});

test("the municipal record keeps its scan as https", () => {
  const book = mapBnpRecord(byId("2047928"));
  assert.equal(book.publisher, "Câmara Municipal de Viana do Castelo");
  assert.equal(book.author, "Bruna Ruschel Pires");
  assert.equal(book.scanUrl, "https://rnod.bnportugal.gov.pt/ImagesBN/winlibimg.aspx?skey=&doc=2047928&img=139512&save=true");
});

test("the per-ISBN record strips its literal ? markers", () => {
  const [record] = readMarcRecords(urnAllende);
  const book = mapBnpRecord(record!);
  assert.equal(book.title, "A casa dos espíritos");
  assert.equal(book.author, "Isabel Allende");
  assert.equal(book.translator, "Cristina Paixão");
  assert.equal(book.originalTitle, "La casa de los espíritus");
  assert.equal(book.publisher, "Porto Editora");
  assert.equal(book.pages, 407);
  assert.equal(record!.id, null);
});
```

Also add one handwritten-record test per fallback, built as `MarcRecord` literals:
- the `702 $4 070` and `702 $4 340` author fallbacks, and `""` with neither;
- `$d` kept ("Bento XVI");
- two translators giving `"A e B"`;
- `[s.n.]` giving `publisher` null;
- `200 $h "2"` giving `"Os Maias. 2"`;
- an invalid `010` dropped and a valid ISBN-10 canonicalised;
- `"2 v."` giving `pages` null;
- a year read from `210 $d "D.L. 2015"` when `100` is absent.

- [ ] **Step 3: Run them and confirm they fail**

Run: `cd backend && npx tsx --test src/modules/books/seed/bnpRecord.test.ts src/modules/books/domain/normalize.test.ts`
Expected: an import error (the module doesn't exist and `isValidIsbn` isn't exported).

- [ ] **Step 4: Implement `bnpRecord.ts`, `isValidIsbn`, and the checksum move. Add the two test files to `backend/package.json` if they aren't listed.**

- [ ] **Step 5: Run the tests, then the backend verify**

Expected: PASS. `publisherFeed.test.ts` still passes.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/books/seed/bnpRecord.ts backend/src/modules/books/seed/bnpRecord.test.ts backend/src/modules/books/seed/fixtures/bnp backend/src/modules/books/domain/normalize.ts backend/src/modules/books/domain/normalize.test.ts backend/src/modules/books/seed/publisherFeed.ts backend/package.json
git commit -m "Read national bibliography UNIMARC records"
```

---

### Task 2: Scope filter and UDC genres

**Files:**
- Create: `backend/src/modules/books/seed/bnpScope.ts`
- Test: `backend/src/modules/books/seed/bnpScope.test.ts`
- Modify: `backend/package.json`

**Interfaces:**
- Consumes: `BnpBook` (Task 1).
- Produces:
```ts
export type BnpSkip = "noIsbn" | "textbook" | "noPublisher" | "institutional" | "noPerson";
export const BNP_SKIPS: readonly BnpSkip[];
export function bnpSkipReason(book: BnpBook): BnpSkip | null;
export function udcGenres(codes: string[]): BookGenre[];
```
- `bnpSkipReason` checks the rules in the `BnpSkip` order and returns the first failing rule:
  - `noIsbn`: `isbns` is empty.
  - `textbook`: any `udc` code contains `(075`.
  - `noPublisher`: `publisher === null`.
  - `institutional`: `normalizeGenreLabel(publisher)` (`@scripta/shared`; it strips accents, lowercases and turns non-alphanumerics into spaces) matches `INSTITUTIONAL` below.
  - `noPerson`: `author === ""`.
- The deny-list, copied exactly. It was tuned on 3,519 sampled ISBN records: it drops 302, and no trade publisher was among them.
```ts
const INSTITUTIONAL = /\b(?:camara municipal|camara municpal|municipio|empresa municipal|junta de freguesia|uniao das? (?:juntas de )?freguesias|comunidade intermunicipal|universidade|faculdade|politecnico|escola superior|agrupamento de escolas|ministerio|direc?cao geral|direc?cao regional|direc?cao de servicos|secretaria regional|governo|regiao autonoma|assembleia da republica|associacao|centro de estudos|centro de investigacao|museu|diocese|paroquia|banda musical|filarmonica|grupo coral|santa casa|conferencia episcopal|instituto (?:politecnico|nacional|superior|portugues|de )|comissao)\b/;
```
- `udcGenres` collects genres from every code and returns them in `BOOK_GENRES` order, deduped.
  - The main number is the leading `[\d.]+`. The literary form is the first `-[1-9][\d.]*` in the code. The form-of-presentation auxiliary is `(0.053.N`.
  - Literature (main starts with `82`), by literary form:
    - `-93` → Children's
    - `-1` → Poetry, exact or followed by `.` (so not `-13`)
    - `-312.4` → Crime
    - `-312.9` → Science Fiction
    - `-311.6` → Historical Fiction
    - `-94` → Biography & Memoir
    - `-992` → Travel
    - anything else → nothing
  - Any code with `(0.053.2` through `(0.053.5` → Children's. `(0.053.6` → Young Adult. A `-053.N` person auxiliary, as in `159.942-053.2` (child psychology), gives no age genre.
  - Other main numbers, by prefix, longest first:
    - `741.5` → Comics & Graphic Novels
    - `641.5` → Cooking
    - `004` → Technology
    - `159.9` → Psychology
    - `929` → Biography & Memoir
    - `91` → Travel
    - `93`, `94` → History
    - `32` → Politics
    - `33`, `65` → Business
    - `62` → Technology
    - `1` → Philosophy
    - `2` → Religion
    - `5` → Science
    - anything else → nothing
- **Before relying on the table,** check every code above against the UDC Summary (udcsummary.info) and the fixture records. Delete any mapping that doesn't hold, and say which in the task report. A wrong genre is worse than none.

- [ ] **Step 1: Write the failing tests**

```ts
const book = (over: Partial<BnpBook>): BnpBook => ({ recordId: "1", isbns: ["9789720044457"], title: "T", author: "A B", translator: null, originalTitle: null, publisher: "Porto Editora", year: 2020, pages: 100, languages: ["por"], udc: [], summary: null, scanUrl: null, ...over });

test("each rule skips its record, in order", () => {
  assert.equal(bnpSkipReason(book({ isbns: [] })), "noIsbn");
  assert.equal(bnpSkipReason(book({ udc: ["51(075.2)"] })), "textbook");
  assert.equal(bnpSkipReason(book({ publisher: null })), "noPublisher");
  assert.equal(bnpSkipReason(book({ publisher: "Câmara Municipal de Tavira" })), "institutional");
  assert.equal(bnpSkipReason(book({ author: "" })), "noPerson");
  assert.equal(bnpSkipReason(book({})), null);
});

test("trade publishers a naive pattern would catch are kept", () => {
  for (const publisher of ["Clube do Autor", "Fundação Francisco Manuel dos Santos", "Fundação Calouste Gulbenkian", "Instituto Piaget", "Assírio & Alvim", "Edições Afrontamento"]) assert.equal(bnpSkipReason(book({ publisher })), null, publisher);
});

test("institutional publishers are dropped", () => {
  for (const publisher of ["Imprensa da Universidade de Coimbra", "Município de Oeiras", "União das Freguesias de Carcavelos e Parede", "Direcção-Geral de Inovação e Desenvolvimento Curricular", "Banda Musical das Caldas das Taipas", "Instituto Politécnico de Leiria"]) assert.equal(bnpSkipReason(book({ publisher })), "institutional", publisher);
});

test("udc codes map to genres and a plain novel gets none", () => {
  assert.deepEqual(udcGenres(['821.134.2(83)-31"19/20"']), []);
  assert.deepEqual(udcGenres(['821.134.3-1"20"']), ["Poetry"]);
  assert.deepEqual(udcGenres(['821.134.3-93"20"']), ["Children's"]);
  assert.deepEqual(udcGenres(['821.111-312.4"20"']), ["Crime"]);
  assert.deepEqual(udcGenres(["321.01", "1A/Z(091)"]), ["Politics", "Philosophy"]);
  assert.deepEqual(udcGenres(["159.942-053.2"]), ["Psychology"]);
  assert.deepEqual(udcGenres(["793.7(0.053.4/.5)"]), ["Children's"]);
  assert.deepEqual(udcGenres(["641.5"]), ["Cooking"]);
});
```
Adjust these expected arrays only if the UDC verification deletes a mapping, and record why in the report.

- [ ] **Step 2: Run them and confirm they fail.** `cd backend && npx tsx --test src/modules/books/seed/bnpScope.test.ts` fails with an import error.
- [ ] **Step 3: Implement `bnpScope.ts` and add the test file to `backend/package.json`.**
- [ ] **Step 4: Run the tests, then the backend verify.** Expected: PASS.
- [ ] **Step 5: Commit** `git add backend/src/modules/books/seed/bnpScope.ts backend/src/modules/books/seed/bnpScope.test.ts backend/package.json && git commit -m "Scope national bibliography records and map UDC to genres"`

---

### Task 3: Repository support

**Files:**
- Modify: `backend/src/modules/books/domain/types.ts`
- Modify: `backend/src/modules/books/domain/ports.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/books.sql`
- Modify: `backend/src/modules/books/adapters/sqlite/connection.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Modify: `packages/shared/src/library/bookMetadata.ts`
- Modify: `frontend/src/lib/bookMetadata.ts`
- Modify: `backend/src/modules/books/booksService.ts`
- Test: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`
- Test: `backend/src/modules/books/booksService.test.ts`

**Interfaces:**
- Produces, in `packages/shared/src/library/bookMetadata.ts:23`: `summarySource` gains `"bnp"`. In `frontend/src/lib/bookMetadata.ts:32`, `summarySourceName` returns `"Biblioteca Nacional de Portugal"` for it. This is a one-line label; typecheck covers the union, and no test is added.
- Produces, in `types.ts`: `"bnp"` added to `DataSource` (so `SummarySource` gains it), to `CoverSourceName` and to `BookCreator`.
  - No exhaustive switch or `Record` over these unions exists today (checked 2026-10-18). Typecheck confirms it.
  - `summaryLink` (`booksService.ts:121`) returns `""` for `summary_source === "bnp"`. A matched book may carry another source's `source_url`, which must not be shown as the BNP's link.
- Produces, on `BooksRepository` (`ports.ts`) and implemented in `sqliteBooksRepository.ts`:
```ts
fillSubjectGenres(bookId: string, genres: string[]): void;
confirmWithSource(bookId: string, source: DataSource): void;
getHarvestCursor(feed: string): string | null;
setHarvestCursor(feed: string, through: string): void;
```
  - `fillSubjectGenres`: with an empty `genres`, it does nothing. Otherwise `UPDATE books SET genres = ?, genres_source = NULL, genres_confidence = NULL WHERE id = ? AND (genres = '[]' OR genres_source = 'jev')`.
  - `confirmWithSource`: when the book is not confirmed (`CONFIRMED_SQL`), it appends `source` to `data_sources` (`json_insert(data_sources, '$[#]', ?)`), then calls `makeSearchableIfConfirmed`. A confirmed book is unchanged.
  - Cursor table, in `books.sql`: `CREATE TABLE IF NOT EXISTS harvest_cursors (feed TEXT PRIMARY KEY, through TEXT NOT NULL);`. `setHarvestCursor` upserts.
  - `UNCHECKED_DETAILS_SQL` (`sqliteBooksRepository.ts:23`) becomes `... WHERE details_status IS NULL AND created_by IS NOT 'bnp' ORDER BY ...`, with the order unchanged.
  - In `connection.ts:58`, `idx_books_details_unchecked` is dropped (`DROP INDEX IF EXISTS`) and replaced by `idx_books_details_pending`: the same columns, `WHERE details_status IS NULL AND created_by IS NOT 'bnp'`.

- [ ] **Step 1: Write the failing tests** (in `sqliteBooksRepository.test.ts`, using `freshRepo()`)

```ts
test("fillSubjectGenres fills empty or Jev genres and keeps source genres", () => { /* three books: '[]' → filled; jev → replaced, genres_source NULL; ['Fantasy'] source NULL → unchanged; [] input → no change */ });
test("confirmWithSource makes an unconfirmed book searchable once", () => {
  /* createBook with no createdBy and no sources → isSearchable false; confirmWithSource(id, "bnp") → isSearchable true and data_sources '["bnp"]'; a second call leaves data_sources '["bnp"]' */
});
test("the harvest cursor starts empty and keeps the last value", () => {
  assert.equal(repo.getHarvestCursor("bnp"), null);
  repo.setHarvestCursor("bnp", "2026-10-17"); repo.setHarvestCursor("bnp", "2026-10-18");
  assert.equal(repo.getHarvestCursor("bnp"), "2026-10-18");
});
test("the details queue skips bnp books", () => {
  /* createBook createdBy "bnp" and one with no creator; listUncheckedDetailIds(10) returns only the second */
});
```
Write the bodies the comments describe.

Then make two more changes:
- Update the existing query-plan test at `sqliteBooksRepository.test.ts:~1291`, which asserts `idx_books_details_unchecked`, to assert `idx_books_details_pending`. Don't add a second query-plan test.
- In `booksService.test.ts`, add `test("a bnp summary has no source link", …)`: a book with `summary_source` `bnp` and a non-empty `source_url` gives details with `sourceUrl` `""`.

- [ ] **Step 2: Run them and confirm they fail.** `cd backend && npx tsx --test src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts src/modules/books/booksService.test.ts` fails with missing methods.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the test file, then the backend verify, then `npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend`.** Expected: PASS.
- [ ] **Step 5: Commit** `git add backend/src/modules/books/domain/types.ts backend/src/modules/books/domain/ports.ts backend/src/modules/books/adapters/sqlite/books.sql backend/src/modules/books/adapters/sqlite/connection.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts backend/src/modules/books/booksService.ts backend/src/modules/books/booksService.test.ts packages/shared/src/library/bookMetadata.ts frontend/src/lib/bookMetadata.ts && git commit -m "Repository support for the national bibliography import"`

---

### Task 4: Apply one record to the catalog

**Files:**
- Create: `backend/src/modules/books/seed/bnpImport.ts`
- Test: `backend/src/modules/books/seed/bnpImport.test.ts`
- Modify: `backend/package.json`

**Interfaces:**
- Consumes: Tasks 1–3, `storeCoverImage` (`booksService.ts:71`), `encodeCover` and `isAcceptableCover` (`domain/images.ts`), `fillMissingIdentity` (`domain/findOrCreate.ts:27`), `lookupIdentity` and `editionLanguage` (`domain/normalize.ts`), `isPortugueseIsbn`, `MIN_GOOD_WIDTH`, and `fetchBytes` (`seed/siteFetch.ts`).
- Produces:
```ts
export interface BnpDeps { repo: BooksRepository; blobs: CoverBlobStore; fetchScan: (url: string) => Promise<EncodedCover | null>; now: () => Date }
export type BnpReplace = "new" | "none" | "lowRes" | "isbndb";
export type BnpCoverAction = "stored" | "kept" | "noScan" | "rejected" | "failed";
export interface BnpPlan { book: BnpBook; isbn: string; existing: BookRow | undefined; replace: BnpReplace | null }
export function bnpReplaceReason(existing: BookRow | undefined, image: CoverImageRow | undefined): BnpReplace | null;
export function planBnpRecord(repo: Pick<BooksRepository, "findBookByKey" | "getImage">, book: BnpBook, isbn?: string): BnpPlan | null;
export async function applyBnpRecord(deps: BnpDeps, plan: BnpPlan): Promise<{ book: BookRow; created: boolean; cover: BnpCoverAction }>;
export async function fetchBnpScan(url: string): Promise<EncodedCover | null>;
```
- `bnpReplaceReason` returns the first that applies:
  - no book → `"new"`;
  - status `manual` → `null`;
  - no `cover_image_id` → `"none"`;
  - status `low_res` → `"lowRes"`;
  - image source `isbndb` and `isPortugueseIsbn(existing.isbn)` → `"isbndb"`;
  - otherwise `null`.
- `planBnpRecord`:
  - `isbn` is the given one (the lookup path) or `book.isbns[0]`. With neither it returns `null`.
  - `existing` is `findBookByKey("isbn:" + isbn)`. The record's other ISBNs are not used (spec decision 6).
  - `replace` is `bnpReplaceReason(existing, existing image)`.
- `applyBnpRecord`, in this order:
  1. If `replace !== null` and `book.scanUrl`, await `fetchScan`.
     - A `SourceUnavailableError` → cover `"failed"`.
     - `null` → `"failed"`.
     - `!isAcceptableCover("bnp", w, h)` → `"rejected"`.
     - Otherwise there is a scan.
  2. In one `repo.transaction`:
     - Re-read `findBookByKey("isbn:" + isbn)`, so a book created meanwhile is reused. Then create or reuse:
       - New: `createBook({ title, author, isbn, year, publisher, genres: udcGenres(book.udc), createdBy: "bnp" }, keys, at)`. The keys are `isbn:<isbn>`, plus `identity.titleKey` only when no book holds it (as `seedBook` does). Then `setCover(id, { imageId: null, status: null, checkedAt: at })`.
       - Existing: `fillMissingIdentity(repo, existing, title, author)`, `fillSubjectGenres(id, udcGenres(book.udc))`, `confirmWithSource(id, "bnp")`.
     - Both: `mergeDetails(id, { summary, pages, year, publisher, translator }, "bnp")`, `fillOriginalTitle(id, originalTitle)` when it is set, and `setLanguage(id, editionLanguage(book.languages, isbn))`.
     - Still inside the transaction, recompute `bnpReplaceReason` on the current row and its image. The current image may have changed during the download, for example a manual upload or a good Apple cover.
       - If the reason is now `null`, drop the scan: the cover is `"kept"`.
       - Otherwise remember the current row's `cover_image_id` as the expected id for step 3.
  3. If there is a scan:
     - `imageId = await storeCoverImage(deps, id, "bnp", scanUrl, scan, at)`.
     - Then `setCoverIf(id, <expected id from step 2>, { imageId, status: width >= MIN_GOOD_WIDTH ? "good" : "low_res", checkedAt: at })`.
     - The cover is `"stored"` if that returned true, otherwise `"kept"`.
     - With no scan to fetch: `"noScan"` when `book.scanUrl` is null, otherwise `"kept"`.
  - Identity uses `lookupIdentity({ isbn, title: book.title, author: book.author })`.
  - The returned `book` is `repo.getBook(id)` read **after** `setCoverIf`, so a lookup's first answer carries its new cover.
- `fetchBnpScan`: `fetchBytes(url)` from `siteFetch.ts`, then `encodeCover`, or `null` on a `null` body.

- [ ] **Step 1: Write the failing tests.** Use the same env preamble as `seedCatalog.test.ts`, an in-memory repo (`applyBooksMigrations` on `new DatabaseSync(":memory:")`), a `Map` blob store, and a `fetchScan` fake returning `{ full, thumb, width: 400, height: 600, color: "" }` or a given value.
```ts
test("a new record becomes a searchable bnp book with a good scan that no queue selects", async () => {
  /* apply the Allende BnpBook; assert created, cover "stored", book.created_by "bnp", cover_status "good", cover_checked_at set,
     image source "bnp", pages 407, translator "Cristina Paixão", original_title "La casa de los espíritus", language "pt-PT",
     repo.isSearchable(id), repo.listUncheckedCoverIds(null, 100).ids excludes id, repo.listUncheckedDetailIds(100) excludes id */
});
test("a new record without a scan is stamped so only a display schedules it", async () => { /* cover "noScan", status null, cover_checked_at set, not in listUncheckedCoverIds */ });
test("an existing book gets empty fields filled and nothing overwritten", async () => { /* existing title/author/publisher kept; empty pages/translator filled; existing summary kept */ });
test("the scan replaces none, low-res and Portugal ISBNdb covers and nothing else", async () => {
  /* table over (status, image source) → expected: none→stored, low_res→stored, good isbndb on 978972→stored, manual→kept, good apple→kept, good openlibrary→kept */
});
test("an existing book with no scan in its record keeps its cover state", async () => { /* status null, cover_checked_at null before and after */ });
test("a record with several ISBNs creates and keys only its first", async () => { /* record isbns [A, B]; a book already holds isbn:B; apply → a new book keyed isbn:A only; the isbn:B book untouched; findBookByKey("isbn:" + B) is still the old book */ });
test("an ISBN-less book with the same title is not adopted", async () => { /* seed a ta: book; apply; a new book is created */ });
test("applying the same record twice creates one book and uploads one scan", async () => { /* blobs size 2 after both; one book */ });
test("a cover uploaded during the scan download is kept", async () => {
  /* existing low_res book; fetchScan fake that, before resolving, sets the book's cover via setCover(<new image>, "manual"); result cover "kept"; book keeps the manual image; the same with a good apple image */
});
test("the returned book carries the stored cover", async () => { /* result.book.cover_image_id is the new image id, cover_status "good" */ });
test("a failed or rejected scan leaves a new book stamped and coverless", async () => { /* SourceUnavailableError → "failed"; 400x420 → "rejected"; both status null, checked_at set */ });
test("an unconfirmed existing book becomes searchable", async () => { /* createBook with no creator/sources; apply; isSearchable true */ });
test("subject genres fill an empty book but never a manual one", async () => { /* udc poetry; book genres [] → ["Poetry"]; genres_source "manual" → unchanged */ });
```
Write the bodies the comments describe. Use `mapBnpRecord` on the Task 1 fixture for the Allende book.

- [ ] **Step 2: Run them and confirm they fail.** `cd backend && npx tsx --test src/modules/books/seed/bnpImport.test.ts`
- [ ] **Step 3: Implement `bnpImport.ts` (this part only) and add the test file to `backend/package.json`.**
- [ ] **Step 4: Run the test file, then the backend verify.** Expected: PASS.
- [ ] **Step 5: Commit** `git add backend/src/modules/books/seed/bnpImport.ts backend/src/modules/books/seed/bnpImport.test.ts backend/package.json && git commit -m "Apply national bibliography records to the catalog"`

---

### Task 5: Harvest windows and report

**Files:**
- Modify: `backend/src/modules/books/seed/bnpImport.ts`
- Test: `backend/src/modules/books/seed/bnpImport.test.ts`

**Interfaces:**
- Consumes: Task 4, and `fetchText` (`seed/siteFetch.ts`: `(url) => Promise<{ status: number; text: string }>`).
- Produces:
```ts
export interface BnpHarvestDeps extends BnpDeps { fetchText: (url: string) => Promise<{ status: number; text: string }>; log: (line: string) => void }
export interface BnpImportOptions { from: string; until: string; dryRun: boolean; cursorOnSuccess: boolean }
export interface BnpImportReport {
  dryRun: boolean; from: string; until: string; through: string | null;
  records: number; deleted: number; kept: number; created: number; matched: number;
  skipped: Record<BnpSkip, number>;
  covers: Record<BnpCoverAction, number>;
  replace: Record<BnpReplace, number>;
  genres: Record<string, number>;
  publishers: { kept: Array<[string, number]>; dropped: Record<BnpSkip, Array<[string, number]>> };
  samples: BnpBook[];
  failedWindows: string[];
}
export const BNP_OAI = "https://oai.bnportugal.gov.pt/servlet/OAIHandler";
export function utcDate(at: Date): string;
export function monthWindows(from: string, until: string): Array<{ from: string; until: string }>;
export async function importBnp(deps: BnpHarvestDeps, options: BnpImportOptions): Promise<BnpImportReport>;
```
- `monthWindows` gives calendar-month windows clipped to `[from, until]`, inclusive, for example `2026-09-15..2026-10-03` → `[09-15..09-30, 10-01..10-03]`. If `from === until`, it gives one window.
- A window's first URL is `${BNP_OAI}?verb=ListRecords&metadataPrefix=marcxchange&set=bibliografianacional&from=${w.from}&until=${w.until}`. Following URLs are `${BNP_OAI}?verb=ListRecords&resumptionToken=${encodeURIComponent(token)}`. Pages are fetched one at a time, with no delay.
- A page fails when the fetch throws `SourceUnavailableError`, when `status !== 200`, or when `readOaiError` returns a code. A failure restarts the window once from its first URL. A second failure adds `"${from}..${until}"` to `failedWindows` and moves on to the next window.
- **A window is paged straight through first.** Each page's records are read, deleted ones counted and dropped, the rest mapped and their skip reason computed. Skipped publishers are tallied per reason, and the kept `BnpBook`s collected. Only after the last page is the window applied.
  - A `resumptionToken` lasts about a minute, and applying one page's ~200 scans takes longer than that.
- Per kept book, after paging:
  - **Dry run:** plan it and count the plan only. `created` or `matched` comes from `existing`, and an ISBN already seen earlier in the run counts as matched (a run-wide `Set`). `covers` gets `"stored"` when `replace !== null` and there is a `scanUrl`, `"noScan"` when there is no `scanUrl`, and `"kept"` otherwise. `replace` is tallied. Nothing is written or fetched.
  - **Real run:** plan each book right before applying it, then `applyBnpRecord`. At most 2 run at once (a small local pool), and never two with the same ISBN at once: a book whose ISBN is in flight waits for it.
  - Genres are tallied from `udcGenres`. `samples` keeps the first 20 kept books.
- Publisher tallies are cut to the top 50 per list.
- After each window, `deps.log(JSON.stringify({ window, through, records, kept, failed }))`. `through` is the `until` of the last window such that it and every earlier window succeeded.
- At the end, when `cursorOnSuccess && !dryRun && failedWindows.length === 0`, call `repo.setHarvestCursor("bnp", options.until)`.
  - The caller decides whether `until` means "today". The script passes `cursorOnSuccess: true` only when `--until` was not given. A day-long run started on day D then writes D, and the sync re-reads from D.

- [ ] **Step 1: Write the failing tests.** Use a scripted `fetchText` that maps URL to text, and set `process.env.TZ = "America/Sao_Paulo"` after imports.
```ts
test("monthWindows splits by calendar month inclusively", () => {
  assert.deepEqual(monthWindows("2026-09-15", "2026-10-03"), [{ from: "2026-09-15", until: "2026-09-30" }, { from: "2026-10-01", until: "2026-10-03" }]);
  assert.deepEqual(monthWindows("2026-10-18", "2026-10-18"), [{ from: "2026-10-18", until: "2026-10-18" }]);
});
test("utcDate is the UTC day even west of UTC", () => { assert.equal(utcDate(new Date("2026-10-18T01:00:00Z")), "2026-10-18"); });
test("a window follows its resumption token and applies every kept record", async () => { /* page 1 = oai-page fixture with TOKEN-1, page 2 = oai-empty; report.records, kept, skipped.institutional (2047928), created, covers */ });
test("a dry run writes and fetches nothing and still reports the plan", async () => { /* fetchScan throws if called; book count unchanged; publishers.dropped.institutional has the Câmara */ });
test("a window that fails twice is listed and through stops before it", async () => { /* second window's URL throws SourceUnavailableError twice; failedWindows ["2026-10-01..2026-10-03"]; through "2026-09-30"; no cursor written */ });
test("a page that fails once is retried from the window's start", async () => { /* badResumptionToken on page 2 the first time only; window succeeds; records counted once per apply (idempotent) */ });
test("a window's pages are all fetched before its first scan", async () => { /* log the order of fetchText and fetchScan calls; every fetchText of the window precedes the first fetchScan */ });
test("two records with the same ISBN in one window make one book and one upload", async () => { /* page with the Allende record twice; one book; blobs size 2 */ });
test("a finished run writes the cursor only when asked, never on a dry run or after a failed window", async () => { /* until "2026-10-18", cursorOnSuccess true → cursor "2026-10-18"; cursorOnSuccess false → null; dryRun → null; one failed window → null */ });
```
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the test file, then the backend verify.** Expected: PASS.
- [ ] **Step 5: Commit** `git add backend/src/modules/books/seed/bnpImport.ts backend/src/modules/books/seed/bnpImport.test.ts && git commit -m "Harvest national bibliography windows with a resumable report"`

---

### Task 6: Import script and docs

**Files:**
- Create: `backend/scripts/import-bnp.mjs`
- Modify: `backend/README.md`
- Modify: `docs/portuguese-book-sources.md`

**Interfaces:**
- Consumes: `importBnp`, `fetchBnpScan`, `utcDate` (Task 5) from `../dist/modules/books/seed/bnpImport.js`; `fetchText` from `../dist/modules/books/seed/siteFetch.js`.

- [ ] **Step 1: Write `import-bnp.mjs`**
  - Shape it like `scripts/repair-mojibake.mjs` (`parseArgs`, imports from `../dist`, a read-only `DatabaseSync` for a dry run, `openBooksDb()` otherwise) and `scripts/import-publisher-covers.mjs` (`sharp.cache(false); sharp.concurrency(1);`, blobs as `{ save: (id, extension, bytes) => store.put(\`covers/${id}.${extension}\`, bytes, "image/webp") }` from `createObjectStore()`).
  - Options: `--dry-run` (boolean), `--from` (default `"2000-01-01"`, the set's earliest datestamp), `--until` (default `utcDate(new Date())`).
  - Calls `importBnp({ repo, blobs, fetchScan: fetchBnpScan, fetchText, now: () => new Date(), log: console.log }, { from, until, dryRun, cursorOnSuccess: values.until === undefined })`.
  - Prints `JSON.stringify(report)` as the last line.
  - Its `log` appends the memory in use to each window line: ``(line) => console.log(line, `rss=${Math.round(process.memoryUsage().rss / 1e6)}MB`)``.
  - On a dry run, blobs is `{ save: () => { throw new Error("dry run") } }`.
- [ ] **Step 2: Smoke-test it locally on a scratch copy of the dev catalog**
  - `npm run build --workspace backend`. Copy the dev covers DB and set `COVERS_DB_PATH=<copy>`, using the dev env from `docs/dev-workflow.md`, with the object store pointed at the local dev store. Never use production.
  - First the real run, which opens the DB read-write and so creates `harvest_cursors`: `node scripts/import-bnp.mjs --from 2026-10-16 --until 2026-10-17`. Expected: one window line, `created` > 0, `covers.stored` > 0, `failedWindows: []`.
  - Then the dry run on the same copy: `node scripts/import-bnp.mjs --dry-run --from 2026-10-16 --until 2026-10-17`. Expected: `matched` equals the real run's `created + matched`, and `created` is 0.
  - Then memory on production's Node: `npx -y node@24.21.0 scripts/import-bnp.mjs --dry-run --from 2026-01-01 --until 2026-04-30`. Expected: four window lines, with `rss` flat (not climbing month over month) and under 500 MB. If it climbs, a kept string still references its page. Fix the reader before going on.
- [ ] **Step 3: Docs**
  - `backend/README.md`: a "National bibliography (BNP) import" section with:
    - what it imports;
    - the three steps from the spec's Production section, in the `npx -y @railway/cli@latest ssh … nohup … > /data/import-bnp.log` form the other sections use;
    - how to resume (`--from <through>`, no `--until`) and rerun failed windows (from the first failed window's `from`, no `--until`);
    - that the in-server sync starts only once the cursor exists.
  - `docs/portuguese-book-sources.md:101`: PORBASE becomes "**Imported.**", with a link to the spec.
- [ ] **Step 4: Backend verify.** `npm run test:scripts` is not needed (nothing under root `scripts/`).
- [ ] **Step 5: Commit** `git add backend/scripts/import-bnp.mjs backend/README.md docs/portuguese-book-sources.md && git commit -m "Add the national bibliography import script"`

---

### Task 7: Daily sync in the server

**Files:**
- Modify: `backend/src/modules/books/seed/bnpImport.ts`
- Modify: `backend/src/modules/books/plugin.ts`
- Test: `backend/src/modules/books/seed/bnpImport.test.ts`

**Interfaces:**
- Produces: `export async function syncBnp(deps: BnpHarvestDeps): Promise<BnpImportReport | null>`.
  - With no cursor (`getHarvestCursor("bnp")` is null) it returns `null` and fetches nothing.
  - Otherwise it returns `importBnp(deps, { from: cursor, until: utcDate(deps.now()), dryRun: false, cursorOnSuccess: true })`.
- Produces: `export const BNP_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;`
- Plugin wiring:
  - Build `bnpDeps: BnpHarvestDeps` once in `booksPlugin` (`plugin.ts`) from `repo`, the same object-store blob `save` the service uses, `fetchBnpScan`, `fetchText`, `() => new Date()`, and `log: (line) => app.log.info({ bnp: line }, "bnp sync window")`.
  - `const stopBnpSync = startDetailsBackfill(async () => { const report = await syncBnp(bnpDeps); if (report) app.log.info({ through: report.through, kept: report.kept, created: report.created, failedWindows: report.failedWindows }, "bnp sync"); }, (error) => app.log.error({ err: error }, "bnp sync failed"), BNP_SYNC_INTERVAL_MS);`
  - Call `stopBnpSync()` in the `onClose` hook next to the other stops.
  - `startDetailsBackfill` runs at start and skips a tick while the previous run is still going.

- [ ] **Step 1: Write the failing tests**
```ts
test("the sync does nothing without a cursor", async () => { /* fetchText throws if called; result null */ });
test("the sync harvests from the cursor to today and advances it", async () => { /* cursor 2026-10-16, now 2026-10-18T01:00Z (TZ west), fixture page then empty; cursor becomes 2026-10-18; first URL has from=2026-10-16&until=2026-10-18 */ });
test("a quiet day still advances the cursor", async () => { /* only oai-empty; cursor advances */ });
test("a failed sync window leaves the cursor where it was", async () => { /* fetch throws twice; cursor unchanged */ });
```
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement `syncBnp` and the plugin wiring.**
- [ ] **Step 4: Run the test file, then the backend verify.** Also boot the dev backend once (`docs/dev-workflow.md`). With no cursor in the dev DB, expect no `bnp sync` log line and no request to `oai.bnportugal.gov.pt`.
- [ ] **Step 5: Commit** `git add backend/src/modules/books/seed/bnpImport.ts backend/src/modules/books/seed/bnpImport.test.ts backend/src/modules/books/plugin.ts && git commit -m "Follow the national bibliography daily inside the server"`

---

### Task 8: Ask the BNP first for Portugal ISBN lookups

**Files:**
- Modify: `backend/src/modules/books/seed/bnpImport.ts`
- Modify: `backend/src/modules/books/booksService.ts`
- Modify: `backend/src/modules/books/plugin.ts`
- Test: `backend/src/modules/books/seed/bnpImport.test.ts`
- Test: `backend/src/modules/books/booksService.test.ts`

**Interfaces:**
- Produces: `export const BNP_ISBN_URL = "https://urn.porbase.org/isbn/unimarc/marcxchange?id=";`
- Produces: `export async function lookupBnpIsbn(deps: BnpHarvestDeps, isbn: string): Promise<BookRow | null>`.
  - It fetches `BNP_ISBN_URL + isbn`. A `status !== 200` throws `SourceUnavailableError("urn.porbase.org", …)`.
  - It reads the first record. No record gives `null`.
  - It maps the record and plans it with the asked `isbn`. **No `bnpSkipReason`.**
  - It applies the plan and returns the book.
- `BooksServiceDeps` gains `bnpLookup?: (isbn: string) => Promise<BookRow | null>`. The plugin passes `(isbn) => lookupBnpIsbn(bnpDeps, isbn)`.
- `searchExternal`'s ISBN branch becomes:
  - `isbn = canonicalIsbn(trimmed)`.
  - If `deps.bnpLookup` is set and `isPortugalIsbn(isbn)`:
    - If `findBookByKey("isbn:" + isbn)` has `created_by === "bnp"`, return `withWorkIds([that book])`.
    - Otherwise try `bnpLookup(isbn)`. A book is returned as `withWorkIds([book])`. On `SourceUnavailableError`, call `deps.warn(...)` and fall through. `null` falls through.
  - Then `saveHits(await deps.catalog.search({ isbn }))` as today.

- [ ] **Step 1: Write the failing tests**

`bnpImport.test.ts`:
```ts
test("a Portugal ISBN lookup saves the record with its scan under the asked ISBN", async () => { /* fetchText returns urn-9789720044457.xml; book.isbn "9789720044457", created_by "bnp", cover "good" */ });
test("a lookup keeps a textbook and a record with no person", async () => { /* handwritten urn record with udc "(075" and no 70x → saved, author "" */ });
test("a lookup miss returns null", async () => { /* urn-missing.xml */ });
```
`booksService.test.ts` (extend `harness` with `bnpLookup`):
```ts
test("a Portugal ISBN asks the BNP first and returns its book", async () => { /* bnpLookup returns a book; catalog.search must not be called */ });
test("a BNP outage or miss falls through to the catalog", async () => { /* bnpLookup throws SourceUnavailableError → catalog called; returns null → catalog called */ });
test("a non-Portugal ISBN never asks the BNP", async () => { /* 9780141439518 → bnpLookup not called */ });
test("an ISBN already held from the BNP is returned without asking anyone", async () => { /* created_by "bnp" book; neither bnpLookup nor catalog called */ });
```
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement.**
  - **Check first:** how the mobile barcode screen and the web add form reach the server (`mobile/src/features/library/` and `frontend/src`, search for `search/external` and "barcode"). If either uses a route other than `GET /books/search/external?q=<isbn>`, stop and report it rather than wiring a second path.
- [ ] **Step 4: Run both test files, then the backend verify.** Expected: PASS.
- [ ] **Step 5: Commit** `git add backend/src/modules/books/seed/bnpImport.ts backend/src/modules/books/seed/bnpImport.test.ts backend/src/modules/books/booksService.ts backend/src/modules/books/booksService.test.ts backend/src/modules/books/plugin.ts && git commit -m "Ask the national library first for Portugal ISBNs"`

---

### Task 9: Scale check before production

**Files:**
- Test: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts` (no change expected; this task commits nothing unless a fix is needed)

- [ ] **Step 1: Build a scaled copy.**
  - Use a throwaway script in the scratchpad, not committed.
  - Copy the dev covers DB, then add 240,000 books with the same repository calls `applyBnpRecord` makes for a scan-less record: `createBook` with `createdBy: "bnp"`, then `setCover(id, { imageId: null, status: null, checkedAt })`.
  - Each gets a valid ISBN-13 (`978972` + 6 digits + check), and a title and author drawn from a 60k-title pool so that about 4 editions share a title key.
  - Time the inserts. Expected: under 15 minutes.
- [ ] **Step 2: Time the hot paths on the copy.**
  - The nightly grouping drain: call `repo.groupKeylessWorks(250)` until it returns 0, as `startWorksGrouping` does (`WORKS_BATCH_SIZE` in `backfill.ts` is 250 and not exported). Expected: **under 1 s per call**. Each call holds the write lock and blocks the event loop, and the import's connection gives up after its 5 s `busy_timeout`. Report the total.
  - `searchBooks(searchTokens("casa"), 100)` and `searchBooks(searchTokens("amor"), 100)`: expected under 100 ms.
  - `listUncheckedDetailIds(50)`: expected under 50 ms, with `idx_books_details_pending` in its plan.
  - `listUncheckedCoverIds(null, 500)`: expected under 50 ms.
  - File size versus the original: report MB per 1,000 books.
- [ ] **Step 3: Report the numbers in the PR description.**
  - If a grouping call exceeds 1 s, or a search exceeds 100 ms, stop and report to the user with the numbers before the production run. Don't optimise speculatively.

---

## Production runbook entry (for the batch runbook, after the deploy that ships this branch)

1. `nohup node scripts/import-bnp.mjs --dry-run > /data/import-bnp-dry.log 2>&1 &`, about 3 h. The user reads `publishers.kept`, `publishers.dropped`, `skipped`, `covers`, `replace` and `genres` in the last line.
2. Check `railway volume list --json` for room for about 540 MB of growth plus WAL. Then `nohup node scripts/import-bnp.mjs > /data/import-bnp.log 2>&1 &`, about a day.
   - Avoid deploys meanwhile. If one happens, rerun with `--from <last through>` and no `--until`.
   - If the report lists failed windows, rerun from the first one's `from`, with no `--until`.
3. The next day, check:
   - the logs, for `bnp sync` with `failedWindows: []`;
   - an inside search for `casa dos espiritos`;
   - `railway logs --filter "ISBNdb paused"` on the import day against the days before.
4. Before the next paid `translation-backlog.mjs` run, read its dry-run `selected`: it now includes the imported Portuguese works. Held works still go first.
