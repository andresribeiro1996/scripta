import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, test } from "node:test";
import sharp from "sharp";
import type { BooksRepository } from "../domain/ports.js";
import type { BnpBook } from "./bnpRecord.js";
import type { BnpCoverAction, BnpDeps, BnpHarvestDeps, BnpReplace } from "./bnpImport.js";

const scratch = mkdtempSync(join(tmpdir(), "bnp-import-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("../adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("../adapters/sqlite/sqliteBooksRepository.js");
const { SourceUnavailableError } = await import("../domain/errors.js");
const { catalogTitleKey } = await import("../domain/normalize.js");
const { applyBnpRecord, BNP_ISBN_URL, fetchBnpScan, importBnp, logBnpSync, lookupBnpIsbn, monthWindows, planBnpRecord, syncBnp, utcDate } = await import("./bnpImport.js");
const { mapBnpRecord, readMarcRecords } = await import("./bnpRecord.js");

process.env.TZ = "America/Sao_Paulo";

const NOW = new Date("2026-10-18T12:00:00.000Z");
const AT = NOW.toISOString();
const SCAN = { full: Buffer.from("full"), thumb: Buffer.from("thumb"), width: 400, height: 600, color: "" };
const PORTUGUESE = "9789720044457";
const ENGLISH = "9780141184272";
const ALLENDE = mapBnpRecord(readMarcRecords(readFileSync(new URL("./fixtures/bnp/urn-9789720044457.xml", import.meta.url), "utf8"))[0]!);
const WITHOUT_SCAN: BnpBook = { ...ALLENDE, scanUrl: null };

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function setup(fetchScan: BnpDeps["fetchScan"] = async () => SCAN) {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  const repo = createSqliteBooksRepository(db);
  const blobs = new Map<string, Buffer>();
  const deps: BnpDeps = {
    repo,
    blobs: {
      save: async (id, extension, bytes) => {
        blobs.set(`${id}.${extension}`, bytes);
      }
    },
    fetchScan,
    now: () => NOW
  };
  return { db, repo, blobs, deps };
}

const apply = (deps: BnpDeps, book: BnpBook, isbn?: string) => applyBnpRecord(deps, planBnpRecord(deps.repo, book, isbn)!);

function seed(repo: BooksRepository, isbn: string | null, extra: { createdBy?: "seed"; title?: string; author?: string; publisher?: string; year?: number } = {}) {
  const { createdBy = "seed", title = "Casa", author = "Isabel", ...rest } = extra;
  return repo.createBook({ title, author, isbn, createdBy, ...rest }, isbn ? [`isbn:${isbn}`] : [], AT);
}

function giveCover(repo: BooksRepository, bookId: string, source: "isbndb" | "apple" | "openlibrary" | "upload" | "bnp" | null, status: "good" | "low_res" | "missing" | "manual" | null) {
  if (source === null) {
    repo.setCover(bookId, { imageId: null, status, checkedAt: AT });
    return null;
  }
  const imageId = randomUUID();
  repo.insertImage({ id: imageId, book_id: bookId, source, source_url: null, width: status === "low_res" ? 200 : 500, height: 700, byte_size: 1, color: "", created_at: AT });
  repo.setCover(bookId, { imageId, status, checkedAt: AT });
  return imageId;
}

test("a new record becomes a searchable bnp book with a good scan that no queue selects", async () => {
  const { repo, deps } = setup();
  assert.equal(ALLENDE.isbns[0], PORTUGUESE);

  const result = await apply(deps, ALLENDE);

  assert.equal(result.created, true);
  assert.equal(result.cover, "stored");
  const row = repo.findBookByKey(`isbn:${PORTUGUESE}`)!;
  assert.equal(row.id, result.book.id);
  assert.equal(row.created_by, "bnp");
  assert.equal(row.title, "A casa dos espíritos");
  assert.equal(row.author, "Isabel Allende");
  assert.equal(row.year, 2013);
  assert.equal(row.publisher, "Porto Editora");
  assert.equal(row.pages, 407);
  assert.equal(row.translator, "Cristina Paixão");
  assert.equal(row.original_title, "La casa de los espíritus");
  assert.equal(row.language, "pt-PT");
  assert.equal(row.cover_status, "good");
  assert.equal(row.cover_checked_at, AT);
  assert.equal(repo.getImage(row.cover_image_id!)!.source, "bnp");
  assert.equal(repo.getImage(row.cover_image_id!)!.source_url, ALLENDE.scanUrl);
  assert.ok(repo.isSearchable(row.id));
  assert.ok(!repo.listUncheckedCoverIds(null, 100).ids.includes(row.id));
  assert.ok(!repo.listUncheckedDetailIds(100).includes(row.id));
});

test("a new record without a scan is stamped so only a display schedules it", async () => {
  const { repo, deps } = setup();

  const result = await apply(deps, WITHOUT_SCAN);

  assert.equal(result.cover, "noScan");
  assert.equal(result.book.cover_status, null);
  assert.equal(result.book.cover_image_id, null);
  assert.equal(result.book.cover_checked_at, AT);
  assert.ok(!repo.listUncheckedCoverIds(null, 100).ids.includes(result.book.id));
});

test("a new record carries its subject genres", async () => {
  const { deps } = setup();
  const result = await apply(deps, { ...WITHOUT_SCAN, udc: ["821.134.2-1"] });
  assert.deepEqual(JSON.parse(result.book.genres), ["Poetry"]);
});

test("an existing book gets empty fields filled and nothing overwritten", async () => {
  const { repo, deps } = setup();
  const existing = seed(repo, PORTUGUESE, { title: "Casa dos Espiritos", author: "I. Allende", publisher: "Outra", year: 2000 });
  repo.mergeDetails(existing.id, { summary: "Existing summary.", pages: null, year: null, publisher: null, translator: null }, "openlibrary");

  const result = await apply(deps, { ...WITHOUT_SCAN, summary: "BNP summary." });

  assert.equal(result.created, false);
  assert.equal(result.book.id, existing.id);
  assert.equal(result.book.title, "Casa dos Espiritos");
  assert.equal(result.book.author, "I. Allende");
  assert.equal(result.book.publisher, "Outra");
  assert.equal(result.book.year, 2000);
  assert.equal(result.book.summary, "Existing summary.");
  assert.equal(result.book.summary_source, "openlibrary");
  assert.equal(result.book.pages, 407);
  assert.equal(result.book.translator, "Cristina Paixão");
  assert.equal(result.book.original_title, "La casa de los espíritus");
  assert.equal(result.book.language, "pt-PT");
});

test("an existing book with an empty summary takes the bnp one", async () => {
  const { repo, deps } = setup();
  seed(repo, PORTUGUESE);
  const result = await apply(deps, { ...WITHOUT_SCAN, summary: "BNP summary." });
  assert.equal(result.book.summary, "BNP summary.");
  assert.equal(result.book.summary_source, "bnp");
});

test("an existing book missing its title and author takes the record's", async () => {
  const { repo, deps } = setup();
  seed(repo, PORTUGUESE, { title: "", author: "" });
  const result = await apply(deps, WITHOUT_SCAN);
  assert.equal(result.book.title, "A casa dos espíritos");
  assert.equal(result.book.author, "Isabel Allende");
});

const REPLACEMENTS: Array<[string, string, "isbndb" | "apple" | "openlibrary" | "upload" | "bnp" | null, "good" | "low_res" | "missing" | "manual" | null, BnpReplace | null]> = [
  ["no cover at all", PORTUGUESE, null, null, "none"],
  ["a missing cover", PORTUGUESE, null, "missing", "none"],
  ["a low-res Open Library cover", PORTUGUESE, "openlibrary", "low_res", "lowRes"],
  ["a low-res BNP scan", PORTUGUESE, "bnp", "low_res", null],
  ["a good ISBNdb cover on a Portugal ISBN", PORTUGUESE, "isbndb", "good", "isbndb"],
  ["a manual upload", PORTUGUESE, "upload", "manual", null],
  ["a manual state without an image", PORTUGUESE, null, "manual", null],
  ["a good Apple cover", PORTUGUESE, "apple", "good", null],
  ["a good Open Library cover", PORTUGUESE, "openlibrary", "good", null],
  ["a good ISBNdb cover on an English ISBN", ENGLISH, "isbndb", "good", null]
];

for (const [label, isbn, source, status, reason] of REPLACEMENTS) {
  test(`the scan ${reason === null ? "keeps" : "replaces"} ${label}`, async () => {
    const { repo, blobs, deps } = setup();
    const held = seed(repo, isbn);
    const previous = giveCover(repo, held.id, source, status);
    const book = { ...ALLENDE, isbns: [isbn] };

    const plan = planBnpRecord(repo, book)!;
    assert.equal(plan.replace, reason);
    const result = await applyBnpRecord(deps, plan);

    if (reason === null) {
      assert.equal(result.cover, "kept");
      assert.equal(result.book.cover_image_id, previous);
      assert.equal(blobs.size, 0);
    } else {
      assert.equal(result.cover, "stored");
      assert.notEqual(result.book.cover_image_id, previous);
      assert.equal(repo.getImage(result.book.cover_image_id!)!.source, "bnp");
      assert.equal(result.book.cover_status, "good");
      assert.equal(blobs.size, 2);
    }
  });
}

test("a scan under the good width is stored as low-res", async () => {
  const { deps } = setup(async () => ({ ...SCAN, width: 300, height: 450 }));
  const result = await apply(deps, ALLENDE);
  assert.equal(result.cover, "stored");
  assert.equal(result.book.cover_status, "low_res");
  assert.equal(result.book.cover_checked_at, AT);
});

test("a low-res scan is not downloaded again when its record is applied again", async () => {
  const { db, repo, blobs, deps } = setup(async () => ({ ...SCAN, width: 300, height: 450 }));
  const stale = [planBnpRecord(repo, ALLENDE)!, planBnpRecord(repo, ALLENDE)!];

  const first = await applyBnpRecord(deps, stale[0]!);
  const second = await applyBnpRecord(deps, stale[1]!);
  const third = await apply(deps, ALLENDE);

  assert.equal(first.cover, "stored");
  assert.equal(first.book.cover_status, "low_res");
  assert.equal(second.cover, "kept");
  assert.equal(third.cover, "kept");
  assert.equal(third.book.cover_image_id, first.book.cover_image_id);
  assert.equal(blobs.size, 2);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM cover_images WHERE book_id = ?").get(first.book.id) as { n: number }).n, 1);
});

test("an existing book with no scan in its record keeps its cover state", async () => {
  const { repo, deps } = setup();
  const existing = seed(repo, PORTUGUESE);
  assert.equal(existing.cover_status, null);
  assert.equal(existing.cover_checked_at, null);

  const result = await apply(deps, WITHOUT_SCAN);

  assert.equal(result.cover, "noScan");
  assert.equal(result.book.cover_status, null);
  assert.equal(result.book.cover_image_id, null);
  assert.equal(result.book.cover_checked_at, null);
});

test("a record with several ISBNs creates and keys only its first", async () => {
  const { repo, deps } = setup();
  const other = seed(repo, ENGLISH);
  const before = repo.getBook(other.id);

  const result = await apply(deps, { ...WITHOUT_SCAN, isbns: [PORTUGUESE, ENGLISH] });

  assert.equal(result.created, true);
  assert.notEqual(result.book.id, other.id);
  assert.equal(repo.findBookByKey(`isbn:${PORTUGUESE}`)!.id, result.book.id);
  assert.equal(repo.findBookByKey(`isbn:${ENGLISH}`)!.id, other.id);
  assert.deepEqual(repo.getBook(other.id), before);
});

test("a plan uses the first ISBN, the given one, or none", () => {
  const { repo } = setup();
  assert.equal(planBnpRecord(repo, { ...ALLENDE, isbns: [] }), null);
  assert.equal(planBnpRecord(repo, { ...ALLENDE, isbns: [PORTUGUESE, ENGLISH] })!.isbn, PORTUGUESE);
  const other = seed(repo, ENGLISH);
  const plan = planBnpRecord(repo, { ...ALLENDE, isbns: [] }, ENGLISH)!;
  assert.equal(plan.isbn, ENGLISH);
  assert.equal(plan.existing!.id, other.id);
  const first = planBnpRecord(repo, { ...ALLENDE, isbns: [PORTUGUESE, ENGLISH] })!;
  assert.equal(first.existing, undefined);
  assert.equal(first.replace, "new");
});

test("an ISBN-less book with the same title is not adopted", async () => {
  const { repo, deps } = setup();
  const titleKey = catalogTitleKey("A casa dos espíritos", "Isabel Allende")!;
  const keyless = repo.createBook({ title: "A casa dos espíritos", author: "Isabel Allende", isbn: null, createdBy: "seed" }, [titleKey], AT);

  const result = await apply(deps, WITHOUT_SCAN);

  assert.equal(result.created, true);
  assert.notEqual(result.book.id, keyless.id);
  assert.equal(repo.findBookByKey(titleKey)!.id, keyless.id);
  assert.equal(repo.getBook(keyless.id)!.isbn, null);
});

test("a new book takes the title key when no book holds it", async () => {
  const { repo, deps } = setup();
  const result = await apply(deps, WITHOUT_SCAN);
  assert.equal(repo.findBookByKey(catalogTitleKey("A casa dos espíritos", "Isabel Allende")!)!.id, result.book.id);
});

test("applying the same record twice creates one book and uploads one scan", async () => {
  const { db, repo, blobs, deps } = setup();
  const stale = [planBnpRecord(repo, ALLENDE)!, planBnpRecord(repo, ALLENDE)!];

  const first = await applyBnpRecord(deps, stale[0]!);
  const second = await applyBnpRecord(deps, stale[1]!);
  const third = await apply(deps, ALLENDE);

  assert.equal(first.created, true);
  assert.equal(first.cover, "stored");
  assert.equal(second.created, false);
  assert.equal(second.cover, "kept");
  assert.equal(third.created, false);
  assert.equal(third.cover, "kept");
  assert.equal(second.book.id, first.book.id);
  assert.equal(third.book.cover_image_id, first.book.cover_image_id);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM books").get() as { n: number }).n, 1);
  assert.equal(blobs.size, 2);
});

test("a cover uploaded during the scan download is kept", async () => {
  for (const [source, status] of [["upload", "manual"], ["apple", "good"]] as const) {
    const holder: { repo?: BooksRepository; bookId?: string; imageId?: string | null } = {};
    const { repo, blobs, deps } = setup(async () => {
      holder.imageId = giveCover(holder.repo!, holder.bookId!, source, status);
      return SCAN;
    });
    holder.repo = repo;
    const existing = seed(repo, PORTUGUESE);
    holder.bookId = existing.id;
    giveCover(repo, existing.id, "openlibrary", "low_res");

    const plan = planBnpRecord(repo, ALLENDE)!;
    assert.equal(plan.replace, "lowRes");
    const result = await applyBnpRecord(deps, plan);

    assert.equal(result.cover, "kept");
    assert.equal(result.book.cover_image_id, holder.imageId);
    assert.equal(result.book.cover_status, status);
    assert.equal(blobs.size, 0);
  }
});

test("a cover uploaded while the scan is stored is kept", async () => {
  const { repo, blobs, deps } = setup();
  const existing = seed(repo, PORTUGUESE);
  const save = deps.blobs.save;
  let uploaded: string | null = null;
  deps.blobs.save = async (id, extension, bytes) => {
    await save(id, extension, bytes);
    uploaded ??= giveCover(repo, existing.id, "upload", "manual");
  };

  const result = await apply(deps, ALLENDE);

  assert.equal(result.cover, "kept");
  assert.ok(uploaded);
  assert.equal(result.book.cover_image_id, uploaded);
  assert.equal(result.book.cover_status, "manual");
  assert.equal(blobs.size, 2);
});

test("the returned book carries the stored cover", async () => {
  const { repo, deps } = setup();
  seed(repo, PORTUGUESE);

  const result = await apply(deps, ALLENDE);

  assert.equal(result.cover, "stored");
  assert.ok(result.book.cover_image_id);
  assert.equal(repo.getImage(result.book.cover_image_id)!.source, "bnp");
  assert.equal(result.book.cover_status, "good");
  assert.equal(result.book.cover_checked_at, AT);
});

test("a failed or rejected scan leaves a new book stamped and coverless", async () => {
  const outcomes: Array<[BnpCoverAction, BnpDeps["fetchScan"]]> = [
    ["failed", async () => Promise.reject(new SourceUnavailableError("rnod.bnportugal.gov.pt", "HTTP 503"))],
    ["failed", async () => null],
    ["rejected", async () => ({ ...SCAN, width: 400, height: 420 })]
  ];
  for (const [cover, fetchScan] of outcomes) {
    const { repo, blobs, deps } = setup(fetchScan);

    const result = await apply(deps, ALLENDE);

    assert.equal(result.created, true);
    assert.equal(result.cover, cover);
    assert.equal(result.book.cover_status, null);
    assert.equal(result.book.cover_image_id, null);
    assert.equal(result.book.cover_checked_at, AT);
    assert.ok(!repo.listUncheckedCoverIds(null, 100).ids.includes(result.book.id));
    assert.equal(blobs.size, 0);
  }
});

test("an error other than an unavailable source is not swallowed", async () => {
  const { db, deps } = setup(async () => Promise.reject(new Error("boom")));
  await assert.rejects(apply(deps, ALLENDE), /boom/);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM books").get() as { n: number }).n, 0);
});

test("an unconfirmed existing book becomes searchable", async () => {
  const { repo, deps } = setup();
  const unconfirmed = repo.createBook({ title: "Casa", author: "Isabel", isbn: PORTUGUESE }, [`isbn:${PORTUGUESE}`], AT);
  assert.equal(unconfirmed.created_by, null);
  assert.ok(!repo.isSearchable(unconfirmed.id));

  const result = await apply(deps, WITHOUT_SCAN);

  assert.ok(repo.isSearchable(unconfirmed.id));
  assert.deepEqual(JSON.parse(result.book.data_sources), ["bnp"]);
});

test("subject genres fill an empty book but never a manual one", async () => {
  const poetry = { ...WITHOUT_SCAN, udc: ["821.134.2-1"] };
  const empty = setup();
  const emptied = seed(empty.repo, PORTUGUESE);
  assert.equal(emptied.genres, "[]");
  assert.deepEqual(JSON.parse((await apply(empty.deps, poetry)).book.genres), ["Poetry"]);

  const manual = setup();
  const marked = seed(manual.repo, PORTUGUESE);
  manual.db.prepare("UPDATE books SET genres = ?, genres_source = 'manual' WHERE id = ?").run('["Fantasy"]', marked.id);
  const kept = (await apply(manual.deps, poetry)).book;
  assert.deepEqual(JSON.parse(kept.genres), ["Fantasy"]);
  assert.equal(kept.genres_source, "manual");
});

test("fetchBnpScan encodes a scan and gives null for a missing or undecodable one", async () => {
  const png = await sharp({ create: { width: 400, height: 600, channels: 3, background: "#336699" } }).png().toBuffer();
  const answer = (status: number, body: Uint8Array<ArrayBuffer> | string) => {
    globalThis.fetch = (async () => new Response(body, { status })) as typeof fetch;
  };

  answer(200, new Uint8Array(png));
  const scan = await fetchBnpScan("https://rnod.bnportugal.gov.pt/scan");
  assert.equal(scan?.width, 400);
  assert.equal(scan?.height, 600);

  answer(404, "not found");
  assert.equal(await fetchBnpScan("https://rnod.bnportugal.gov.pt/scan"), null);
  answer(200, "not an image");
  assert.equal(await fetchBnpScan("https://rnod.bnportugal.gov.pt/scan"), null);
});

const OAI = "https://oai.bnportugal.gov.pt/servlet/OAIHandler";
const windowUrl = (from: string, until: string) => `${OAI}?verb=ListRecords&metadataPrefix=marcxchange&set=bibliografianacional&from=${from}&until=${until}`;
const tokenUrl = (token: string) => `${OAI}?verb=ListRecords&resumptionToken=${token}`;
const fixture = (name: string) => readFileSync(new URL(`./fixtures/bnp/${name}`, import.meta.url), "utf8");
const FIXTURE_PAGE = fixture("oai-page.xml");
const EMPTY_PAGE = fixture("oai-empty.xml");
const ALLENDE_RECORD = /<record\b[\s\S]*<\/record>/.exec(fixture("urn-9789720044457.xml"))![0];
const ENVELOPE = '<?xml version="1.0" encoding="UTF-8" ?><OAI-PMH xmlns="http://www.openarchives.org/OAI/2.0/"><responseDate>2026-10-18T12:00:00Z</responseDate>';
const oaiPage = (records: string[], token = "") => `${ENVELOPE}<ListRecords>${records.join("")}${token && `<resumptionToken>${token}</resumptionToken>`}</ListRecords></OAI-PMH>`;
const oaiError = (code: string) => `${ENVELOPE}<error code="${code}">nothing</error></OAI-PMH>`;
const DELETED_RECORD = '<record><header status="deleted"><identifier>oai:oai.bn.pt:bibliografianacional/1</identifier><datestamp>2026-10-16</datestamp></header></record>';

function isbnN(n: number): string {
  const body = `9789720${String(n).padStart(5, "0")}`;
  const sum = [...body].reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return `${body}${(10 - (sum % 10)) % 10}`;
}

const recordOf = (isbn: string) => ALLENDE_RECORD.replace("978-972-0-04445-7", isbn).replace("doc=1858036", `doc=${isbn}`);
const run = (from: string, until: string, extra: Partial<{ dryRun: boolean; cursorOnSuccess: boolean }> = {}) => ({ from, until, dryRun: false, cursorOnSuccess: false, ...extra });
const bookCount = (db: DatabaseSync) => (db.prepare("SELECT COUNT(*) AS n FROM books").get() as { n: number }).n;
const unavailable = () => new SourceUnavailableError("oai.bnportugal.gov.pt", "HTTP 503");
const UNAVAILABLE = "oai.bnportugal.gov.pt unavailable: HTTP 503";
const TRUNCATED = oaiPage([recordOf(isbnN(2))]).slice(0, -40);

type Reply = string | { status: number; text: string } | Error;

function harvestSetup(script: Record<string, Reply | Reply[]>, scan: BnpDeps["fetchScan"] = async () => SCAN) {
  const base = setup(scan);
  const events: string[] = [];
  const asked = new Map<string, number>();
  const logs: string[] = [];
  const deps: BnpHarvestDeps = {
    ...base.deps,
    fetchScan: async (url) => {
      events.push("scan");
      return scan(url);
    },
    fetchText: async (url) => {
      events.push("text");
      const replies = [script[url] ?? new Error(`unscripted ${url}`)].flat();
      const turn = asked.get(url) ?? 0;
      asked.set(url, turn + 1);
      const reply = replies[Math.min(turn, replies.length - 1)]!;
      if (reply instanceof Error) throw reply;
      return typeof reply === "string" ? { status: 200, text: reply } : reply;
    },
    log: (line) => logs.push(line)
  };
  return { ...base, deps, events, asked, logs };
}

test("monthWindows splits by calendar month inclusively", () => {
  assert.deepEqual(monthWindows("2026-09-15", "2026-10-03"), [{ from: "2026-09-15", until: "2026-09-30" }, { from: "2026-10-01", until: "2026-10-03" }]);
  assert.deepEqual(monthWindows("2026-10-18", "2026-10-18"), [{ from: "2026-10-18", until: "2026-10-18" }]);
  assert.deepEqual(monthWindows("2024-02-10", "2024-03-01"), [{ from: "2024-02-10", until: "2024-02-29" }, { from: "2024-03-01", until: "2024-03-01" }]);
  assert.deepEqual(monthWindows("2025-12-20", "2026-01-05"), [{ from: "2025-12-20", until: "2025-12-31" }, { from: "2026-01-01", until: "2026-01-05" }]);
  assert.deepEqual(monthWindows("2026-10-19", "2026-10-18"), []);
});

test("utcDate is the UTC day even west of UTC", () => {
  assert.equal(new Date("2026-10-18T01:00:00Z").getDate(), 17);
  assert.equal(utcDate(new Date("2026-10-18T01:00:00Z")), "2026-10-18");
  assert.equal(utcDate(new Date("2026-10-18T23:59:59Z")), "2026-10-18");
});

test("a window follows its resumption token and applies every kept record", async () => {
  const D = "2026-10-16";
  const { repo, blobs, logs, deps } = harvestSetup({
    [windowUrl(D, "2026-10-17")]: FIXTURE_PAGE,
    [tokenUrl("TOKEN-1")]: oaiPage([recordOf(isbnN(1)), DELETED_RECORD])
  });

  const report = await importBnp(deps, run(D, "2026-10-17"));

  assert.equal(report.dryRun, false);
  assert.equal(report.from, D);
  assert.equal(report.until, "2026-10-17");
  assert.equal(report.through, "2026-10-17");
  assert.equal(report.records, 5);
  assert.equal(report.deleted, 1);
  assert.equal(report.kept, 3);
  assert.deepEqual(report.skipped, { noIsbn: 0, textbook: 0, noPublisher: 0, institutional: 1, noPerson: 0 });
  assert.equal(report.created, 3);
  assert.equal(report.matched, 0);
  assert.deepEqual(report.covers, { stored: 1, kept: 0, noScan: 2, rejected: 0, failed: 0 });
  assert.deepEqual(report.replace, { new: 3, none: 0, lowRes: 0, isbndb: 0 });
  assert.equal(report.genres.Politics, 1);
  assert.equal(report.genres.Philosophy, 1);
  assert.deepEqual(report.publishers.dropped.institutional, [["Câmara Municipal de Viana do Castelo", 1]]);
  assert.deepEqual(new Map(report.publishers.kept).get("Relógio d'Água"), 1);
  assert.equal(report.samples.length, 3);
  assert.deepEqual(report.failedWindows, []);
  assert.equal(repo.findBookByKey("isbn:9789727089482")!.created_by, "bnp");
  assert.equal(repo.findBookByKey("isbn:9789722328012")!.created_by, "bnp");
  assert.equal(repo.findBookByKey(`isbn:${isbnN(1)}`)!.cover_status, "good");
  assert.equal(repo.findBookByKey("isbn:9789725882856"), undefined);
  assert.equal(blobs.size, 2);
  assert.deepEqual(logs.map((line) => JSON.parse(line)), [{ window: "2026-10-16..2026-10-17", through: "2026-10-17", records: 5, kept: 3, failed: null }]);
});

test("a resumption token is URL-encoded in the next request", async () => {
  const token = "a b/c=";
  const { deps } = harvestSetup({
    [windowUrl("2026-10-16", "2026-10-17")]: FIXTURE_PAGE.replace("TOKEN-1", token),
    [tokenUrl(encodeURIComponent(token))]: EMPTY_PAGE
  });
  const report = await importBnp(deps, run("2026-10-16", "2026-10-17"));
  assert.deepEqual(report.failedWindows, []);
  assert.equal(report.records, 3);
});

test("a quiet window is zero records and still moves through", async () => {
  for (const page of [EMPTY_PAGE, oaiError("noRecordsMatch")]) {
    const { repo, logs, deps } = harvestSetup({ [windowUrl("2026-10-18", "2026-10-18")]: page });

    const report = await importBnp(deps, run("2026-10-18", "2026-10-18", { cursorOnSuccess: true }));

    assert.equal(report.records, 0);
    assert.equal(report.kept, 0);
    assert.equal(report.through, "2026-10-18");
    assert.deepEqual(report.failedWindows, []);
    assert.equal(repo.getHarvestCursor("bnp"), "2026-10-18");
    assert.deepEqual(logs.map((line) => JSON.parse(line)), [{ window: "2026-10-18..2026-10-18", through: "2026-10-18", records: 0, kept: 0, failed: null }]);
  }
});

test("a dry run writes and fetches nothing and still reports the plan", async () => {
  const { db, repo, blobs, events, deps } = harvestSetup(
    {
      [windowUrl("2026-10-16", "2026-10-17")]: FIXTURE_PAGE,
      [tokenUrl("TOKEN-1")]: oaiPage([recordOf(isbnN(1))])
    },
    async () => {
      throw new Error("a dry run must not download a scan");
    }
  );
  seed(repo, "9789727089482");
  const lowRes = seed(repo, isbnN(1));
  giveCover(repo, lowRes.id, "openlibrary", "low_res");
  const before = JSON.stringify(db.prepare("SELECT * FROM books ORDER BY id").all());

  const report = await importBnp(deps, run("2026-10-16", "2026-10-17", { dryRun: true, cursorOnSuccess: true }));

  assert.equal(report.dryRun, true);
  assert.equal(report.records, 4);
  assert.equal(report.kept, 3);
  assert.equal(report.created, 1);
  assert.equal(report.matched, 2);
  assert.deepEqual(report.covers, { stored: 1, kept: 0, noScan: 2, rejected: 0, failed: 0 });
  assert.deepEqual(report.replace, { new: 1, none: 1, lowRes: 1, isbndb: 0 });
  assert.deepEqual(report.publishers.dropped.institutional, [["Câmara Municipal de Viana do Castelo", 1]]);
  assert.equal(report.samples.length, 3);
  assert.equal(bookCount(db), 2);
  assert.equal(JSON.stringify(db.prepare("SELECT * FROM books ORDER BY id").all()), before);
  assert.equal(blobs.size, 0);
  assert.ok(!events.includes("scan"));
  assert.equal(repo.getHarvestCursor("bnp"), null);
});

test("a dry run counts an ISBN it has already seen as matched, with nothing to replace", async () => {
  const isbn = isbnN(1);
  const { deps } = harvestSetup({ [windowUrl("2026-10-16", "2026-10-16")]: oaiPage([recordOf(isbn), recordOf(isbn)]) });

  const report = await importBnp(deps, run("2026-10-16", "2026-10-16", { dryRun: true }));

  assert.equal(report.kept, 2);
  assert.equal(report.created, 1);
  assert.equal(report.matched, 1);
  assert.deepEqual(report.covers, { stored: 1, kept: 1, noScan: 0, rejected: 0, failed: 0 });
  assert.deepEqual(report.replace, { new: 1, none: 0, lowRes: 0, isbndb: 0 });
});

test("publisher tallies are cut to the top 50 and ordered by count", async () => {
  const publisherOf = (name: string) => (isbn: string) => recordOf(isbn).replace("Porto Editora", name);
  const popular = publisherOf("Editora Popular");
  const records = [
    ...Array.from({ length: 60 }, (_, index) => publisherOf(`Editora ${String(index).padStart(2, "0")}`)(isbnN(index + 100))),
    popular(isbnN(1)),
    popular(isbnN(2))
  ];
  const { deps } = harvestSetup({ [windowUrl("2026-10-16", "2026-10-16")]: oaiPage(records) });

  const report = await importBnp(deps, run("2026-10-16", "2026-10-16", { dryRun: true }));

  assert.equal(report.publishers.kept.length, 50);
  assert.deepEqual(report.publishers.kept[0], ["Editora Popular", 2]);
  assert.deepEqual(report.publishers.kept[1], ["Editora 00", 1]);
});

test("a window that fails twice is listed and through stops before it", async () => {
  const { repo, asked, logs, deps } = harvestSetup({
    [windowUrl("2026-09-15", "2026-09-30")]: oaiPage([recordOf(isbnN(1))]),
    [windowUrl("2026-10-01", "2026-10-03")]: [unavailable(), unavailable()]
  });

  const report = await importBnp(deps, run("2026-09-15", "2026-10-03", { cursorOnSuccess: true }));

  assert.deepEqual(report.failedWindows, ["2026-10-01..2026-10-03"]);
  assert.equal(report.through, "2026-09-30");
  assert.equal(asked.get(windowUrl("2026-10-01", "2026-10-03")), 4);
  assert.equal(repo.getHarvestCursor("bnp"), null);
  assert.deepEqual(logs.map((line) => JSON.parse(line)), [
    { window: "2026-09-15..2026-09-30", through: "2026-09-30", records: 1, kept: 1, failed: null },
    { window: "2026-10-01..2026-10-03", through: "2026-09-30", records: 0, kept: 0, failed: UNAVAILABLE }
  ]);
});

test("later windows are still harvested after a failed one, and through stays before it", async () => {
  const { repo, deps } = harvestSetup({
    [windowUrl("2026-09-15", "2026-09-30")]: oaiPage([recordOf(isbnN(1))]),
    [windowUrl("2026-10-01", "2026-10-31")]: unavailable(),
    [windowUrl("2026-11-01", "2026-11-02")]: oaiPage([recordOf(isbnN(2))])
  });

  const report = await importBnp(deps, run("2026-09-15", "2026-11-02"));

  assert.deepEqual(report.failedWindows, ["2026-10-01..2026-10-31"]);
  assert.equal(report.through, "2026-09-30");
  assert.equal(report.created, 2);
  assert.ok(repo.findBookByKey(`isbn:${isbnN(2)}`));
});

const TRANSIENT: Array<[string, Reply]> = [
  ["a 503 answer", { status: 503, text: oaiPage([recordOf(isbnN(2))]) }],
  ["an unavailable source", unavailable()],
  ["a truncated page", TRUNCATED]
];

for (const [label, failure] of TRANSIENT) {
  test(`a page that fails once with ${label} is fetched again without restarting the window`, async () => {
    const { db, blobs, asked, logs, deps } = harvestSetup({
      [windowUrl("2026-10-16", "2026-10-17")]: FIXTURE_PAGE,
      [tokenUrl("TOKEN-1")]: [failure, oaiPage([recordOf(isbnN(1))])]
    });

    const report = await importBnp(deps, run("2026-10-16", "2026-10-17"));

    assert.deepEqual(report.failedWindows, []);
    assert.equal(report.through, "2026-10-17");
    assert.equal(asked.get(windowUrl("2026-10-16", "2026-10-17")), 1);
    assert.equal(asked.get(tokenUrl("TOKEN-1")), 2);
    assert.equal(report.records, 4);
    assert.equal(report.kept, 3);
    assert.equal(report.created, 3);
    assert.equal(bookCount(db), 3);
    assert.equal(blobs.size, 2);
    assert.equal(JSON.parse(logs[0]!).failed, null);
  });
}

test("a bad resumption token restarts the window from its first URL", async () => {
  const { db, blobs, asked, deps } = harvestSetup({
    [windowUrl("2026-10-16", "2026-10-17")]: FIXTURE_PAGE,
    [tokenUrl("TOKEN-1")]: [oaiError("badResumptionToken"), oaiPage([recordOf(isbnN(1))])]
  });

  const report = await importBnp(deps, run("2026-10-16", "2026-10-17"));

  assert.deepEqual(report.failedWindows, []);
  assert.equal(asked.get(windowUrl("2026-10-16", "2026-10-17")), 2);
  assert.equal(asked.get(tokenUrl("TOKEN-1")), 2);
  assert.equal(report.records, 4);
  assert.equal(report.created, 3);
  assert.equal(bookCount(db), 3);
  assert.equal(blobs.size, 2);
});

test("a page failing twice in a row restarts the window", async () => {
  const { db, asked, deps } = harvestSetup({
    [windowUrl("2026-10-16", "2026-10-17")]: FIXTURE_PAGE,
    [tokenUrl("TOKEN-1")]: [{ status: 503, text: "" }, { status: 503, text: "" }, oaiPage([recordOf(isbnN(1))])]
  });

  const report = await importBnp(deps, run("2026-10-16", "2026-10-17"));

  assert.deepEqual(report.failedWindows, []);
  assert.equal(asked.get(windowUrl("2026-10-16", "2026-10-17")), 2);
  assert.equal(asked.get(tokenUrl("TOKEN-1")), 3);
  assert.equal(report.records, 4);
  assert.equal(bookCount(db), 3);
});

const PERSISTENT: Array<[string, Reply, string, number]> = [
  ["a 503 answer", { status: 503, text: oaiPage([]) }, "HTTP 503", 4],
  ["an unavailable source", unavailable(), UNAVAILABLE, 4],
  ["a truncated page", TRUNCATED, "truncated", 4],
  ["an OAI error", oaiError("badResumptionToken"), "badResumptionToken", 2]
];

for (const [label, failure, reason, attempts] of PERSISTENT) {
  test(`a window whose page fails with ${label} on both passes is listed with the reason`, async () => {
    const { db, repo, asked, logs, deps } = harvestSetup({
      [windowUrl("2026-10-16", "2026-10-17")]: FIXTURE_PAGE,
      [tokenUrl("TOKEN-1")]: failure
    });

    const report = await importBnp(deps, run("2026-10-16", "2026-10-17", { cursorOnSuccess: true }));

    assert.deepEqual(report.failedWindows, ["2026-10-16..2026-10-17"]);
    assert.equal(report.through, null);
    assert.equal(report.records, 0);
    assert.equal(asked.get(windowUrl("2026-10-16", "2026-10-17")), 2);
    assert.equal(asked.get(tokenUrl("TOKEN-1")), attempts);
    assert.equal(bookCount(db), 0);
    assert.equal(repo.getHarvestCursor("bnp"), null);
    assert.deepEqual(logs.map((line) => JSON.parse(line)), [{ window: "2026-10-16..2026-10-17", through: null, records: 0, kept: 0, failed: reason }]);
  });
}

test("an error other than an unavailable source ends the run without a retry", async () => {
  const { asked, deps } = harvestSetup({ [windowUrl("2026-10-16", "2026-10-16")]: new Error("boom") });
  await assert.rejects(importBnp(deps, run("2026-10-16", "2026-10-16")), /boom/);
  assert.equal(asked.get(windowUrl("2026-10-16", "2026-10-16")), 1);
});

test("a window's pages are all fetched before its first scan", async () => {
  const { events, deps } = harvestSetup({
    [windowUrl("2026-09-30", "2026-09-30")]: oaiPage([recordOf(isbnN(1))], "TOKEN-1"),
    [tokenUrl("TOKEN-1")]: oaiPage([recordOf(isbnN(2))]),
    [windowUrl("2026-10-01", "2026-10-01")]: EMPTY_PAGE
  });

  await importBnp(deps, run("2026-09-30", "2026-10-01"));

  assert.deepEqual(events, ["text", "text", "scan", "scan", "text"]);
});

test("two records with the same ISBN in one window make one book and one upload", async () => {
  const isbn = isbnN(1);
  const scanned: string[] = [];
  const { db, blobs, deps } = harvestSetup({ [windowUrl("2026-10-16", "2026-10-16")]: oaiPage([recordOf(isbn), recordOf(isbn)]) }, async (url) => {
    scanned.push(url);
    return SCAN;
  });

  const report = await importBnp(deps, run("2026-10-16", "2026-10-16"));

  assert.equal(report.kept, 2);
  assert.equal(report.created, 1);
  assert.equal(report.matched, 1);
  assert.deepEqual(report.covers, { stored: 1, kept: 1, noScan: 0, rejected: 0, failed: 0 });
  assert.equal(bookCount(db), 1);
  assert.equal(scanned.length, 1);
  assert.equal(blobs.size, 2);
});

test("two scans run at once, never for the same ISBN, and the counts match a sequential run", async () => {
  const [a, b, c, d, e] = [1, 2, 3, 4, 5].map(isbnN) as [string, string, string, string, string];
  const fetched: string[] = [];
  let active = 0;
  let peak = 0;
  const { db, blobs, deps } = harvestSetup({ [windowUrl("2026-10-16", "2026-10-16")]: oaiPage([a, b, a, c, d, e, b].map(recordOf)) }, async (url) => {
    fetched.push(url);
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return SCAN;
  });

  const report = await importBnp(deps, run("2026-10-16", "2026-10-16"));

  assert.equal(peak, 2);
  assert.equal(fetched.length, 5);
  assert.equal(new Set(fetched).size, 5);
  assert.equal(report.kept, 7);
  assert.equal(report.created, 5);
  assert.equal(report.matched, 2);
  assert.deepEqual(report.covers, { stored: 5, kept: 2, noScan: 0, rejected: 0, failed: 0 });
  assert.deepEqual(report.replace, { new: 5, none: 0, lowRes: 0, isbndb: 0 });
  assert.equal(bookCount(db), 5);
  assert.equal(blobs.size, 10);
});

test("an error while applying stops further records and propagates", async () => {
  const scans: string[] = [];
  const { deps } = harvestSetup({ [windowUrl("2026-10-16", "2026-10-16")]: oaiPage([1, 2, 3, 4].map((n) => recordOf(isbnN(n)))) }, async (url) => {
    scans.push(url);
    throw new Error("boom");
  });

  await assert.rejects(importBnp(deps, run("2026-10-16", "2026-10-16")), /boom/);

  assert.equal(scans.length, 2);
});

test("a finished run writes the cursor only when asked, never on a dry run or after a failed window", async () => {
  const cases: Array<[string, { dryRun?: boolean; cursorOnSuccess: boolean }, Reply, string | null]> = [
    ["asked", { cursorOnSuccess: true }, EMPTY_PAGE, "2026-10-18"],
    ["not asked", { cursorOnSuccess: false }, EMPTY_PAGE, null],
    ["a dry run", { cursorOnSuccess: true, dryRun: true }, EMPTY_PAGE, null],
    ["a failed window", { cursorOnSuccess: true }, unavailable(), null]
  ];
  for (const [label, extra, reply, cursor] of cases) {
    const { repo, deps } = harvestSetup({ [windowUrl("2026-10-18", "2026-10-18")]: reply });
    await importBnp(deps, run("2026-10-18", "2026-10-18", extra));
    assert.equal(repo.getHarvestCursor("bnp"), cursor, label);
  }
});

const SYNC_NOW = () => new Date("2026-10-18T01:00:00.000Z");

test("the sync does nothing without a cursor", async () => {
  const { deps, events, asked, logs } = harvestSetup({});

  const report = await syncBnp({ ...deps, now: SYNC_NOW });

  assert.equal(report, null);
  assert.deepEqual(events, []);
  assert.equal(asked.size, 0);
  assert.deepEqual(logs, []);
});

test("the sync harvests from the cursor to today and advances it", async () => {
  const { repo, asked, deps } = harvestSetup({
    [windowUrl("2026-10-16", "2026-10-18")]: FIXTURE_PAGE,
    [tokenUrl("TOKEN-1")]: EMPTY_PAGE
  });
  repo.setHarvestCursor("bnp", "2026-10-16");

  const report = await syncBnp({ ...deps, now: SYNC_NOW });

  assert.deepEqual([...asked.keys()], [windowUrl("2026-10-16", "2026-10-18"), tokenUrl("TOKEN-1")]);
  assert.equal(report!.from, "2026-10-16");
  assert.equal(report!.until, "2026-10-18");
  assert.equal(report!.through, "2026-10-18");
  assert.equal(report!.dryRun, false);
  assert.equal(report!.kept, 2);
  assert.equal(report!.created, 2);
  assert.ok(repo.findBookByKey("isbn:9789727089482"));
  assert.deepEqual(report!.failedWindows, []);
  assert.equal(repo.getHarvestCursor("bnp"), "2026-10-18");
});

test("a quiet day still advances the cursor", async () => {
  const { repo, deps } = harvestSetup({ [windowUrl("2026-10-17", "2026-10-18")]: EMPTY_PAGE });
  repo.setHarvestCursor("bnp", "2026-10-17");

  const report = await syncBnp({ ...deps, now: SYNC_NOW });

  assert.equal(report!.records, 0);
  assert.equal(report!.through, "2026-10-18");
  assert.equal(repo.getHarvestCursor("bnp"), "2026-10-18");
});

test("a failed sync window leaves the cursor where it was", async () => {
  const { repo, asked, deps } = harvestSetup({ [windowUrl("2026-10-16", "2026-10-18")]: [unavailable(), unavailable()] });
  repo.setHarvestCursor("bnp", "2026-10-16");

  const report = await syncBnp({ ...deps, now: SYNC_NOW });

  assert.deepEqual(report!.failedWindows, ["2026-10-16..2026-10-18"]);
  assert.equal(report!.through, null);
  assert.equal(asked.get(windowUrl("2026-10-16", "2026-10-18")), 4);
  assert.equal(repo.getHarvestCursor("bnp"), "2026-10-16");
});

test("records that need no scan still let the event loop run between them", async () => {
  const count = 20;
  const { events, deps } = harvestSetup({
    [windowUrl("2026-10-16", "2026-10-16")]: oaiPage(Array.from({ length: count }, (_, index) => recordOf(isbnN(index + 1))))
  });
  await importBnp(deps, run("2026-10-16", "2026-10-16"));
  assert.equal(events.filter((event) => event === "scan").length, count);

  const order: string[] = [];
  setImmediate(() => order.push("macrotask"));
  const report = await importBnp(deps, run("2026-10-16", "2026-10-16"));
  order.push("done");

  assert.equal(events.filter((event) => event === "scan").length, count);
  assert.deepEqual(report.covers, { stored: 0, kept: count, noScan: 0, rejected: 0, failed: 0 });
  assert.deepEqual(order, ["macrotask", "done"]);
});

async function syncLogs(reply: Reply | Reply[]) {
  const { repo, deps } = harvestSetup({ [windowUrl("2026-10-17", "2026-10-18")]: reply });
  repo.setHarvestCursor("bnp", "2026-10-17");
  const report = (await syncBnp({ ...deps, now: SYNC_NOW }))!;
  const lines: Array<[string, object, string]> = [];
  logBnpSync({ info: (details, message) => lines.push(["info", details, message]), error: (details, message) => lines.push(["error", details, message]) }, report);
  return lines;
}

test("a clean sync is logged at info", async () => {
  assert.deepEqual(await syncLogs(EMPTY_PAGE), [["info", { through: "2026-10-18", kept: 0, created: 0, failedWindows: [] }, "bnp sync"]]);
});

test("a sync with a failed window is logged as an error", async () => {
  assert.deepEqual(await syncLogs([unavailable(), unavailable()]), [["error", { through: null, kept: 0, created: 0, failedWindows: ["2026-10-17..2026-10-18"] }, "bnp sync failed windows"]]);
});

const lookupUrl = (isbn: string) => `${BNP_ISBN_URL}${isbn}`;
const urnWithout = (...tags: string[]) => tags.reduce((xml, tag) => xml.replace(new RegExp(`<datafield [^>]*tag="${tag}">.*?</datafield>`, "g"), ""), fixture("urn-9789720044457.xml"));

test("a Portugal ISBN lookup saves the record with its scan under the asked ISBN", async () => {
  const { repo, deps } = harvestSetup({ [lookupUrl(PORTUGUESE)]: fixture("urn-9789720044457.xml") });

  const book = await lookupBnpIsbn(deps, PORTUGUESE);

  assert.equal(book!.isbn, PORTUGUESE);
  assert.equal(book!.created_by, "bnp");
  assert.equal(book!.cover_status, "good");
  assert.equal(repo.getImage(book!.cover_image_id!)!.source, "bnp");
  assert.equal(repo.findBookByKey(`isbn:${PORTUGUESE}`)!.id, book!.id);
});

test("a lookup keeps a textbook and a record with no person", async () => {
  const xml = urnWithout("700", "702").replace('821.134.2(83)-31"19/20"', "373.3(075)");
  const { deps } = harvestSetup({ [lookupUrl(PORTUGUESE)]: xml });

  const book = await lookupBnpIsbn(deps, PORTUGUESE);

  assert.equal(book!.title, "A casa dos espíritos");
  assert.equal(book!.author, "");
  assert.equal(book!.created_by, "bnp");
});

test("a lookup miss returns null and saves nothing", async () => {
  const { db, deps } = harvestSetup({ [lookupUrl(PORTUGUESE)]: fixture("urn-missing.xml") });

  assert.equal(await lookupBnpIsbn(deps, PORTUGUESE), null);
  assert.equal(bookCount(db), 0);
});

test("a lookup answered with a server error is reported as unavailable", async () => {
  const { db, deps } = harvestSetup({ [lookupUrl(PORTUGUESE)]: { status: 503, text: "" } });

  await assert.rejects(lookupBnpIsbn(deps, PORTUGUESE), (error) => error instanceof SourceUnavailableError && error.source === "urn.porbase.org");
  assert.equal(bookCount(db), 0);
});

test("a lookup answered with an empty collection is a miss", async () => {
  for (const reply of ['<collection xmlns="info:lc/xmlns/marcxchange-v2"/>', '<?xml version="1.0"?><collection xmlns="info:lc/xmlns/marcxchange-v2"></collection>']) {
    const { deps } = harvestSetup({ [lookupUrl(PORTUGUESE)]: reply });
    assert.equal(await lookupBnpIsbn(deps, PORTUGUESE), null);
  }
});

test("a lookup answered with anything but a record or a known miss is reported as unavailable", async () => {
  for (const reply of ["<html><body>Em manutenção</body></html>", "", "<urn-response><error>Erro interno</error></urn-response>"]) {
    const { db, deps } = harvestSetup({ [lookupUrl(PORTUGUESE)]: reply });
    await assert.rejects(lookupBnpIsbn(deps, PORTUGUESE), (error) => error instanceof SourceUnavailableError && error.source === "urn.porbase.org");
    assert.equal(bookCount(db), 0);
  }
});
