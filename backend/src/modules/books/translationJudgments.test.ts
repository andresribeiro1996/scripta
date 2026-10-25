import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "translation-judgments-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("./adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("./adapters/sqlite/sqliteBooksRepository.js");
const { arenaCheck, guardJoin, judgeWorkMatch, matchWork, planMatch, startTranslationJobs } = await import("./translationJudgments.js");
const { translationReviewWith } = await import("./translationReview.js");
const { seriesLikeOriginals } = await import("./domain/translation.js");
const { SourceUnavailableError, UnusableAnswerError } = await import("./domain/errors.js");

type Repo = ReturnType<typeof createSqliteBooksRepository>;
const AT = "2026-10-15T12:00:00.000Z";
const notSeries = () => false;
const flush = async () => {
  for (let tick = 0; tick < 10; tick++) await new Promise(setImmediate);
};

function freshRepo(): Repo {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  return createSqliteBooksRepository(db);
}

type Fields = { title: string; author: string; workKey?: string; language?: string; summary?: string; originalTitle?: string; year?: number };
function edition(repo: Repo, isbn: string, fields: Fields) {
  const book = repo.createBook({ title: fields.title, author: fields.author, isbn, workKey: fields.workKey, year: fields.year }, [`isbn:${isbn}`], AT);
  if (fields.language) repo.setLanguage(book.id, fields.language);
  if (fields.summary) repo.mergeDetails(book.id, { summary: fields.summary, pages: null, year: null, publisher: null, translator: null }, "publisher");
  if (fields.originalTitle) repo.fillOriginalTitle(book.id, fields.originalTitle);
  return repo.getBook(book.id)!;
}

test("a work whose original title is its own title is a Portuguese original", () => {
  const repo = freshRepo();
  const pt = edition(repo, "9789720000401", { title: "Memorial do Convento", author: "José Saramago", language: "pt-PT", originalTitle: "Memorial do Convento" });
  assert.deepEqual(planMatch(repo, pt.work_id!, notSeries), { kind: "original" });
});

test("one title match whose author's surname the work names is settled by code", () => {
  const repo = freshRepo();
  const en = edition(repo, "9780156907401", { title: "To the Lighthouse", author: "Virginia Woolf", workKey: "OL930W" });
  const pt = edition(repo, "9789720000402", { title: "Passeio ao Farol", author: "V. Woolf", language: "pt-PT", originalTitle: "To the Lighthouse" });
  assert.deepEqual(planMatch(repo, pt.work_id!, notSeries), { kind: "code", intoWorkId: en.work_id });
});

test("a title match the work can't vouch for goes to Jev, another author's same-titled book doesn't stop code, and two works of the author with that title go to Jev", () => {
  const repo = freshRepo();
  const en = edition(repo, "9780156907402", { title: "To the Lighthouse", author: "Virginia Woolf", workKey: "OL931W", year: 1927 });
  const pt = edition(repo, "9789720000403", { title: "Passeio ao Farol", author: "", language: "pt-PT", originalTitle: "To the Lighthouse", summary: "Uma família, uma casa, um farol ao longe e dez anos de distância." });
  const plan = planMatch(repo, pt.work_id!, notSeries);
  assert.equal(plan?.kind, "ask");
  assert.deepEqual(plan?.kind === "ask" ? plan.candidates : null, [{ id: en.work_id, title: "To the Lighthouse", author: "Virginia Woolf", year: 1927 }]);

  edition(repo, "9780000000404", { title: "Poems", author: "Emily Dickinson", workKey: "OL932W" });
  const keats = edition(repo, "9780000000405", { title: "Poems", author: "John Keats", workKey: "OL933W" });
  const poems = edition(repo, "9789720000406", { title: "Poemas", author: "John Keats", language: "pt-PT", originalTitle: "Poems" });
  assert.deepEqual(planMatch(repo, poems.work_id!, notSeries), { kind: "code", intoWorkId: keats.work_id });

  const other = freshRepo();
  const first = edition(other, "9780000000410", { title: "Poems", author: "John Keats", workKey: "OL933W" });
  const second = edition(other, "9780000000411", { title: "Poems", author: "John Keats", workKey: "OL934W" });
  const translated = edition(other, "9789720000412", { title: "Poemas", author: "John Keats", language: "pt-PT", originalTitle: "Poems" });
  const both = planMatch(other, translated.work_id!, notSeries);
  assert.equal(both?.kind, "ask");
  assert.deepEqual(both?.kind === "ask" ? both.candidates.map((candidate) => candidate.id).sort() : null, [first.work_id, second.work_id].sort());
});

