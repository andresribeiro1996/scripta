import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { OpenLibraryWork } from "../adapters/openlibrary/openLibraryCatalog.js";

const scratch = mkdtempSync(join(tmpdir(), "originals-fill-test-"));
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
const { fillOriginals, pickOriginal } = await import("./originalsFill.js");

type Repo = ReturnType<typeof createSqliteBooksRepository>;
const AT = "2026-10-15T12:00:00.000Z";
const NOW = Date.parse("2026-10-16T12:00:00.000Z");
const LIVE = { dryRun: false };
const DRY = { dryRun: true };

function freshRepo(): Repo {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  return createSqliteBooksRepository(db);
}

let serial = 0;
const isbn = () => `97800${String(++serial).padStart(8, "0")}`;

type Fields = { title: string; author: string; workKey?: string; language?: string; summary?: string; originalTitle?: string; year?: number };
function edition(repo: Repo, isbn: string, fields: Fields) {
  const book = repo.createBook({ title: fields.title, author: fields.author, isbn, workKey: fields.workKey, year: fields.year }, [`isbn:${isbn}`], AT);
  if (fields.language) repo.setLanguage(book.id, fields.language);
  if (fields.summary) repo.mergeDetails(book.id, { summary: fields.summary, pages: null, year: null, publisher: null, translator: null }, "publisher");
  if (fields.originalTitle) repo.fillOriginalTitle(book.id, fields.originalTitle);
  return repo.getBook(book.id)!;
}

const portuguese = (repo: Repo, title: string, author: string, originalTitle: string | undefined, workKey?: string) => edition(repo, isbn(), { title, author, language: "pt-PT", originalTitle, workKey });
const workOf = (title: string, author: string, key: string): OpenLibraryWork => ({ key: `/works/${key}`, title, authors: [author] });
const lighthouse = [workOf("To the Lighthouse", "Virginia Woolf", "OL930W")];
const lighthouseKey = catalogTitleKey("To the Lighthouse", "Virginia Woolf")!;

function setup(repo: Repo, answers: Record<string, OpenLibraryWork[] | Error>, before: () => void = () => {}) {
  const calls: Array<[string, string]> = [];
  const logged: string[] = [];
  const deps = {
    repo,
    classify: async () => {
      throw new Error("no Jev");
    },
    sharesArena: () => false,
    now: () => NOW,
    alert: () => {},
    log: (line: string) => {
      logged.push(line);
    },
    search: async (title: string, author: string) => {
      calls.push([title, author]);
      before();
      const answer = answers[title] ?? [];
      if (answer instanceof Error) throw answer;
      return answer;
    }
  };
  return { deps, calls, logged };
}

test("a held translation whose original is missing gets it from Open Library, and the code step joins them", async () => {
  const repo = freshRepo();
  const pt = portuguese(repo, "Passeio ao Farol", "Virginia Woolf", "To the Lighthouse");
  const { deps, calls } = setup(repo, { "To the Lighthouse": lighthouse });
  const report = await fillOriginals(deps, [pt.work_id!], LIVE);
  assert.deepEqual(calls, [["To the Lighthouse", "virginia woolf"]]);
  assert.deepEqual([report.held, report.selected, report.lookups, report.found, report.added, report.codeMerges], [1, 1, 1, 1, 1, 1]);
  const added = repo.findBookByKey(lighthouseKey)!;
  assert.deepEqual([added.isbn, added.language, added.created_by, added.ol_work_key], [null, null, "seed", "OL930W"]);
  assert.equal(repo.canonicalWorkIds([pt.work_id!]).get(pt.work_id!), added.work_id);
  assert.deepEqual(report.originals, [{ originalTitle: "To the Lighthouse", author: "virginia woolf", works: [{ workId: pt.work_id, title: "Passeio ao Farol" }], found: { key: "/works/OL930W", title: "To the Lighthouse", author: "Virginia Woolf" } }]);
});

test("a dry run makes the lookups and writes nothing", async () => {
  const repo = freshRepo();
  const pt = portuguese(repo, "Passeio ao Farol", "Virginia Woolf", "To the Lighthouse");
  const { deps, calls } = setup(repo, { "To the Lighthouse": lighthouse });
  const report = await fillOriginals(deps, [pt.work_id!], DRY);
  assert.equal(calls.length, 1);
  assert.deepEqual(report.originals[0]!.found, { key: "/works/OL930W", title: "To the Lighthouse", author: "Virginia Woolf" });
  assert.deepEqual([report.found, report.added, report.existing, report.codeMerges], [1, 0, 0, 0]);
  assert.equal(repo.findBookByKey(lighthouseKey), undefined);
  assert.equal(repo.canonicalWorkIds([pt.work_id!]).get(pt.work_id!), pt.work_id);
});

