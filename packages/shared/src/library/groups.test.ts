import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addBookToGroup,
  addKeyToGroup,
  deriveSeriesGroups,
  normalizeGroupName,
  removeBookFromGroup,
  removeKeyFromGroup,
  type Group
} from "./groups.js";
import { bookKey } from "./merge.js";

type Book = Record<string, unknown>;

const STAMP = "2020-01-01T00:00:00.000Z";

function group(partial: Partial<Group> & Pick<Group, "id" | "type" | "name">): Group {
  return { bookKeys: [], createdAt: STAMP, updatedAt: STAMP, ...partial };
}

function frozen(groups: Group[]): Group[] {
  for (const g of groups) {
    Object.freeze(g.bookKeys);
    Object.freeze(g);
  }
  return Object.freeze(groups) as Group[];
}

test("addKeyToGroup returns the same array, stamping nothing, when the key is already in or the group is unknown", () => {
  const groups = frozen([group({ id: "g", type: "collection", name: "C", bookKeys: ["ta:a|"] })]);
  assert.equal(addKeyToGroup(groups, "g", "ta:a|"), groups);
  assert.equal(addKeyToGroup(groups, "missing", "ta:b|"), groups);
});

test("removeKeyFromGroup returns the same array, stamping nothing, when the key is already out or the group is unknown", () => {
  const groups = frozen([group({ id: "g", type: "collection", name: "C", bookKeys: ["ta:a|"] })]);
  assert.equal(removeKeyFromGroup(groups, "g", "ta:b|"), groups);
  assert.equal(removeKeyFromGroup(groups, "missing", "ta:a|"), groups);
});

test("addKeyToGroup appends the key and stamps only that group", () => {
  const other = group({ id: "o", type: "collection", name: "O", bookKeys: ["ta:a|"] });
  const target = group({ id: "g", type: "collection", name: "C", bookKeys: ["ta:a|"] });
  const groups = frozen([other, target]);
  const result = addKeyToGroup(groups, "g", "ta:b|");
  assert.notEqual(result, groups);
  assert.equal(result[0], other);
  assert.deepEqual(result[1]!.bookKeys, ["ta:a|", "ta:b|"]);
  assert.notEqual(result[1]!.updatedAt, STAMP);
  assert.equal(result[1]!.createdAt, STAMP);
});

test("removeKeyFromGroup drops only that key and stamps only that group", () => {
  const other = group({ id: "o", type: "collection", name: "O", bookKeys: ["ta:a|"] });
  const target = group({ id: "g", type: "collection", name: "C", bookKeys: ["ta:a|", "ta:b|"] });
  const groups = frozen([other, target]);
  const result = removeKeyFromGroup(groups, "g", "ta:a|");
  assert.notEqual(result, groups);
  assert.equal(result[0], other);
  assert.deepEqual(result[1]!.bookKeys, ["ta:b|"]);
  assert.notEqual(result[1]!.updatedAt, STAMP);
});

test("addBookToGroup and removeBookFromGroup act on the book's bookKey", () => {
  const book = { Title: "Dune", Attribution: "Frank Herbert" };
  const empty = frozen([group({ id: "g", type: "collection", name: "C" })]);
  const added = addBookToGroup(empty, "g", book);
  assert.deepEqual(added[0]!.bookKeys, [bookKey(book)]);
  assert.equal(addBookToGroup(added, "g", { ...book }), added);
  const removed = removeBookFromGroup(added, "g", book);
  assert.deepEqual(removed[0]!.bookKeys, []);
  assert.equal(removeBookFromGroup(removed, "g", book), removed);
});