test("a subtitle on either side leaves the match to Jev", () => {
  const cases = [
    { english: "Dune", author: "Frank Herbert", portuguese: "O Messias de Duna", original: "Dune: Messiah", language: undefined },
    { english: "The Road", author: "Cormac McCarthy", portuguese: "A Estrada", original: "The Road — A Novel", language: undefined },
    { english: "Fairy Oak: Il segreto delle gemelle", author: "Elisabetta Gnone", portuguese: "Capitão Grisam", original: "Fairy Oak", language: "it" }
  ];
  for (const [index, { english, author, portuguese, original, language }] of cases.entries()) {
    const repo = freshRepo();
    const en = edition(repo, `97800000005${index}0`, { title: english, author, workKey: `OL94${index}W`, language });
    const pt = edition(repo, `97897200005${index}1`, { title: portuguese, author, language: "pt-PT", originalTitle: original });
    const plan = planMatch(repo, pt.work_id!, notSeries);
    assert.equal(plan?.kind, "ask");
    assert.ok(plan?.kind === "ask" && plan.candidates.some((candidate) => candidate.id === en.work_id), english);
  }
});

test("two works carrying the whole title in different punctuation leave the match to Jev", () => {
  const repo = freshRepo();
  const colon = edition(repo, "9780000000620", { title: "Dune: Messiah", author: "Frank Herbert", workKey: "OL951W" });
  const dash = edition(repo, "9780000000621", { title: "Dune — Messiah", author: "Frank Herbert", workKey: "OL952W" });
  const pt = edition(repo, "9789720000622", { title: "O Messias de Duna", author: "Frank Herbert", language: "pt-PT", originalTitle: "Dune: Messiah" });
  const plan = planMatch(repo, pt.work_id!, notSeries);
  assert.equal(plan?.kind, "ask");
  const ids = plan?.kind === "ask" ? plan.candidates.map((candidate) => candidate.id) : [];
  assert.ok(ids.includes(colon.work_id!) && ids.includes(dash.work_id!));
});

test("an original found under its words alone settles in code", () => {
  const repo = freshRepo();
  const words = edition(repo, "9780000000623", { title: "Dune Messiah", author: "Frank Herbert", workKey: "OL953W" });
  const pt = edition(repo, "9789720000624", { title: "O Messias de Duna", author: "Frank Herbert", language: "pt-PT", originalTitle: "Dune: Messiah" });
  assert.deepEqual(planMatch(repo, pt.work_id!, notSeries), { kind: "code", intoWorkId: words.work_id });
});

test("a Portuguese title its original repeats up to a full stop is its own original", () => {
  const repo = freshRepo();
  const maias = edition(repo, "9789720000625", { title: "Os Maias", author: "Eça de Queirós", language: "pt-PT", originalTitle: "Os Maias. Episódios da Vida Romântica" });
  edition(repo, "9789720000626", { title: "Os Maias", author: "Eça de Queirós", language: "pt-PT", workKey: "OL954W" });
  assert.deepEqual(planMatch(repo, maias.work_id!, notSeries), { kind: "original" });
});

test("a work holding two editions that match the original's patterns is one candidate", () => {
  const repo = freshRepo();
  edition(repo, "9788804000011", { title: "Fairy Oak", author: "Elisabetta Gnone", workKey: "OL950W", language: "it" });
  const en = edition(repo, "9788804000012", { title: "Fairy Oak: Il segreto delle gemelle", author: "Elisabetta Gnone", workKey: "OL950W", language: "it" });
  const pt = edition(repo, "9789720000013", { title: "Capitão Grisam", author: "", language: "pt-PT", originalTitle: "Fairy Oak" });
  const plan = planMatch(repo, pt.work_id!, notSeries);
  assert.equal(plan?.kind, "ask");
  assert.deepEqual(plan?.kind === "ask" ? plan.candidates.map((candidate) => candidate.id) : null, [en.work_id]);
});

test("an original with a full stop is found under its whole title", () => {
  const repo = freshRepo();
  const en = edition(repo, "9781501125607", { title: "Mr. Mercedes", author: "Stephen King", workKey: "OL950W" });
  const pt = edition(repo, "9789720000607", { title: "O Senhor Mercedes", author: "Stephen King", language: "pt-PT", originalTitle: "Mr. Mercedes" });
  assert.deepEqual(planMatch(repo, pt.work_id!, notSeries), { kind: "code", intoWorkId: en.work_id });
});

