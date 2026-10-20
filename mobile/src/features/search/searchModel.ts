import { bookKey, canonicalIsbn, statusLabel, type BookSearchResult, type LibraryBook } from "@scripta/shared";
import type { DiscoverItem, PersonResult } from "@scripta/shared/community";

export const SEARCH_SCOPES = [
  { value: "all", label: "All" },
  { value: "books", label: "Books" },
  { value: "people", label: "People" },
  { value: "games", label: "Games" },
] as const;

export type SearchScope = (typeof SEARCH_SCOPES)[number]["value"];
export type ResultSection = "library" | "books" | "people" | "games";

export const SECTION_PREVIEW = 3;
export const RECENT_LIMIT = 8;
export const NEW_GAMES = 5;
const MIN_NETWORK_QUERY = 2;

export const SECTION_TITLES: Record<ResultSection, string> = { library: "In your library", books: "Books", people: "People", games: "Games" };
export const SECTION_ERRORS: Record<ResultSection, string> = {
  library: "Couldn't load your library.",
  books: "Couldn't search books.",
  people: "Couldn't search people.",
  games: "Couldn't search games.",
};
export const SCOPE_OF: Record<ResultSection, SearchScope> = { library: "books", books: "books", people: "people", games: "games" };

const SECTIONS_IN: Record<SearchScope, readonly ResultSection[]> = {
  all: ["library", "books", "people", "games"],
  books: ["library", "books"],
  people: ["people"],
  games: ["games"],
};

export function isNetworkQuery(query: string): boolean {
  return query.trim().length >= MIN_NETWORK_QUERY;
}

export function idleSections(scope: SearchScope): { readers: boolean; newGames: boolean } {
  return { readers: scope === "all" || scope === "people", newGames: scope === "all" || scope === "games" };
}

export interface SectionState<T> {
  rows: T[];
  loading: boolean;
  failed: boolean;
}

export interface ResultsInput {
  scope: SearchScope;
  query: string;
  submitted: boolean;
  library: SectionState<LibraryBook>;
  books: SectionState<BookSearchResult>;
  people: SectionState<PersonResult>;
  games: SectionState<DiscoverItem>;
  openLibrary: "idle" | "pending" | "failed";
}

export type SearchRow =
  | { kind: "header"; key: string; section: ResultSection; seeAll: boolean }
  | { kind: "library"; key: string; book: LibraryBook }
  | { kind: "book"; key: string; result: BookSearchResult }
  | { kind: "person"; key: string; person: PersonResult }
  | { kind: "game"; key: string; item: DiscoverItem }
  | { kind: "loading"; key: string; section: ResultSection }
  | { kind: "failed"; key: string; section: ResultSection }
  | { kind: "catalogEmpty"; key: string }
  | { kind: "openLibrary"; key: string; state: "pending" | "failed" }
  | { kind: "addByHand"; key: string }
  | { kind: "noResults"; key: string };

export function searchRows(input: ResultsInput): SearchRow[] {
  const network = isNetworkQuery(input.query);
  const cap = input.scope === "all" ? SECTION_PREVIEW : Number.POSITIVE_INFINITY;
  const rows = SECTIONS_IN[input.scope]
    .filter((section) => network || section === "library")
    .flatMap((section) => sectionRows(section, input, cap));
  if (rows.length > 0 || !network) return rows;
  const noResults: SearchRow = { kind: "noResults", key: "noResults" };
  return SECTIONS_IN[input.scope].includes("books") ? [noResults, { kind: "addByHand", key: "addByHand" }] : [noResults];
}

function sectionRows(section: ResultSection, input: ResultsInput, cap: number): SearchRow[] {
  const state = input[section];
  const header = (seeAll: boolean): SearchRow => ({ kind: "header", key: `header:${section}`, section, seeAll });
  if (state.loading) return [header(false), { kind: "loading", key: `loading:${section}`, section }];
  if (state.failed) return [header(false), { kind: "failed", key: `failed:${section}`, section }];
  const items = itemRows(section, input, cap);
  const seeAll = state.rows.length > cap;
  if (section !== "books") return items.length > 0 ? [header(seeAll), ...items] : [];
  const addByHand: SearchRow = { kind: "addByHand", key: "addByHand" };
  const openLibrary: SearchRow[] = input.submitted && input.openLibrary !== "idle" ? [{ kind: "openLibrary", key: "openLibrary", state: input.openLibrary }] : [];
  if (items.length > 0 || openLibrary.length > 0) return [header(seeAll), ...items, ...openLibrary, addByHand];
  return input.submitted ? [] : [header(false), { kind: "catalogEmpty", key: "catalogEmpty" }, addByHand];
}

function itemRows(section: ResultSection, input: ResultsInput, cap: number): SearchRow[] {
  switch (section) {
    case "library":
      return input.library.rows.slice(0, cap).map((book): SearchRow => ({ kind: "library", key: `library:${bookKey(book)}`, book }));
    case "books":
      return input.books.rows.slice(0, cap).map((result, index): SearchRow => ({ kind: "book", key: `book:${result.workId ?? index}`, result }));
    case "people":
      return input.people.rows.slice(0, cap).map((person): SearchRow => ({ kind: "person", key: `person:${person.user.userId}`, person }));
    case "games":
      return input.games.rows.slice(0, cap).map((item): SearchRow => ({ kind: "game", key: `game:${item.content.kind}:${item.content.id}`, item }));
  }
}

export function libraryStatus(book: LibraryBook): { label: string; tone: "accent" | "neutral" | "success" } {
  const label = statusLabel(book.ReadStatus);
  if (book.ReadStatus === 1) return { label, tone: "accent" };
  if (book.ReadStatus === 2) return { label, tone: "success" };
  return { label, tone: "neutral" };
}

export interface OwnedBooks {
  workIds: Set<string>;
  isbns: Set<string>;
}

export function ownedBooks(books: LibraryBook[], works: Record<string, string> = {}): OwnedBooks {
  return {
    workIds: new Set(Object.values(works)),
    isbns: new Set(books.flatMap((book) => {
      const isbn = canonicalIsbn(book.ISBN);
      return isbn ? [isbn] : [];
    })),
  };
}

export function mergeBookResults(catalog: BookSearchResult[], outside: BookSearchResult[], owned: OwnedBooks, listed: ReadonlySet<string>): BookSearchResult[] {
  const works = new Set<string>();
  const isbns = new Set<string>();
  return [...catalog, ...outside].filter((result) => {
    const isbn = canonicalIsbn(result.isbn);
    if (result.workId ? owned.workIds.has(result.workId) && listed.has(result.workId) : isbn !== "" && owned.isbns.has(isbn)) return false;
    if ((result.workId && works.has(result.workId)) || (isbn && isbns.has(isbn))) return false;
    if (result.workId) works.add(result.workId);
    if (isbn) isbns.add(isbn);
    return true;
  });
}

export function searchQueryFromParam(param: string | string[] | undefined): string | null {
  const text = (Array.isArray(param) ? param[0] : param)?.trim();
  return text ? text : null;
}

export function recentSearchesKey(userId: string): string {
  return `search.recent.${userId}`;
}

export function readRecentSearches(raw: string | null): string[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    if (err instanceof SyntaxError) return [];
    throw err;
  }
  return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string").slice(0, RECENT_LIMIT) : [];
}

export function recordRecentSearch(list: string[], query: string): string[] {
  const text = query.trim();
  if (!text) return list;
  const same = text.toLowerCase();
  return [text, ...list.filter((entry) => entry.toLowerCase() !== same)].slice(0, RECENT_LIMIT);
}
