import { normalizeBookGenres } from "./bookGenres.js";
import { certainFacts, likelyFacts, matchFacts, type MatchFacts } from "./bookMatch.js";
import { bookKey, unionHighlights, withIdentityOf } from "./merge.js";
import type { LibraryData } from "./types.js";

type Book = Record<string, unknown>;

export interface DuplicateGroups {
  certain: string[][];
  likely: string[][];
}

const MAX_FIELDS = ["ReadStatus", "___PercentRead", "TimeSpentReading"] as const;

function isBook(value: unknown): value is Book {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
}

function pairId(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

function components(size: number, edges: Array<[number, number]>): number[][] {
  const parent = Array.from({ length: size }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (const [a, b] of edges) parent[find(a)] = find(b);
  const groups = new Map<number, number[]>();
  for (let i = 0; i < size; i++) groups.set(find(i), [...(groups.get(find(i)) ?? []), i]);
  return [...groups.values()].filter((group) => group.length > 1);
}

export function findDuplicates(library: LibraryData): DuplicateGroups {
  const books = library.books.filter(isBook);
  const facts: MatchFacts[] = books.map(matchFacts);
  const keys = books.map(bookKey);
  const distinct = new Set(
    (library.distinctBooks ?? []).filter((pair): pair is string[] => Array.isArray(pair)).map(([a, b]) => pairId(String(a), String(b)))
  );
  const buckets = new Map<string, number[]>();
  facts.forEach((fact, i) => {
    for (const bucket of [fact.isbn && `i:${fact.isbn}`, fact.exact && `e:${fact.exact}`, fact.loose && `l:${fact.loose}`]) {
      if (bucket) buckets.set(bucket, [...(buckets.get(bucket) ?? []), i]);
    }
  });
  const certainEdges: Array<[number, number]> = [];
  const likelyEdges: Array<[number, number]> = [];
  const seen = new Set<string>();
  for (const members of buckets.values()) {
    for (let x = 0; x < members.length; x++) {
      for (let y = x + 1; y < members.length; y++) {
        const a = members[x]!;
        const b = members[y]!;
        if (seen.has(`${a}:${b}`)) continue;
        seen.add(`${a}:${b}`);
        if (distinct.has(pairId(keys[a]!, keys[b]!))) continue;
        if (certainFacts(facts[a]!, facts[b]!)) certainEdges.push([a, b]);
        else if (likelyFacts(facts[a]!, facts[b]!)) likelyEdges.push([a, b]);
      }
    }
  }
  const position = (i: number) => (typeof books[i]!._order === "number" ? (books[i]!._order as number) : Number.MAX_SAFE_INTEGER);
  const ordered = (group: number[]) =>
    [...group].sort((a, b) => Number(facts[b]!.isbn !== "") - Number(facts[a]!.isbn !== "") || position(a) - position(b) || a - b);
  const toKeys = (group: number[]) => [...new Set(ordered(group).map((i) => keys[i]!))];
  const signature = (group: number[]) => [...group].sort((a, b) => a - b).join(",");
  const certainGroups = components(books.length, certainEdges).filter((group) => new Set(group.map((i) => facts[i]!.isbn).filter(Boolean)).size <= 1);
  const certainSignatures = new Set(certainGroups.map(signature));
  const likelyGroups = components(books.length, [...certainEdges, ...likelyEdges]).filter((group) => !certainSignatures.has(signature(group)));
  return { certain: certainGroups.map(toKeys), likely: likelyGroups.map(toKeys) };
}

export function combineBooks(keep: Book, other: Book): Book {
  const combined: Book = { ...keep };
  for (const [field, value] of Object.entries(other)) {
    if (isBlank(combined[field]) && !isBlank(value)) combined[field] = value;
  }
  for (const field of MAX_FIELDS) {
    const values = [keep[field], other[field]].filter((value): value is number => typeof value === "number");
    if (values.length > 0) combined[field] = Math.max(...values);
  }
  if (!isBlank(keep.DateLastRead) && !isBlank(other.DateLastRead)) {
    combined.DateLastRead = String(other.DateLastRead) > String(keep.DateLastRead) ? other.DateLastRead : keep.DateLastRead;
  }
  combined.highlights = unionHighlights(keep.highlights, other.highlights);
  if ("_genres" in keep || "_genres" in other) {
    const list = (value: unknown) => (Array.isArray(value) ? value : []);
    combined._genres = normalizeBookGenres([...list(keep._genres), ...list(other._genres)]);
  }
  return combined;
}

export function rekeyKeys(keys: readonly string[], from: ReadonlySet<string>, to: string): string[] {
  return [...new Set(keys.map((key) => (from.has(key) ? to : key)))];
}

export function rekeyTierBoard<T extends Record<string, unknown>>(board: T, from: ReadonlySet<string>, to: string): T {
  const placed = new Set<string>();
  const tiers = Array.isArray(board.tiers)
    ? board.tiers.map((tier: unknown) => {
        if (!isBook(tier) || !Array.isArray(tier.bookKeys)) return tier;
        const bookKeys = rekeyKeys(tier.bookKeys as string[], from, to).filter((key) => !placed.has(key));
        bookKeys.forEach((key) => placed.add(key));
        return { ...tier, bookKeys };
      })
    : board.tiers;
  const pool = Array.isArray(board.pool) ? rekeyKeys(board.pool as string[], from, to).filter((key) => !placed.has(key)) : board.pool;
  return { ...board, tiers, pool };
}

function rekeyPairs(pairs: readonly unknown[], from: ReadonlySet<string>, to: string): string[][] {
  const seen = new Set<string>();
  const result: string[][] = [];
  for (const pair of pairs) {
    if (!Array.isArray(pair)) continue;
    const [a, b] = pair;
    if (typeof a !== "string" || typeof b !== "string") continue;
    const left = from.has(a) ? to : a;
    const right = from.has(b) ? to : b;
    if (left === right || seen.has(pairId(left, right))) continue;
    seen.add(pairId(left, right));
    result.push(left < right ? [left, right] : [right, left]);
  }
  return result;
}

export function markDistinct(library: LibraryData, keys: string[]): LibraryData {
  const pairs: unknown[] = [...(library.distinctBooks ?? [])];
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) pairs.push([keys[i], keys[j]]);
  return { ...library, distinctBooks: rekeyPairs(pairs, new Set(), "") };
}

export function mergeDuplicateBooks(library: LibraryData, keep: string, merge: string[]): LibraryData {
  const keys = new Set([keep, ...merge]);
  const original = library.books.find((book) => isBook(book) && bookKey(book) === keep);
  const members = library.books.filter((book): book is Book => isBook(book) && keys.has(bookKey(book)));
  if (!original || members.length < 2) return library;
  const survivor = withIdentityOf(members.reduce((acc, book) => (book === original ? acc : combineBooks(acc, book)), original), original);
  const books = library.books.flatMap((book) => (book === original ? [survivor] : isBook(book) && keys.has(bookKey(book)) ? [] : [book]));
  const from = new Set(merge.filter((key) => key !== keep));
  const now = new Date().toISOString();
  const groups = library.groups?.map((group) => {
    const bookKeys = rekeyKeys(group.bookKeys, from, keep);
    return bookKeys.join("\u0000") === group.bookKeys.join("\u0000") ? group : { ...group, bookKeys, updatedAt: now };
  });
  return {
    ...library,
    books,
    book_count: books.length,
    ...(groups ? { groups } : {}),
    ...(library.distinctBooks ? { distinctBooks: rekeyPairs(library.distinctBooks, from, keep) } : {})
  };
}