test("bracketed notes don't stop a code join, but a bracketed volume does", () => {
  const repo = freshRepo();
  const en = edition(repo, "9780553103540", { title: "A Game of Thrones (A Song of Ice and Fire, #1)", author: "George R. R. Martin", workKey: "OL960W" });
  const pt = edition(repo, "9789720000608", { title: "A Guerra dos Tronos", author: "George R. R. Martin", language: "pt-PT", originalTitle: "A Game of Thrones" });
  assert.deepEqual(planMatch(repo, pt.work_id!, notSeries), { kind: "code", intoWorkId: en.work_id });

  const other = freshRepo();
  const lighthouse = edition(other, "9780156907609", { title: "To the Lighthouse", author: "Virginia Woolf", workKey: "OL961W" });
  const volume = edition(other, "9789720000609", { title: "Um Farol", author: "Virginia Woolf", language: "pt-PT", originalTitle: "To the Lighthouse (Book 1)" });
  const plan = planMatch(other, volume.work_id!, notSeries);
  assert.equal(plan?.kind, "ask");
  assert.ok(plan?.kind === "ask" && plan.candidates.some((candidate) => candidate.id === lighthouse.work_id));
});

test("the edition's whole title decides, wherever the edition was merged", () => {
  const repo = freshRepo();
  const first = edition(repo, "9789720000610", { title: "Passeio ao Farol", author: "Virginia Woolf", language: "pt-PT", originalTitle: "To the Lighthouse", workKey: "OL940W" });
  const original = edition(repo, "9780156907610", { title: "To the Lighthouse", author: "Virginia Woolf", workKey: "OL940W" });
  assert.equal(original.work_id, first.work_id);
  const second = edition(repo, "9789720000611", { title: "Rumo ao Farol", author: "Virginia Woolf", language: "pt-PT", originalTitle: "To the Lighthouse" });
  assert.deepEqual(planMatch(repo, second.work_id!, notSeries), { kind: "code", intoWorkId: first.work_id });
});

test("a candidate whose author has no usable surname is not vouched for", () => {
  const repo = freshRepo();
  const en = edition(repo, "9780000000612", { title: "Orlando", author: "Li Bo", workKey: "OL970W" });
  const pt = edition(repo, "9789720000613", { title: "Orlando, Uma Biografia", author: "Li Bo", language: "pt-PT", originalTitle: "Orlando" });
  const plan = planMatch(repo, pt.work_id!, notSeries);
  assert.equal(plan?.kind, "ask");
  assert.ok(plan?.kind === "ask" && plan.candidates.some((candidate) => candidate.id === en.work_id));
});

test("with no original title, the author's works with a non-Portuguese edition are the candidates, most editions first", () => {
  const repo = freshRepo();
  const idiot = edition(repo, "9780000000407", { title: "The Idiot", author: "Fyodor Dostoevsky", workKey: "OL934W" });
  edition(repo, "9780000000408", { title: "The Idiot", author: "Fyodor Dostoevsky", workKey: "OL934W" });
  const crime = edition(repo, "9780000000409", { title: "Crime and Punishment", author: "Fyodor Dostoevsky", workKey: "OL935W" });
  edition(repo, "9789720000410", { title: "Os Irmãos Karamázov", author: "Fyodor Dostoevsky", language: "pt-PT" });
  const pt = edition(repo, "9789720000411", { title: "O Idiota", author: "Fyodor Dostoevsky", language: "pt-PT" });
  const plan = planMatch(repo, pt.work_id!, notSeries);
  assert.deepEqual(plan?.kind === "ask" ? plan.candidates.map((candidate) => candidate.id) : plan, [idiot.work_id, crime.work_id]);
});

test("no original title and no author leaves nothing to ask", () => {
  const repo = freshRepo();
  const pt = edition(repo, "9789720000412", { title: "Livro Sem Autor", author: "", language: "pt-PT" });
  assert.deepEqual(planMatch(repo, pt.work_id!, notSeries), { kind: "none" });
});

test("only live, all-Portuguese, unjudged works under the strike limit need a match", () => {
  const repo = freshRepo();
  const pt = edition(repo, "9789720000413", { title: "Um", author: "A", language: "pt-PT" });
  const mixed = edition(repo, "9789720000414", { title: "Dois", author: "A", language: "pt-PT", workKey: "OL936W" });
  edition(repo, "9780000000415", { title: "Two", author: "A", workKey: "OL936W" });
  const judged = edition(repo, "9789720000416", { title: "Três", author: "A", language: "pt-BR" });
  const struck = edition(repo, "9789720000417", { title: "Quatro", author: "A", language: "pt" });
  const old = edition(repo, "9789720000418", { title: "Cinco", author: "A", language: "pt-PT" });
  repo.saveWorkMatchJudgment(judged.work_id!, { model: "code", intoWorkId: null, confidence: null, askedAt: AT });
  repo.saveWorkMatchJudgment(old.work_id!, { model: "jev-1.13.0", intoWorkId: null, confidence: 0.8, askedAt: "2026-08-01T00:00:00.000Z" });
  for (let n = 0; n < 3; n++) repo.recordJevRejection({ task: "works", subject: struck.work_id!, status: 400, reason: "HTTP 400", at: AT });
  assert.deepEqual(repo.portugueseWorksNeedingMatch(null, 10, 3, null), [pt.work_id]);
  assert.deepEqual(repo.portugueseWorksNeedingMatch(null, 10, 3, "2026-09-15T00:00:00.000Z").sort(), [pt.work_id, old.work_id].sort());
  assert.deepEqual(repo.portugueseWorksNeedingMatch([mixed.work_id!, pt.work_id!], 10, 3, null), [pt.work_id]);
  assert.deepEqual(repo.workMatchJudgments([judged.work_id!]).get(judged.work_id!), { model: "code", intoWorkId: null, confidence: null, askedAt: AT });
});