test("deriveSeriesGroups seeds one series per name, however it is spelled, and files each book under it", () => {
  const dune = { Title: "Dune", Attribution: "Frank Herbert", Series: "Dune Saga" };
  const messiah = { Title: "Dune Messiah", Attribution: "Frank Herbert", Series: "  dune   SAGA " };
  const standalone = { Title: "Emma", Attribution: "Jane Austen", Series: "   " };
  const result = deriveSeriesGroups([dune, messiah, standalone], []);
  assert.equal(result.length, 1);
  assert.equal(result[0]!.type, "series");
  assert.equal(result[0]!.name, "Dune Saga");
  assert.deepEqual(result[0]!.bookKeys, [bookKey(dune), bookKey(messiah)]);
});

test("deriveSeriesGroups files a book under the first matching series, never under a collection", () => {
  const book = { Title: "Dune", Attribution: "Frank Herbert", Series: "Dune Saga" };
  const collection = group({ id: "c", type: "collection", name: "Dune Saga" });
  const first = group({ id: "s1", type: "series", name: "dune saga", bookKeys: ["ta:x|"] });
  const second = group({ id: "s2", type: "series", name: "DUNE SAGA" });
  const input = frozen([collection, first, second]);
  const result = deriveSeriesGroups([book], input);
  assert.equal(result.length, 3);
  assert.equal(result[0], collection);
  assert.deepEqual(result[1]!.bookKeys, ["ta:x|", bookKey(book)]);
  assert.notEqual(result[1]!.updatedAt, STAMP);
  assert.equal(result[2], second);
});

test("deriveSeriesGroups leaves a series alone when the book is already in it", () => {
  const book = { Title: "Dune", Attribution: "Frank Herbert", Series: "Dune Saga" };
  const input = frozen([group({ id: "s", type: "series", name: "Dune Saga", bookKeys: [bookKey(book)] })]);
  const result = deriveSeriesGroups([book, { ...book }], input);
  assert.equal(result[0], input[0]);
});

function legacyDeriveSeriesGroups(books: Book[], groups: Group[]): Group[] {
  const result = [...groups];
  for (const book of books) {
    const seriesName = typeof book.Series === "string" ? book.Series.trim() : "";
    if (!seriesName) continue;
    const key = bookKey(book);
    const idx = result.findIndex((g) => g.type === "series" && normalizeGroupName(g.name) === normalizeGroupName(seriesName));
    if (idx === -1) {
      const now = new Date().toISOString();
      result.push({ id: crypto.randomUUID(), type: "series", name: seriesName, bookKeys: [key], createdAt: now, updatedAt: now });
    } else if (!result[idx]!.bookKeys.includes(key)) {
      result[idx] = { ...result[idx]!, bookKeys: [...result[idx]!.bookKeys, key], updatedAt: new Date().toISOString() };
    }
  }
  return result;
}

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function spelled(next: () => number, name: string): string {
  return [name, name.toUpperCase(), `  ${name} `, name.replace(" ", "   ")][Math.floor(next() * 4)]!;
}

function makeBooks(next: () => number, count: number, seriesOf: (index: number) => string): Book[] {
  const titles = Math.max(1, Math.floor(count * 0.3));
  return Array.from({ length: count }, (_, i) => {
    const book: Book = { Title: `Title ${Math.floor(next() * titles)}`, Attribution: `Author ${Math.floor(next() * 4)}` };
    const roll = next();
    if (roll < 0.04) book.Series = "   ";
    else if (roll < 0.08) book.Series = 7;
    else if (roll >= 0.12) book.Series = spelled(next, seriesOf(i));
    return book;
  });
}

function makeGroups(next: () => number, books: Book[], names: string[]): Group[] {
  const someKeys = () =>
    books.length === 0 ? [] : Array.from({ length: Math.floor(next() * 4) }, () => bookKey(books[Math.floor(next() * books.length)]!));
  const groups: Group[] = [];
  names.forEach((name, i) => {
    if (next() < 0.35) {
      groups.push(Object.assign(group({ id: `s${i}`, type: "series", name: spelled(next, name), bookKeys: someKeys() }), { note: i }));
      if (next() < 0.3) groups.push(group({ id: `d${i}`, type: "series", name: spelled(next, name), bookKeys: someKeys() }));
    }
    if (next() < 0.1) groups.push(group({ id: `c${i}`, type: "collection", name: spelled(next, name), bookKeys: someKeys() }));
  });
  for (let i = groups.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [groups[i], groups[j]] = [groups[j]!, groups[i]!];
  }
  return groups;
}