test("an original that names a series is skipped before any lookup", async () => {
  const repo = freshRepo();
  const first = portuguese(repo, "A Princesa Poppy e o Pónei", "Janey Louise Jones", "Princess Poppy");
  portuguese(repo, "A Princesa Poppy e o Bolo", "Janey Louise Jones", "Princess Poppy");
  portuguese(repo, "A Princesa Poppy e a Festa", "Janey Louise Jones", "Princess Poppy");
  const { deps, calls } = setup(repo, { "Princess Poppy": [workOf("Princess Poppy", "Janey Louise Jones", "OL1W")] });
  const report = await fillOriginals(deps, [first.work_id!], LIVE);
  assert.deepEqual([report.seriesLike, report.lookups, report.added], [1, 0, 0]);
  assert.equal(calls.length, 0);
});

test("a volume title is skipped before any lookup, whether the volume is in the edition or the original", async () => {
  const repo = freshRepo();
  const pillars = portuguese(repo, "Os Pilares da Terra, Vol. 1", "Ken Follett", "The Pillars of the Earth");
  const meeting = portuguese(repo, "O Encontro", "Ken Follett", "The Meeting, Book 2");
  const { deps, calls } = setup(repo, {});
  const report = await fillOriginals(deps, [pillars.work_id!, meeting.work_id!], LIVE);
  assert.deepEqual([report.volume, report.lookups], [2, 0]);
  assert.equal(calls.length, 0);
});

test("an original already in the catalog is not looked up", async () => {
  const repo = freshRepo();
  edition(repo, isbn(), { title: "To the Lighthouse", author: "Virginia Woolf", workKey: "OL930W" });
  const pt = portuguese(repo, "Passeio ao Farol", "Virginia Woolf", "To the Lighthouse");
  const { deps, calls } = setup(repo, { "To the Lighthouse": lighthouse });
  const report = await fillOriginals(deps, [pt.work_id!], DRY);
  assert.deepEqual([report.present, report.lookups], [1, 0]);
  assert.equal(calls.length, 0);
});

test("an owner's answer is final, and a code answer is reopened and joined", async () => {
  const repo = freshRepo();
  const owned = portuguese(repo, "A Viagem", "Virginia Woolf", "The Voyage Out");
  const coded = portuguese(repo, "Passeio ao Farol", "Virginia Woolf", "To the Lighthouse");
  repo.saveWorkMatchJudgment(owned.work_id!, { model: "manual", intoWorkId: null, confidence: null, askedAt: AT });
  repo.saveWorkMatchJudgment(coded.work_id!, { model: "code", intoWorkId: null, confidence: null, askedAt: AT });
  const { deps, calls } = setup(repo, { "To the Lighthouse": lighthouse, "The Voyage Out": [workOf("The Voyage Out", "Virginia Woolf", "OL2W")] });
  const report = await fillOriginals(deps, [owned.work_id!, coded.work_id!], LIVE);
  assert.deepEqual([report.held, report.selected], [2, 1]);
  assert.deepEqual(calls, [["To the Lighthouse", "virginia woolf"]]);
  assert.equal(repo.workMatchJudgments([coded.work_id!]).get(coded.work_id!)!.intoWorkId, repo.findBookByKey(lighthouseKey)!.work_id);
  assert.equal(repo.workMatchJudgments([owned.work_id!]).get(owned.work_id!)!.model, "manual");
  assert.equal(repo.canonicalWorkIds([owned.work_id!]).get(owned.work_id!), owned.work_id);
});

test("a work that is not on a shelf is not selected", async () => {
  const repo = freshRepo();
  const held = portuguese(repo, "Passeio ao Farol", "Virginia Woolf", "To the Lighthouse");
  portuguese(repo, "A Viagem", "Virginia Woolf", "The Voyage Out");
  const { deps, calls } = setup(repo, { "To the Lighthouse": lighthouse });
  const report = await fillOriginals(deps, [held.work_id!], DRY);
  assert.deepEqual([report.selected, report.lookups], [1, 1]);
  assert.deepEqual(calls, [["To the Lighthouse", "virginia woolf"]]);
});