const NOW = Date.parse(AT);
function matching(repo: Repo, answer: () => Promise<{ choice: number | null; confidence: number; model: string }>, blocked = false) {
  const asked: Array<{ candidates: Array<{ title: string }> }> = [];
  const alerts: string[] = [];
  const deps = {
    repo,
    classify: async (input: { candidates: Array<{ title: string; author: string; year: number | null }> }) => {
      asked.push(input);
      return answer();
    },
    sharesArena: () => blocked,
    now: () => NOW,
    alert: (subject: string) => { alerts.push(subject); }
  };
  return { deps, asked, alerts };
}

function lighthouse(repo: Repo, ptAuthor: string) {
  const en = edition(repo, "9780156907450", { title: "To the Lighthouse", author: "Virginia Woolf", workKey: "OL950W" });
  const orlando = edition(repo, "9780156907451", { title: "Orlando", author: "Virginia Woolf", workKey: "OL951W" });
  const pt = edition(repo, "9789720000450", { title: "Passeio ao Farol", author: ptAuthor, language: "pt-PT", originalTitle: "To the Lighthouse", workKey: "OL952W" });
  return { en, orlando, pt };
}

test("a code match merges without asking Jev, and is recorded as code", async () => {
  const repo = freshRepo();
  const { en, pt } = lighthouse(repo, "Virginia Woolf");
  const { deps, asked } = matching(repo, async () => ({ choice: 0, confidence: 1, model: "jev-1.13.0" }));
  assert.equal(await matchWork(deps, pt.work_id!, notSeries), null);
  assert.equal(asked.length, 0);
  assert.equal(repo.getBook(pt.id)!.work_id, en.work_id);
  assert.deepEqual(repo.workMatchJudgments([pt.work_id!]).get(pt.work_id!), { model: "code", intoWorkId: en.work_id, confidence: null, askedAt: AT });
});

test("an arena holding both works blocks the merge but keeps the decision", async () => {
  const repo = freshRepo();
  const { en, pt } = lighthouse(repo, "Virginia Woolf");
  const { deps } = matching(repo, async () => ({ choice: 0, confidence: 1, model: "jev-1.13.0" }), true);
  await matchWork(deps, pt.work_id!, notSeries);
  assert.equal(repo.getBook(pt.id)!.work_id, pt.work_id);
  assert.equal(repo.workMatchJudgments([pt.work_id!]).get(pt.work_id!)?.intoWorkId, en.work_id);
});

test("Jev merges at 0.9, stores a doubt below it, and stores none as no work", async () => {
  const high = freshRepo();
  const sure = lighthouse(high, "");
  const { deps, asked } = matching(high, async () => ({ choice: asked[0]!.candidates.findIndex((candidate) => candidate.title === "To the Lighthouse"), confidence: 0.93, model: "jev-1.13.0" }));
  await matchWork(deps, sure.pt.work_id!, notSeries);
  assert.equal(high.getBook(sure.pt.id)!.work_id, sure.en.work_id);

  const mid = freshRepo();
  const doubt = lighthouse(mid, "");
  await matchWork(matching(mid, async () => ({ choice: 0, confidence: 0.74, model: "jev-1.13.0" })).deps, doubt.pt.work_id!, notSeries);
  assert.equal(mid.getBook(doubt.pt.id)!.work_id, doubt.pt.work_id);
  assert.equal(mid.workMatchJudgments([doubt.pt.work_id!]).get(doubt.pt.work_id!)?.confidence, 0.74);

  const none = freshRepo();
  const nothing = lighthouse(none, "");
  await matchWork(matching(none, async () => ({ choice: null, confidence: 0.88, model: "jev-1.13.0" })).deps, nothing.pt.work_id!, notSeries);
  assert.deepEqual(none.workMatchJudgments([nothing.pt.work_id!]).get(nothing.pt.work_id!), { model: "jev-1.13.0", intoWorkId: null, confidence: 0.88, askedAt: AT });
});

