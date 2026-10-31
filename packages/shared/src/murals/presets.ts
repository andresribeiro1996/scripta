import type { Locale } from "../i18n/locale.js";
import { sharedT } from "../i18n/sharedT.js";
import { bookKey } from "../library/merge.js";
import type { Group } from "../library/groups.js";
import { DEFAULT_BLOCK_STYLE, type BlockStyle } from "../library/libraryStyle.js";
import { readerIdentity } from "../library/readerIdentity.js";
import { eligiblePassages } from "./home.js";
import { ensureBookBlockHeights, newId, type BlockLayout, type MuralBlock } from "./murals.js";

export type MuralPresetId = "best" | "recent" | "next" | "shelf";

export function muralPresets(locale: Locale): Array<{ id: MuralPresetId; name: string; description: string }> {
  const t = sharedT(locale);
  return [
    { id: "best", name: t("shared.murals.presetBestName"), description: t("shared.murals.presetBestDescription") },
    { id: "recent", name: t("shared.murals.presetRecentName"), description: t("shared.murals.presetRecentDescription") },
    { id: "next", name: t("shared.murals.presetNextName"), description: t("shared.murals.presetNextDescription") },
    { id: "shelf", name: t("shared.murals.presetShelfName"), description: t("shared.murals.presetShelfDescription") }
  ];
}

type Book = Record<string, unknown>;

const SHELF_SIZE = 8;

const UNAVAILABLE = {
  best: "shared.murals.needsBest",
  recent: "shared.murals.needsRecent",
  next: "shared.murals.needsNext",
  shelf: "shared.murals.needsShelf"
} as const satisfies Record<MuralPresetId, string>;

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

export function presetAvailability(id: MuralPresetId, books: Book[], locale: Locale): string | null {
  return presetBooks(id, titledBooks(books)).length ? null : sharedT(locale)(UNAVAILABLE[id]);
}

export function shelfPresetSummary(books: Book[], published: boolean, locale: Locale) {
  const t = sharedT(locale);
  const library = titledBooks(books);
  const reading = library.filter((book) => book.ReadStatus === 1).length;
  const finished = library.filter((book) => book.ReadStatus === 2).length;
  const visibility = t(published ? "shared.murals.shelfPublished" : "shared.murals.shelfPrivate");
  return t("shared.murals.shelfSummary", { count: library.length, reading, finished, visibility });
}

export function buildMuralPreset(id: MuralPresetId, books: Book[], locale: Locale, groups: Group[] = []) {
  const t = sharedT(locale);
  const preset = muralPresets(locale).find((item) => item.id === id)!;
  const library = titledBooks(books);
  const selected = presetBooks(id, library).slice(0, SHELF_SIZE);
  const keys = (list: Book[]) => list.map(bookKey);
  const accentStyle: BlockStyle = { ...DEFAULT_BLOCK_STYLE, fontFamily: "playfairDisplay" };
  const at = (x: number, y: number, w: number, h: number, accent = false): { id: string; layout: BlockLayout; style?: BlockStyle } =>
    ({ id: newId(), layout: { x, y, w, h }, ...(accent ? { style: accentStyle } : {}) });
  const blocks: MuralBlock[] = [];

  if (id === "shelf") {
    const reading = library.filter((book) => book.ReadStatus === 1);
    const finished = finishedNewestFirst(library).slice(0, SHELF_SIZE);
    const loved = favourites(library).slice(0, SHELF_SIZE);
    const hasPassage = eligiblePassages(library).length > 0;
    const profileBottom = 5;
    blocks.push({ ...at(0, 0, 12, profileBottom), type: "profile", bio: "", favoriteGenres: [] });
    const hasCard = readerIdentity(library, groups, locale).state === "settled";
    let statsY: number;
    if (hasCard) {
      blocks.push({ ...at(0, profileBottom, 6, 6), type: "readerCard" });
      blocks.push({ ...at(6, profileBottom, 6, 6), type: "stats", metrics: ["totalBooks", "booksFinished", "booksInProgress"] });
      statsY = profileBottom + 6;
    } else {
      blocks.push({ ...at(0, profileBottom, 12, 4), type: "stats", metrics: ["totalBooks", "booksFinished", "booksInProgress"] });
      statsY = profileBottom + 4;
    }
    let y = statsY;
    if (reading.length) { blocks.push({ ...at(0, y, 12, 6), type: "currentlyReading" }); y += 6; }
    if (finished.length) { blocks.push({ ...at(0, y, 12, 5), type: "shelf", title: t("shared.murals.shelfFinished"), role: "finished", bookKeys: keys(finished) }); y += 5; }
    const width = hasPassage && loved.length ? 6 : 12;
    if (hasPassage) blocks.push({ ...at(0, y, width, 5), type: "quote", bookKey: "", highlightId: "", mode: "rediscover" });
    if (loved.length) blocks.push({ ...at(12 - width, y, width, 5), type: "shelf", title: t("shared.murals.shelfFavourites"), role: "favourites", bookKeys: keys(loved) });
    return { name: preset.name, blocks: ensureBookBlockHeights(blocks), bookCount: library.length };
  }

  const heading = id === "best"
    ? { heading: t("shared.murals.bestHeading"), body: t("shared.murals.bestBody") }
    : id === "recent"
      ? { heading: t("shared.murals.recentHeading"), body: t("shared.murals.recentBody") }
      : { heading: t("shared.murals.nextHeading"), body: t("shared.murals.nextBody") };
  blocks.push({ ...at(0, 0, 12, 3, true), type: "text", ...heading });
  if (id === "recent") {
    if (selected.length) blocks.push({ ...at(0, 3, 12, 8), type: "shelf", title: t("shared.murals.justFinished"), bookKeys: keys(selected) });
  } else if (selected[0]) {
    const rest = selected.slice(1);
    blocks.push({ ...at(0, 3, rest.length ? 4 : 12, 8), type: "spotlight", bookKey: bookKey(selected[0]), ...(id === "next" ? { caption: t("shared.murals.onMyList") } : {}) });
    if (rest.length) blocks.push({ ...at(4, 3, 8, 8), type: "shelf", title: t(id === "best" ? "shared.murals.placeOfHonour" : "shared.murals.onTheHorizon"), bookKeys: keys(rest) });
  }
  return { name: preset.name, blocks: ensureBookBlockHeights(blocks), bookCount: selected.length };
}