function isoStamp(value: unknown): string {
  assert.equal(typeof value, "string");
  assert.equal(new Date(value as string).toISOString(), value);
  return "iso";
}

function normalized(input: Group[], output: Group[]) {
  return output.map((g, i) =>
    i >= input.length
      ? { ...g, id: "new", createdAt: isoStamp(g.createdAt), updatedAt: isoStamp(g.updatedAt) }
      : { ...g, updatedAt: g.updatedAt === input[i]!.updatedAt ? "same" : isoStamp(g.updatedAt) }
  );
}

const SHAPES: Array<[string, (count: number) => (index: number) => string]> = [
  ["one series per book", () => (i) => `Series ${i}`],
  ["many books per series", (count) => (i) => `Series ${i % Math.max(1, Math.floor(count / 10))}`]
];

function assertMatchesLegacy(books: Book[], groups: Group[], label: string) {
  frozen(groups);
  const expected = legacyDeriveSeriesGroups(books, groups);
  const actual = deriveSeriesGroups(books, groups);
  assert.deepEqual(normalized(groups, actual), normalized(groups, expected), label);
  groups.forEach((g, i) => assert.equal(actual[i] === g, expected[i] === g, `${label}: group ${i} identity`));
}

function randomLibrary(seed: number, count: number, seriesOf: (index: number) => string) {
  const next = seeded(seed);
  const books = makeBooks(next, count, seriesOf);
  const names = [...new Set(books.map((_, i) => seriesOf(i)))];
  return { books, groups: makeGroups(next, books, names) };
}

test("deriveSeriesGroups gives the old output on many small random libraries, in both shapes", () => {
  for (const [shape, seriesFor] of SHAPES) {
    for (let seed = 1; seed <= 60; seed++) {
      const count = Math.floor(seeded(seed * 7919)() * 300);
      const { books, groups } = randomLibrary(seed, count, seriesFor(count));
      assertMatchesLegacy(books, groups, `${shape}, seed ${seed}, ${count} books`);
    }
  }
});

for (const [shape, seriesFor] of SHAPES) {
  test(`deriveSeriesGroups gives the old output on 2,000 random books, ${shape}`, () => {
    const { books, groups } = randomLibrary(2000, 2000, seriesFor(2000));
    assertMatchesLegacy(books, groups, shape);
    assertMatchesLegacy(books, [], `${shape} from no groups`);
  });
}

function timed<T>(run: () => T): { value: T; ms: number } {
  const start = performance.now();
  const value = run();
  return { value, ms: performance.now() - start };
}

for (const [shape, seriesCount] of [
  ["one series per book", 20_000],
  ["ten books per series", 2_000]
] as const) {
  test(`deriveSeriesGroups seeds and re-derives 20,000 books in under 500 ms each, ${shape}`, () => {
    const books = Array.from({ length: 20_000 }, (_, i) => ({ Title: `Title ${i}`, Attribution: "Author", Series: `Series ${i % seriesCount}` }));
    const seeding = timed(() => deriveSeriesGroups(books, []));
    assert.equal(seeding.value.length, seriesCount);
    assert.ok(seeding.ms < 500, `seeding took ${seeding.ms.toFixed(0)} ms`);
    const rederiving = timed(() => deriveSeriesGroups(books, seeding.value));
    assert.equal(rederiving.value.length, seriesCount);
    assert.ok(rederiving.value.every((g, i) => g === seeding.value[i]));
    assert.ok(rederiving.ms < 500, `re-deriving took ${rederiving.ms.toFixed(0)} ms`);
  });
}
