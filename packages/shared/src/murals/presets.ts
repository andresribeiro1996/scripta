import { bookKey } from "../library/merge.js";
import { DEFAULT_BLOCK_STYLE, type BlockStyle } from "../library/libraryStyle.js";
import { eligiblePassages } from "./home.js";
import { ensureBookBlockHeights, newId, type BlockLayout, type MuralBlock } from "./murals.js";

export const MURAL_PRESETS = [
  { id: "best", name: "All-time favourites", description: "The books that stayed with you.", color: "#44252e", accent: "#edcd96" },
  { id: "recent", name: "Recently finished", description: "Your last pages, newest first.", color: "#233d35", accent: "#c2dbc9" },
  { id: "next", name: "Want to read", description: "Stories waiting their turn.", color: "#25364f", accent: "#c5d7f1" },
  { id: "shelf", name: "My shelf", description: "What you're reading, what you've finished, and a passage to revisit.", color: "#2b2622", accent: "#e6c79c" }
] as const;

export type MuralPresetId = typeof MURAL_PRESETS[number]["id"];

type Book = Record<string, unknown>;

const SHELF_SIZE = 8;

const UNAVAILABLE: Record<MuralPresetId, string> = {
  best: "Needs books rated 4 or 5",
  recent: "Needs finished books",
  next: "Needs books on your to-read list",
  shelf: "Needs books in your library"
};

function timestamp(value: unknown) {
  const date = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(date) ? date : 0;
}

function titledBooks(books: Book[]) {
  return [...new Map(books.filter((book) => String(book.Title ?? "").trim()).map((book) => [bookKey(book), book])).values()];
}

function favourites(books: Book[]) {
  return books.filter((book) => typeof book.Rating === "number" && book.Rating >= 4 && book.Rating <= 5)
    .sort((a, b) => Number(b.Rating) - Number(a.Rating));
}

function finishedNewestFirst(books: Book[]) {
  const finished = books.filter((book) => book.ReadStatus === 2);
  return [
    ...finished.filter((book) => timestamp(book.DateLastRead) > 0).sort((a, b) => timestamp(b.DateLastRead) - timestamp(a.DateLastRead)),
    ...finished.filter((book) => timestamp(book.DateLastRead) === 0)
  ];
}

function presetBooks(id: MuralPresetId, books: Book[]) {
  if (id === "best") return favourites(books);
  if (id === "recent") return finishedNewestFirst(books);
  if (id === "next") return books.filter((book) => book.ReadStatus === 0).sort((a, b) => timestamp(b.DateCreated) - timestamp(a.DateCreated));
  return books;
}

export function presetAvailability(id: MuralPresetId, books: Book[]): string | null {
  return presetBooks(id, titledBooks(books)).length ? null : UNAVAILABLE[id];
}

export function shelfPresetSummary(books: Book[], published: boolean) {
  const library = titledBooks(books);
  const reading = library.filter((book) => book.ReadStatus === 1).length;
  const finished = library.filter((book) => book.ReadStatus === 2).length;
  const visibility = published ? "Your page is published, so visitors will see it once you keep it." : "Only you can see it.";
  return `Made from your ${library.length} ${library.length === 1 ? "book" : "books"}: ${reading} you're reading and ${finished} you've finished. ${visibility}`;
}

export function buildMuralPreset(id: MuralPresetId, books: Book[]) {
  const preset = MURAL_PRESETS.find((item) => item.id === id)!;
  const library = titledBooks(books);
  const selected = presetBooks(id, library).slice(0, SHELF_SIZE);
  const keys = (list: Book[]) => list.map(bookKey);
  const style: BlockStyle = { ...DEFAULT_BLOCK_STYLE, backgroundColor: preset.color, textColor: "#f5f1e9", cardBorderWidth: 0, cardShadow: false, cardRadius: 16, fontFamily: "sans" };
  const accentStyle: BlockStyle = { ...style, backgroundColor: preset.accent, textColor: preset.color, fontFamily: "playfairDisplay" };
  const at = (x: number, y: number, w: number, h: number, accent = false): { id: string; layout: BlockLayout; style: BlockStyle } =>
    ({ id: newId(), layout: { x, y, w, h }, style: accent ? accentStyle : style });
  const blocks: MuralBlock[] = [];

  if (id === "shelf") {
    const reading = library.filter((book) => book.ReadStatus === 1);
    const finished = finishedNewestFirst(library).slice(0, SHELF_SIZE);
    const loved = favourites(library).slice(0, SHELF_SIZE);
    const hasPassage = eligiblePassages(library).length > 0;
    blocks.push({ ...at(0, 0, 12, 4), type: "profile", bio: "", favoriteGenres: [] });
    blocks.push({ ...at(0, 4, 12, 4), type: "stats", metrics: ["totalBooks", "booksFinished", "booksInProgress"] });
    let y = 8;
    if (reading.length) { blocks.push({ ...at(0, y, 12, 4), type: "currentlyReading" }); y += 4; }
    if (finished.length) { blocks.push({ ...at(0, y, 12, 5), type: "shelf", title: "Finished", role: "finished", bookKeys: keys(finished) }); y += 5; }
    const width = hasPassage && loved.length ? 6 : 12;
    if (hasPassage) blocks.push({ ...at(0, y, width, 5), type: "quote", bookKey: "", highlightId: "", mode: "rediscover" });
    if (loved.length) blocks.push({ ...at(12 - width, y, width, 5), type: "shelf", title: "Favourites", role: "favourites", bookKeys: keys(loved) });
    return { name: preset.name, blocks: ensureBookBlockHeights(blocks), bookCount: library.length };
  }

  const heading = id === "best"
    ? { heading: "My essential library", body: "Stories to keep.\nBooks to open again." }
    : id === "recent"
      ? { heading: "Last pages", body: "My reading diary" }
      : { heading: "The next chapter", body: "So many stories.\nOne book at a time." };
  blocks.push({ ...at(0, 0, 12, 3, true), type: "text", ...heading });
  if (id === "recent") {
    if (selected.length) blocks.push({ ...at(0, 3, 12, 8), type: "shelf", title: "Just finished", bookKeys: keys(selected) });
  } else if (selected[0]) {
    const rest = selected.slice(1);
    blocks.push({ ...at(0, 3, rest.length ? 4 : 12, 8), type: "spotlight", bookKey: bookKey(selected[0]), ...(id === "next" ? { caption: "On my list" } : {}) });
    if (rest.length) blocks.push({ ...at(4, 3, 8, 8), type: "shelf", title: id === "best" ? "Place of honour" : "On the horizon", bookKeys: keys(rest) });
  }
  return { name: preset.name, blocks: ensureBookBlockHeights(blocks), bookCount: selected.length };
}