test("an unusable answer is a strike under works; a 401 pauses and alerts; nothing is stored", async () => {
  const repo = freshRepo();
  const { pt } = lighthouse(repo, "");
  assert.equal(await matchWork(matching(repo, async () => { throw new UnusableAnswerError("typesafe", "unexpected answer"); }).deps, pt.work_id!, notSeries), null);
  assert.equal(repo.jevRejections("works", [pt.work_id!]).get(pt.work_id!)?.attempts, 1);
  const key = matching(repo, async () => { throw new SourceUnavailableError("typesafe", "HTTP 401", { status: 401 }); });
  assert.equal(await matchWork(key.deps, pt.work_id!, notSeries), NOW + 24 * 60 * 60 * 1000);
  assert.deepEqual(key.alerts, ["TypeSafe rejected the translation requests"]);
  assert.equal(repo.workMatchJudgments([pt.work_id!]).size, 0);
});

test("only a held, Portuguese work that still needs a match is judged, through its canonical id", async () => {
  const repo = freshRepo();
  const { en, pt } = lighthouse(repo, "Virginia Woolf");
  const { deps } = matching(repo, async () => ({ choice: 0, confidence: 1, model: "jev-1.13.0" }));
  assert.equal(await judgeWorkMatch({ ...deps, heldWorkIds: () => [] }, pt.work_id!), null);
  assert.equal(repo.workMatchJudgments([pt.work_id!]).size, 0);
  assert.equal(await judgeWorkMatch({ ...deps, heldWorkIds: () => [en.work_id!] }, en.work_id!), null);
  assert.equal(repo.workMatchJudgments([en.work_id!]).size, 0);
  await judgeWorkMatch({ ...deps, heldWorkIds: () => [pt.work_id!] }, pt.work_id!);
  assert.equal(repo.getBook(pt.id)!.work_id, en.work_id);
});

test("adding a work only queues it; matching happens after the caller returns", async () => {
  const repo = freshRepo();
  const { pt } = lighthouse(repo, "");
  const { deps, asked } = matching(repo, async () => ({ choice: null, confidence: 0.9, model: "jev-1.13.0" }));
  const jobs = startTranslationJobs({ ...deps, heldWorkIds: () => [pt.work_id!], info: () => {}, onError: (error) => { throw error; } });
  jobs.add(pt.work_id!);
  assert.equal(asked.length, 0);
  await flush();
  assert.equal(asked.length, 1);
  jobs.stop();
});

test("the sweep waits for its initial delay before its first pass", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const repo = freshRepo();
  const { deps } = matching(repo, async () => ({ choice: null, confidence: 0.9, model: "jev-1.13.0" }));
  let reads = 0;
  const jobs = startTranslationJobs({ ...deps, heldWorkIds: () => { reads += 1; return []; }, info: () => {}, onError: (error) => { throw error; }, initialDelayMs: 90_000 });
  await flush();
  t.mock.timers.tick(89_999);
  await flush();
  assert.equal(reads, 0);
  t.mock.timers.tick(1);
  await flush();
  assert.equal(reads, 1);
  jobs.stop();
});

test("the arena check looks at each work's live id and all its aliases, however stale the ids it is given", () => {
  const repo = freshRepo();
  const pt = edition(repo, "9789720000460", { title: "O Passeio", author: "Robert Walser", language: "pt-PT" });
  const loose = edition(repo, "9780000000460", { title: "The Walk", author: "Robert Walser" });
  const keyed = edition(repo, "9780000000461", { title: "The Walk", author: "Robert Walser", workKey: "OL991W" });
  repo.mergeWorks(loose.work_id!, keyed.work_id!, AT);
  const seen: Array<[string[], string[]]> = [];
  const shares = arenaCheck(repo, (a, b) => { seen.push([a, b]); return b.includes(keyed.work_id!); });
  assert.equal(shares(pt.work_id!, loose.work_id!), true);
  assert.deepEqual(seen[0]![0], [pt.work_id]);
  assert.deepEqual([...seen[0]![1]].sort(), [keyed.work_id, loose.work_id].sort());
});

test("a queued work stores the original title its summary names before it is matched", async () => {
  const repo = freshRepo();
  const pt = edition(repo, "9789720000470", { title: "Solaris", author: "", language: "pt-PT", summary: "Um planeta oceano e uma estação de investigação.\n\nTítulo original: Solaris" });
  const { deps } = matching(repo, async () => ({ choice: null, confidence: 0.9, model: "jev-1.13.0" }));
  await judgeWorkMatch({ ...deps, heldWorkIds: () => [pt.work_id!] }, pt.work_id!);
  assert.equal(repo.getBook(pt.id)!.original_title, "Solaris");
});

