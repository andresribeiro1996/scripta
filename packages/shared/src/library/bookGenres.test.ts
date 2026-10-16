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

test("Portuguese romantic literature and children's-and-youth labels", () => {
  assert.deepEqual(normalizeBookGenres(["Literatura Romântica"]), ["Romance"]);
  assert.deepEqual(normalizeBookGenres(["Literatura Romântica e Erótica"]), ["Romance"]);
  assert.deepEqual(normalizeBookGenres(["Infantojuvenil"]), ["Children's"]);
  assert.deepEqual(normalizeBookGenres(["Infanto-juvenil"]), ["Children's"]);
  assert.deepEqual(normalizeBookGenres(["Literatura juvenil"]), ["Young Adult"]);
});

test("Portuguese children's-and-youth phrases are Children's, plain juvenile labels stay Young Adult", () => {
  for (const label of ["Infantil / Juvenil", "Infantil e Juvenil", "ALFAGUARA INFANTIL & JUVENIL", "COLECAO_Manuscrito Infantil e Juvenil", "TEMA Infantil e juvenil", "Infantis e Juvenis"]) {
    assert.deepEqual(normalizeBookGenres([label]), ["Children's"], label);
  }
  for (const label of ["Literatura juvenil", "Juvenil"]) assert.deepEqual(normalizeBookGenres([label]), ["Young Adult"], label);
});

test("jovem adulto is Young Adult ahead of Romance, and literatura fantastica is Fantasy", () => {
  assert.deepEqual(normalizeBookGenres(["Jovem Adulto"]), ["Young Adult"]);
  assert.deepEqual(normalizeBookGenres(["Jovens adultos"]), ["Young Adult"]);
  assert.deepEqual(normalizeBookGenres(["TEMA_Romance Jovem Adulto"]), ["Young Adult"]);
  assert.deepEqual(normalizeBookGenres(["Literatura Fantástica"]), ["Fantasy"]);
});

test("common Goodreads shelves and StoryGraph tags map to genres, and non-genre shelves to nothing", () => {
  const shelves: Array<[string, string | null]> = [
    ["ya", "Young Adult"],
    ["ya-fantasy", "Young Adult"],
    ["lit-fic", "Literary Fiction"],
    ["litfic", "Literary Fiction"],
    ["dystopian", "Science Fiction"],
    ["dystopia", "Science Fiction"],
    ["space-opera", "Science Fiction"],
    ["cyberpunk", "Science Fiction"],
    ["time-travel", "Science Fiction"],
    ["rom-com", "Romance"],
    ["romcom", "Romance"],
    ["romantasy", "Fantasy"],
    ["paranormal", "Fantasy"],
    ["paranormal-romance", "Romance"],
    ["Fiction / Romance / Paranormal", "Romance"],
    ["middle-grade", "Children's"],
    ["kids", "Children's"],
    ["kidlit", "Children's"],
    ["sci-fi-faves", "Science Fiction"],
    ["fantasy-to-read", "Fantasy"],
    ["cozy-mystery", "Mystery"],
    ["true-crime", "Crime"],
    ["graphic-novels", "Comics & Graphic Novels"],
    ["to-read", null],
    ["currently-reading", null],
    ["read-in-2024", null],
    ["owned", null],
    ["favorites", null],
    ["2023", null],
    ["kindle", null],
    ["audiobook", null],
    ["book-club", null],
    ["dnf", null],
    ["food-for-thought", null],
    ["reading-history", null],
    ["Billy, the Kid, 1859-1881", null]
  ];
  for (const [shelf, genre] of shelves) assert.deepEqual(normalizeBookGenres([shelf]), genre ? [genre] : [], shelf);
  assert.deepEqual(normalizeBookGenres(["Food"]), ["Cooking"]);
  assert.deepEqual(normalizeBookGenres(["World history"]), ["History"]);
  assert.deepEqual(normalizeBookGenres(["Books and reading -- History"]), ["History"]);
  assert.deepEqual(normalizeBookGenres(["Travel"]), ["Travel"]);
});

test("shelf words that name a theme never beat the genre they modify", () => {
  assert.deepEqual(normalizeBookGenres(["Fiction / Romance / Time Travel"]), ["Romance"]);
  assert.deepEqual(normalizeBookGenres(["Dystopian romance"]), ["Romance"]);
  assert.deepEqual(normalizeBookGenres(["Young adult dystopian"]), ["Young Adult"]);
  assert.deepEqual(normalizeBookGenres(["paranormal-mystery"]), ["Mystery"]);
  assert.deepEqual(normalizeBookGenres(["Fiction / Mystery & Detective / Paranormal"]), ["Mystery"]);
  assert.deepEqual(normalizeBookGenres(["paranormal-horror"]), ["Horror"]);
});
