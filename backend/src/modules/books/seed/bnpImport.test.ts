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
import type { BnpCoverAction, BnpDeps, BnpReplace } from "./bnpImport.js";

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
const { applyBnpRecord, fetchBnpScan, planBnpRecord } = await import("./bnpImport.js");
const { mapBnpRecord, readMarcRecords } = await import("./bnpRecord.js");

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