test("the first Open Library work with the whole title, no volume marker and an author the translation names is the original", async () => {
  const repo = freshRepo();
  const pt = portuguese(repo, "Passeio ao Farol", "Virginia Woolf", "To the Lighthouse");
  const wrong = [
    workOf("Orlando", "Virginia Woolf", "OL3W"),
    workOf("To the Lighthouse", "Leonard Woolfe", "OL4W"),
    workOf("To the Lighthouse (Book 1)", "Virginia Woolf", "OL5W"),
    workOf("To the Lighthouse - A Novel", "Virginia Woolf", "OL6W")
  ];
  const missed = await fillOriginals(setup(repo, { "To the Lighthouse": wrong }).deps, [pt.work_id!], LIVE);
  assert.deepEqual([missed.found, missed.notFound, missed.added], [0, 1, 0]);
  assert.equal(missed.originals[0]!.found, null);
  const { deps } = setup(repo, { "To the Lighthouse": [...wrong, workOf("To the Lighthouse", "Virginia Woolf", "OL930W")] });
  const report = await fillOriginals(deps, [pt.work_id!], DRY);
  assert.equal(report.originals[0]!.found!.key, "/works/OL930W");
});

test("two copies of one translation share one lookup and both join the original", async () => {
  const repo = freshRepo();
  const one = portuguese(repo, "Passeio ao Farol", "Virginia Woolf", "To the Lighthouse", "OL952W");
  const two = portuguese(repo, "Passeio ao Farol", "Virginia Woolf", "To the Lighthouse", "OL953W");
  assert.notEqual(one.work_id, two.work_id);
  const { deps, calls } = setup(repo, { "To the Lighthouse": lighthouse });
  const report = await fillOriginals(deps, [one.work_id!, two.work_id!], LIVE);
  assert.deepEqual([report.lookups, report.codeMerges], [1, 2]);
  assert.equal(calls.length, 1);
  const into = repo.findBookByKey(lighthouseKey)!.work_id;
  assert.deepEqual([one, two].map((pt) => repo.canonicalWorkIds([pt.work_id!]).get(pt.work_id!)), [into, into]);
});

test("two shelved books with different titles naming one original are left alone", async () => {
  const repo = freshRepo();
  const first = portuguese(repo, "Passeio ao Farol", "Virginia Woolf", "To the Lighthouse");
  const second = portuguese(repo, "Rumo ao Farol", "Virginia Woolf", "To the Lighthouse");
  const { deps, calls } = setup(repo, { "To the Lighthouse": lighthouse });
  const report = await fillOriginals(deps, [first.work_id!, second.work_id!], LIVE);
  assert.deepEqual([report.sharedOriginal, report.lookups], [2, 0]);
  assert.equal(calls.length, 0);
});

test("a lookup that is unavailable is listed and the run goes on, but a rate limit stops it", async () => {
  const repo = freshRepo();
  const lighthousePt = portuguese(repo, "Passeio ao Farol", "Virginia Woolf", "To the Lighthouse");
  const orlando = portuguese(repo, "Orlando, Uma Biografia", "Virginia Woolf", "Orlando");
  const waves = portuguese(repo, "As Ondas", "Virginia Woolf", "The Waves");
  const held = [lighthousePt.work_id!, orlando.work_id!, waves.work_id!];
  const answers = {
    "To the Lighthouse": new SourceUnavailableError("openlibrary", "503", { status: 503 }),
    "Orlando": new SourceUnavailableError("openlibrary", "timeout"),
    "The Waves": [workOf("The Waves", "Virginia Woolf", "OL7W")]
  };
  const report = await fillOriginals(setup(repo, answers).deps, held, LIVE);
  assert.deepEqual(report.failed, ["To the Lighthouse", "Orlando"]);
  assert.deepEqual([report.lookups, report.found, report.notFound, report.added, report.codeMerges], [3, 1, 0, 1, 1]);
  assert.deepEqual(report.originals.map((original) => original.found?.key ?? null), [null, null, "/works/OL7W"]);
  const limited = { "To the Lighthouse": new SourceUnavailableError("openlibrary", "429", { status: 429 }) };
  await assert.rejects(fillOriginals(setup(repo, limited).deps, held, DRY), (error: unknown) => error instanceof SourceUnavailableError && error.status === 429);
});

