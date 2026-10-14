import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { BOOK_GENRES, GENRE_LOOKUP_BATCH, genreLookupOrder, normalizeBookGenres, settleWithConcurrency } from "./bookGenres.js";

test("genreLookupOrder puts finished books first, unread/reading after, both in stable order", () => {
  const unread = { Title: "A", ReadStatus: 0 };
  const finished1 = { Title: "B", ReadStatus: 2 };
  const reading = { Title: "C", ReadStatus: 1 };
  const finished2 = { Title: "D", ReadStatus: 2 };
  assert.deepEqual(genreLookupOrder([unread, finished1, reading, finished2]), [finished1, finished2, unread, reading]);
});

test("genreLookupOrder skips books that already have _genres, even an empty array", () => {
  const withGenres = { Title: "A", ReadStatus: 2, _genres: ["Fantasy"] };
  const withEmptyGenres = { Title: "B", ReadStatus: 2, _genres: [] };
  const needsLookup = { Title: "C", ReadStatus: 0 };
  assert.deepEqual(genreLookupOrder([withGenres, withEmptyGenres, needsLookup]), [needsLookup]);
});

test("GENRE_LOOKUP_BATCH is 20", () => {
  assert.equal(GENRE_LOOKUP_BATCH, 20);
});

test("settleWithConcurrency keeps results in input order regardless of finish order", async () => {
  const items = [30, 10, 20];
  const results = await settleWithConcurrency(items, 3, async (ms) => { await delay(ms); return ms; });
  assert.deepEqual(results, items.map((ms) => ({ status: "fulfilled", value: ms })));
});

test("settleWithConcurrency reports a rejection without stopping the others", async () => {
  const results = await settleWithConcurrency([1, 2, 3], 2, async (n) => {
    if (n === 2) throw new Error("boom");
    return n;
  });
  assert.equal(results[0]!.status, "fulfilled");
  assert.equal(results[1]!.status, "rejected");
  assert.equal(results[2]!.status, "fulfilled");
  assert.equal((results[1] as PromiseRejectedResult).reason.message, "boom");
});

test("settleWithConcurrency never runs more than limit at once", async () => {
  let active = 0;
  let peak = 0;
  await settleWithConcurrency([1, 2, 3, 4, 5, 6], 2, async () => {
    active++;
    peak = Math.max(peak, active);
    await delay(5);
    active--;
  });
  assert.equal(peak, 2);
});

test("normalizeBookGenres maps BISAC-style subject paths", () => {
  const cases: Array<[string, string]> = [
    ["Fiction / Science Fiction / General", "Science Fiction"],
    ["Fiction / Fantasy / Epic", "Fantasy"],
    ["Fiction / Mystery & Detective / General", "Mystery"],
    ["Fiction / Thrillers / Suspense", "Thriller"],
    ["Fiction / Historical / General", "Historical Fiction"],
    ["Fiction / Literary", "Literary Fiction"],
    ["Juvenile Fiction / Fantasy & Magic", "Children's"],
    ["Biography & Autobiography / Historical", "Biography & Memoir"],
    ["Political Science / General", "Politics"],
    ["Business & Economics / General", "Business"]
  ];
  for (const [subject, genre] of cases) assert.deepEqual(normalizeBookGenres([subject]), [genre], subject);
  assert.deepEqual(normalizeBookGenres(["Fiction / General"]), []);
});

test("normalizeBookGenres maps Portuguese subjects and tags", () => {
  const cases: Array<[string, string]> = [
    ["Ficção científica", "Science Fiction"],
    ["Ficção científica e fantasia", "Science Fiction"],
    ["Ficção histórica", "Historical Fiction"],
    ["Romances históricos", "Historical Fiction"],
    ["Romance histórico", "Historical Fiction"],
    ["Ficção literária", "Literary Fiction"],
    ["Clássicos", "Classics"],
    ["Biografias e memórias", "Biography & Memoir"],
    ["Autobiografia", "Biography & Memoir"],
    ["Banda desenhada", "Comics & Graphic Novels"],
    ["Quadrinhos", "Comics & Graphic Novels"],
    ["Literatura juvenil", "Young Adult"],
    ["Livros infantis", "Children's"],
    ["Fantasia", "Fantasy"],
    ["Policial", "Mystery"],
    ["Policiais e thrillers", "Mystery"],
    ["Romance policial", "Mystery"],
    ["Mistérios e suspenses", "Mystery"],
    ["Suspenses", "Thriller"],
    ["Terror", "Horror"],
    ["Crimes", "Crime"],
    ["História", "History"],
    ["Filosofia", "Philosophy"],
    ["Psicologia", "Psychology"],
    ["Informática", "Technology"],
    ["Ciências", "Science"],
    ["Economia e gestão", "Business"],
    ["Autoajuda", "Self-Help"],
    ["Auto-ajuda", "Self-Help"],
    ["Desenvolvimento pessoal", "Self-Help"],
    ["Poesia", "Poetry"],
    ["Poemas", "Poetry"],
    ["Religião", "Religion"],
    ["Viagem: Ásia", "Travel"],
    ["Culinária", "Cooking"]
  ];
  for (const [subject, genre] of cases) assert.deepEqual(normalizeBookGenres([subject]), [genre], subject);
  assert.deepEqual(normalizeBookGenres(["Romance"]), ["Romance"]);
  assert.deepEqual(normalizeBookGenres(["Histórias"]), []);
  assert.deepEqual(normalizeBookGenres(["Fiction / Romance / Historical / General"]), ["Romance"]);
  assert.deepEqual(normalizeBookGenres(["Romance / Police Procedural"]), ["Romance"]);
});

test("every canonical genre name normalizes to itself", () => {
  for (const genre of BOOK_GENRES) assert.deepEqual(normalizeBookGenres([genre]), [genre], genre);
});