test("a series volume's original title never settles in code on the series' first book", () => {
  const repo = freshRepo();
  const first = edition(repo, "9780062059932", { title: "The Selection", author: "Kiera Cass", workKey: "OL995W" });
  const pt = edition(repo, "9789722349938", { title: "A Elite", author: "", language: "pt-PT", originalTitle: "The Selection: The Elite (Book 2)", summary: "O segundo livro da série de Kiera Cass, com as seis raparigas que restam no palácio." });
  const plan = planMatch(repo, pt.work_id!, notSeries);
  assert.equal(plan?.kind, "ask");
  assert.deepEqual(plan?.kind === "ask" ? plan.candidates.map((candidate) => candidate.id) : null, [first.work_id]);
});

test("filling a book's author reopens its work's code-only no-match verdict, and keeps Jev's and the owner's", () => {
  const repo = freshRepo();
  const byCode = edition(repo, "9789720000419", { title: "Seis", author: "", language: "pt-PT" });
  const byJev = edition(repo, "9789720000420", { title: "Sete", author: "", language: "pt-PT" });
  const byOwner = edition(repo, "9789720000421", { title: "Oito", author: "", language: "pt-PT" });
  repo.saveWorkMatchJudgment(byCode.work_id!, { model: "code", intoWorkId: null, confidence: null, askedAt: AT });
  repo.saveWorkMatchJudgment(byJev.work_id!, { model: "jev-1.13.0", intoWorkId: null, confidence: 0.8, askedAt: AT });
  repo.saveWorkMatchJudgment(byOwner.work_id!, { model: "manual", intoWorkId: null, confidence: null, askedAt: AT });
  assert.deepEqual(repo.portugueseWorksNeedingMatch(null, 10, 3, null), []);

  for (const book of [byCode, byJev, byOwner]) repo.fillIdentity(book.id, book.title, "Alguém Autor");

  assert.deepEqual(repo.portugueseWorksNeedingMatch(null, 10, 3, null), [byCode.work_id]);
  assert.equal(repo.workMatchJudgments([byJev.work_id!]).get(byJev.work_id!)?.model, "jev-1.13.0");
  assert.equal(repo.workMatchJudgments([byOwner.work_id!]).get(byOwner.work_id!)?.model, "manual");
});

function poppy(repo: Repo, volumes = ["A Princesa Poppy e o Piquenique", "A Princesa Poppy e a Festa", "Poppy no Baile"]) {
  const series = edition(repo, "9781408300001", { title: "Princess Poppy", author: "Janey Louise Jones", workKey: "OL970W" });
  const pt = volumes.map((title, n) => edition(repo, `978972000049${n}`, { title, author: "Janey Louise Jones", language: "pt-PT", originalTitle: "Princess Poppy" }));
  return { series, pt };
}

test("a series-like original plans none even with one title match and a matching surname, and the rule is asked about that original and author", () => {
  const repo = freshRepo();
  const en = edition(repo, "9780156907480", { title: "To the Lighthouse", author: "Virginia Woolf", workKey: "OL960W" });
  const pt = edition(repo, "9789720000480", { title: "Passeio ao Farol", author: "Virginia Woolf", language: "pt-PT", originalTitle: "To the Lighthouse" });
  const seen: Array<[string, string]> = [];
  assert.deepEqual(planMatch(repo, pt.work_id!, (original, author) => { seen.push([original, author]); return true; }), { kind: "none" });
  assert.deepEqual(seen, [["To the Lighthouse", "Virginia Woolf"]]);
  assert.deepEqual(planMatch(repo, pt.work_id!, notSeries), { kind: "code", intoWorkId: en.work_id });
});

test("a Portuguese original is never asked about its series", () => {
  const repo = freshRepo();
  const pt = edition(repo, "9789720000481", { title: "Memorial do Convento", author: "José Saramago", language: "pt-PT", originalTitle: "Memorial do Convento" });
  assert.deepEqual(planMatch(repo, pt.work_id!, () => { throw new Error("asked"); }), { kind: "original" });
});

test("an edition whose own title is a volume never settles in code, even on its only title match", () => {
  const repo = freshRepo();
  const fr = edition(repo, "9782203007482", { title: "Alix Senator", author: "Valérie Mangin", workKey: "OL961W" });
  const pt = edition(repo, "9789720000482", { title: "Alix Senator, Vol. 2 – O Último Faraó", author: "Valérie Mangin", language: "pt-PT", originalTitle: "Alix Senator" });
  const plan = planMatch(repo, pt.work_id!, notSeries);
  assert.equal(plan?.kind, "ask");
  assert.deepEqual(plan?.kind === "ask" ? plan.candidates.map((candidate) => candidate.id) : null, [fr.work_id]);
});