test("works with no usable original or no author are counted and never looked up", async () => {
  const repo = freshRepo();
  const none = portuguese(repo, "Livro Um", "Autor Um", undefined);
  const colon = portuguese(repo, "Livro Dois", "Autor Dois", ":");
  const own = portuguese(repo, "Memorial do Convento", "José Saramago", "Memorial do Convento");
  const anonymous = portuguese(repo, "Sem Autor", "", "No Author Book");
  const { deps, calls } = setup(repo, {});
  const report = await fillOriginals(deps, [none, colon, own, anonymous].map((pt) => pt.work_id!), LIVE);
  assert.deepEqual([report.noOriginal, report.noAuthor, report.lookups], [3, 1, 0]);
  assert.equal(calls.length, 0);
});

test("a re-run joins a work whose original reached the catalog after its old answer, and a dry run joins nothing", async () => {
  const repo = freshRepo();
  const en = edition(repo, isbn(), { title: "To the Lighthouse", author: "Virginia Woolf", workKey: "OL930W" });
  const pt = portuguese(repo, "Passeio ao Farol", "Virginia Woolf", "To the Lighthouse");
  repo.saveWorkMatchJudgment(pt.work_id!, { model: "code", intoWorkId: null, confidence: null, askedAt: AT });
  const { deps, calls } = setup(repo, { "To the Lighthouse": lighthouse });
  const dry = await fillOriginals(deps, [pt.work_id!], DRY);
  assert.deepEqual([dry.present, dry.codeMerges], [1, 0]);
  assert.equal(repo.canonicalWorkIds([pt.work_id!]).get(pt.work_id!), pt.work_id);
  const report = await fillOriginals(deps, [pt.work_id!], LIVE);
  assert.deepEqual([report.present, report.lookups, report.codeMerges], [1, 0, 1]);
  assert.equal(calls.length, 0);
  assert.equal(repo.canonicalWorkIds([pt.work_id!]).get(pt.work_id!), en.work_id);
});

test("an original the server added during the lookup is reused, and still joined", async () => {
  const repo = freshRepo();
  const pt = portuguese(repo, "Passeio ao Farol", "Virginia Woolf", "To the Lighthouse");
  const server = () => {
    repo.createBook({ title: "To the Lighthouse", author: "Virginia Woolf", isbn: null }, [lighthouseKey], AT);
  };
  const { deps } = setup(repo, { "To the Lighthouse": lighthouse }, server);
  const report = await fillOriginals(deps, [pt.work_id!], LIVE);
  assert.deepEqual([report.existing, report.added, report.codeMerges], [1, 0, 1]);
  assert.equal(repo.canonicalWorkIds([pt.work_id!]).get(pt.work_id!), repo.findBookByKey(lighthouseKey)!.work_id);
});

test("an original that belongs to the translation's own Open Library work lands inside it", async () => {
  const repo = freshRepo();
  const pt = portuguese(repo, "Passeio ao Farol", "Virginia Woolf", "To the Lighthouse", "OL930W");
  const { deps } = setup(repo, { "To the Lighthouse": lighthouse });
  const report = await fillOriginals(deps, [pt.work_id!], LIVE);
  assert.deepEqual([report.added, report.codeMerges, report.noCandidates], [1, 0, 1]);
  assert.equal(repo.findBookByKey(lighthouseKey)!.work_id, pt.work_id);
});

test("progress is logged every ten lookups", async () => {
  const repo = freshRepo();
  const titles = Array.from({ length: 10 }, (_, n) => `Original ${String.fromCharCode(97 + n)}`);
  const held = titles.map((title, n) => portuguese(repo, `Traduzido ${String.fromCharCode(97 + n)}`, "Virginia Woolf", title).work_id!);
  const { deps, logged } = setup(repo, {});
  await fillOriginals(deps, held, DRY);
  assert.deepEqual(logged.map((line) => JSON.parse(line)), [{ looked: 10, of: 10, found: 0 }]);
});

test("pickOriginal needs a surname the translation mentions and the whole title", () => {
  assert.equal(pickOriginal([{ key: "/works/OL8W", title: "Anonymous", authors: ["Anonymous"] }], "Anonymous", ["Autor Desconhecido"]), null);
  assert.equal(pickOriginal([workOf("Mrs. Dalloway's Party", "Virginia Woolf", "OL9W")], "Mrs. Dalloway", ["Virginia Woolf"]), null);
  assert.deepEqual(pickOriginal([{ key: "/works/OL10W", title: "Orlando", authors: [] }, workOf("Orlando", "V. Woolf", "OL11W")], "Orlando: A Biography", ["Virginia Woolf"]), { key: "/works/OL11W", title: "Orlando", author: "V. Woolf" });
});