test("the rule built from the catalog's claims stops three Portuguese titles on one original and leaves two to code", () => {
  const repo = freshRepo();
  const { pt: volumes } = poppy(repo);
  const lighthouseEn = edition(repo, "9780156907483", { title: "To the Lighthouse", author: "Virginia Woolf", workKey: "OL962W" });
  const farol = edition(repo, "9789720000483", { title: "Passeio ao Farol", author: "Virginia Woolf", language: "pt-PT", originalTitle: "To the Lighthouse" });
  edition(repo, "9789720000484", { title: "Rumo ao Farol", author: "Virginia Woolf", language: "pt-PT", originalTitle: "To the Lighthouse" });
  const isSeriesLike = seriesLikeOriginals(repo.originalTitleClaims());
  for (const volume of volumes) assert.deepEqual(planMatch(repo, volume.work_id!, isSeriesLike), { kind: "none" });
  assert.deepEqual(planMatch(repo, farol.work_id!, isSeriesLike), { kind: "code", intoWorkId: lighthouseEn.work_id });
});

test("the live path joins no volume of a series-named original and asks Jev nothing", async () => {
  const repo = freshRepo();
  const { series, pt } = poppy(repo);
  const { deps, asked } = matching(repo, async () => ({ choice: 0, confidence: 1, model: "jev-1.13.0" }));
  await judgeWorkMatch({ ...deps, heldWorkIds: () => [pt[0]!.work_id!] }, pt[0]!.work_id!);
  assert.equal(asked.length, 0);
  assert.notEqual(repo.getBook(pt[0]!.id)!.work_id, series.work_id);
  assert.deepEqual(repo.workMatchJudgments([pt[0]!.work_id!]).get(pt[0]!.work_id!), { model: "code", intoWorkId: null, confidence: null, askedAt: AT });
});

test("the series rule is built only for a work that is judged, and reused for ten minutes", async () => {
  const repo = freshRepo();
  const works = ["Um", "Dois", "Três"].map((name, n) => edition(repo, `978972000050${n}`, { title: `Livro ${name}`, author: "", language: "pt-PT" }).work_id!);
  let reads = 0;
  const counting = { ...repo, originalTitleClaims: () => { reads += 1; return repo.originalTitleClaims(); } };
  let clock = NOW;
  const held: string[] = [];
  const { deps } = matching(counting, async () => ({ choice: null, confidence: 0.9, model: "jev-1.13.0" }));
  const jobs = startTranslationJobs({ ...deps, now: () => clock, heldWorkIds: () => held, info: () => {}, onError: (error) => { throw error; } });
  const judge = async (workId: string, afterMs: number) => {
    clock += afterMs;
    held.push(workId);
    jobs.add(workId);
    await flush();
    return reads;
  };
  jobs.add(works[0]!);
  await flush();
  assert.equal(reads, 0);
  assert.equal(await judge(works[0]!, 61 * 1000), 1);
  assert.equal(await judge(works[1]!, 61 * 1000), 1);
  assert.equal(await judge(works[2]!, 10 * 60 * 1000), 2);
  jobs.stop();
});

test("four works hitting a rejected key at once send one alert", async () => {
  const repo = freshRepo();
  const titles = ["Alpha", "Bravo", "Charlie", "Delta"];
  const works = titles.map((title, n) => {
    edition(repo, `97801569077${n}0`, { title, author: `Author ${title}`, workKey: `OL97${n}W` });
    return edition(repo, `97897200009${n}0`, { title: `Pt ${title}`, author: "", language: "pt-PT", originalTitle: title, workKey: `OL98${n}W` }).work_id!;
  });
  const key = matching(repo, async () => { throw new SourceUnavailableError("typesafe", "HTTP 401", { status: 401 }); });
  const jobs = startTranslationJobs({ ...key.deps, heldWorkIds: () => works, info: () => {}, onError: (error) => { throw error; } });
  for (const workId of works) jobs.add(workId);
  await flush();
  jobs.stop();
  assert.deepEqual(key.alerts, ["TypeSafe rejected the translation requests"]);
});

function lordOfTheRings(repo: Repo) {
  const lotr = edition(repo, "9780261103252", { title: "The Lord of the Rings", author: "J. R. R. Tolkien", workKey: "OL27448W" });
  const king = edition(repo, "9780261102378", { title: "The Return of the King", author: "J. R. R. Tolkien", workKey: "OL27455W" });
  for (const row of [lotr, king]) repo.addWorkSeries(row.work_id!, [{ name: "The Lord of the Rings", position: null }], "wikidata", AT);
  const pt = edition(repo, "9789720000701", { title: "A Irmandade do Anel", author: "", language: "pt-PT", originalTitle: "The lord of the rings" });
  return { lotr, king, pt };
}

test("Jev answering a series head is stored for review and never merges", async () => {
  const repo = freshRepo();
  const { lotr, pt } = lordOfTheRings(repo);
  const plan = planMatch(repo, pt.work_id!, notSeries);
  const index = plan?.kind === "ask" ? plan.candidates.findIndex((candidate) => candidate.id === lotr.work_id) : -1;
  assert.notEqual(index, -1);
  const { deps } = matching(repo, async () => ({ choice: index, confidence: 0.99, model: "jev-1.13.0" }));
  await matchWork(deps, pt.work_id!, notSeries);
  assert.equal(repo.workMatchJudgments([pt.work_id!]).get(pt.work_id!)?.intoWorkId, lotr.work_id);
  assert.equal(repo.getBook(pt.id)!.work_id, pt.work_id);
  assert.equal(repo.canonicalWorkIds([pt.work_id!]).get(pt.work_id!), pt.work_id);
  assert.deepEqual(repo.portugueseWorksNeedingMatch(null, 10, 3, "2026-11-30T00:00:00.000Z"), []);
});

test("Jev answering the whole of a split volume is stored as no work, and the work is rechecked", async () => {
  const repo = freshRepo();
  const en = edition(repo, "9780140444308", { title: "Les Misérables", author: "Victor Hugo", workKey: "OL5710W" });
  const pt = edition(repo, "9789720000702", { title: "Os Miseráveis I", author: "", language: "pt-PT", originalTitle: "Les Misérables" });
  const { deps } = matching(repo, async () => ({ choice: 0, confidence: 0.99, model: "jev-1.13.0" }));
  await matchWork(deps, pt.work_id!, notSeries);
  assert.equal(repo.getBook(pt.id)!.work_id, pt.work_id);
  assert.equal(repo.workMatchJudgments([pt.work_id!]).get(pt.work_id!)?.intoWorkId, null);
  assert.deepEqual(repo.portugueseWorksNeedingMatch(null, 10, 3, "2026-11-30T00:00:00.000Z"), [pt.work_id]);
  await matchWork(deps, pt.work_id!, notSeries);
  assert.equal(repo.getBook(pt.id)!.work_id, pt.work_id);
  assert.equal(repo.workMatchJudgments([pt.work_id!]).get(pt.work_id!)?.intoWorkId, null);
  assert.notEqual(en.work_id, pt.work_id);
});

test("a medium-confidence answer on the whole of a split volume is neither saved nor listed for review", async () => {
  const repo = freshRepo();
  edition(repo, "9780140444308", { title: "Les Misérables", author: "Victor Hugo", workKey: "OL5710W" });
  const pt = edition(repo, "9789720000702", { title: "Os Miseráveis I", author: "", language: "pt-PT", originalTitle: "Les Misérables" });
  const { deps } = matching(repo, async () => ({ choice: 0, confidence: 0.8, model: "jev-1.13.0" }));
  await matchWork(deps, pt.work_id!, notSeries);
  const judgment = repo.workMatchJudgments([pt.work_id!]).get(pt.work_id!);
  assert.equal(judgment?.intoWorkId, null);
  assert.equal(judgment?.confidence, 0.8);
  assert.deepEqual(translationReviewWith(repo, [], (id) => id).items, []);
});

test("the guard judges the canonical work when the target was merged away", () => {
  const repo = freshRepo();
  const volume = edition(repo, "9780140444309", { title: "Les Misérables I", author: "Victor Hugo" });
  const whole = edition(repo, "9780140444308", { title: "Les Misérables", author: "Victor Hugo", workKey: "OL5710W" });
  const pt = edition(repo, "9789720000702", { title: "Os Miseráveis I", author: "", language: "pt-PT", originalTitle: "Les Misérables" });
  repo.mergeWorks(volume.work_id!, whole.work_id!, AT);
  assert.equal(guardJoin(repo, pt.work_id!, volume.work_id!), "never");
});

test("a plain translation still merges at 0.99", async () => {
  const repo = freshRepo();
  const { en, pt } = lighthouse(repo, "");
  const { deps } = matching(repo, async () => ({ choice: 0, confidence: 0.99, model: "jev-1.13.0" }));
  await matchWork(deps, pt.work_id!, notSeries);
  assert.equal(repo.getBook(pt.id)!.work_id, en.work_id);
});
