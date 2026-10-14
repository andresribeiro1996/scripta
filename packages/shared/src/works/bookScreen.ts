import { genresForBook } from "../library/bookGenres.js";
import { statusLabel } from "../library/covers.js";
import { FINISH_FEELINGS, type FinishRating } from "../library/finish.js";
import type { IdentityKey } from "../readerCards/index.js";
import { ratingCountLabel } from "./bookStats.js";
import { gameOwnerLabel, readerCountsLabel, readerStatusLabel, summaryPreview } from "./labels.js";
import type { WorkEdition, WorkGameRef, WorkPage, WorkReader } from "./types.js";

type Book = Record<string, unknown>;
export type BookScreenTabKey = "about" | "highlights" | "community";
export type BookScreenMenuKey = "style" | "cover" | "rejectCover" | "replaceCover";
export type BookScreenReaderRow = { username: string; avatarUrl: string | null; readerGlyph?: IdentityKey; status: string; linksToProfile: boolean };

export type BookScreenModel = {
  title: string;
  author: string;
  genres: string[];
  rating: { value: number; label: string } | null;
  meta: string | null;
  cover: { url: string | null; color: string | null };
  edition: { index: number; count: number; label: string; showDots: boolean; mineIndex: number | null } | null;
  addBook: { title: string; author: string; isbn: string | null; coverUrl: string | null } | null;
  primary: "owner" | "add" | null;
  status: { label: string; options: Array<{ value: 0 | 1 | 2; label: string; selected: boolean }> } | null;
  feeling: { label: string; options: Array<{ rating: FinishRating; label: string; selected: boolean }> } | null;
  tabs: Array<{ key: BookScreenTabKey; label: string }>;
  menu: BookScreenMenuKey[];
  about: { summary: string | null; preview: string | null; editions: WorkEdition[]; editionsPreview: WorkEdition[] } | null;
  highlights: Book[];
  community: { countsLabel: string; groups: Array<{ key: string; title: string | null; rows: BookScreenReaderRow[] }>; games: Array<{ key: string; title: string; detail: string; path: string }> } | null;
};

const GENRE_CAP = 3;
const EDITIONS_PREVIEW = 3;
const STATUSES = [0, 1, 2] as const;
const EDITION_DOTS_MAX = 7;

export function bookMetaLine(work: Pick<WorkPage["work"], "year" | "pages">, language: string | null = null): string | null {
  const parts = [
    typeof work.year === "number" ? String(work.year) : null,
    typeof work.pages === "number" ? `${work.pages} ${work.pages === 1 ? "page" : "pages"}` : null,
    language
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}

const readerRow = (reader: WorkReader): BookScreenReaderRow => ({ username: reader.username, avatarUrl: reader.avatarUrl, readerGlyph: reader.readerGlyph, status: readerStatusLabel(reader.readStatus), linksToProfile: reader.published });

function readerGroups({ followed, others }: WorkPage["readers"]) {
  const groups = [
    { key: "followed", heading: "People you follow", rows: followed.map(readerRow) },
    { key: "others", heading: "Other readers", rows: others.map(readerRow) }
  ].filter((group) => group.rows.length > 0);
  return groups.map(({ key, heading, rows }) => ({ key, title: groups.length > 1 ? heading : null, rows }));
}

function gameRows(games: WorkPage["games"]) {
  const kinds: Array<[string, string, WorkGameRef[]]> = [["tierlist", "Tier list", games.tierlists], ["arena", "Tournament", games.arenas], ["quiz", "Quiz", games.quizzes]];
  return kinds.flatMap(([key, label, list]) => list.map((game) => ({ key: `${key}-${game.id}`, title: game.name, detail: `${label} · ${gameOwnerLabel(game.owner)}`, path: game.path })));
}

const withCount = (label: string, count: number) => (count > 0 ? `${label} (${count})` : label);

function defaultEditionIndex(work: WorkPage["work"]) {
  const mineIndex = work.editions.findIndex((edition) => edition.mine);
  const coverIndex = work.coverUrl === null ? -1 : work.editions.findIndex((edition) => edition.coverUrl === work.coverUrl);
  return [mineIndex, coverIndex].find((found) => found !== -1) ?? 0;
}

function editionState(work: WorkPage["work"], index: number) {
  const { editions } = work;
  const mineIndex = editions.findIndex((edition) => edition.mine);
  const position = `${index + 1} of ${editions.length}`;
  return {
    index,
    count: editions.length,
    label: index === mineIndex ? `Your edition · ${position}` : `Edition ${position}`,
    showDots: editions.length <= EDITION_DOTS_MAX,
    mineIndex: mineIndex === -1 ? null : mineIndex
  };
}

export function bookScreenModel(page: WorkPage | null, book: Book | null, viewer: { isAdmin: boolean }, editionId: string | null = null): BookScreenModel {
  const highlights = Array.isArray(book?.highlights) ? (book.highlights as Book[]).filter((h) => String(h.Text ?? "").trim() !== "") : [];
  const readStatus = book ? (book.ReadStatus === 1 || book.ReadStatus === 2 ? book.ReadStatus : 0) : null;
  const rating = typeof book?.Rating === "number" ? book.Rating : null;
  const work = page?.work;
  const picked = editionId === null ? undefined : work?.editions.find((edition) => edition.bookId === editionId);
  const selected = work && picked && work.editions.indexOf(picked) !== defaultEditionIndex(work) ? picked : undefined;
  const primary = book ? "owner" : page?.mine ? null : "add";
  const tabs: Array<{ key: BookScreenTabKey; label: string }> = [
    ...(page ? [{ key: "about" as const, label: "About" }] : []),
    ...(book ? [{ key: "highlights" as const, label: withCount("Highlights", highlights.length) }] : []),
    ...(page ? [{ key: "community" as const, label: withCount("Community", page.readers.counts.readers) }] : [])
  ];
  const menu: BookScreenMenuKey[] = [...(book ? (["style", "cover"] as const) : []), ...(viewer.isAdmin && !selected ? (["rejectCover", "replaceCover"] as const) : [])];
  return {
    title: selected?.title ?? work?.title ?? String(book?.Title ?? "Untitled"),
    author: work?.author ?? String(book?.Attribution ?? "Unknown author"),
    genres: work ? work.genres ?? [] : book ? genresForBook(book).slice(0, GENRE_CAP) : [],
    rating: work?.rating ? { value: work.rating.value, label: `${work.rating.value.toFixed(1)} · ${ratingCountLabel(work.rating.count)}` } : null,
    meta: selected ? bookMetaLine(selected, selected.language) : work ? bookMetaLine(work) : null,
    cover: selected ? { url: selected.coverUrl, color: selected.coverColor } : { url: work?.coverUrl ?? null, color: work?.coverColor ?? null },
    edition: work && work.editions.length >= 2 ? editionState(work, selected ? work.editions.indexOf(selected) : defaultEditionIndex(work)) : null,
    addBook: work && primary === "add" ? { title: work.title, author: work.author, isbn: selected ? selected.isbn : work.editions.find((edition) => edition.isbn)?.isbn ?? null, coverUrl: selected ? selected.coverUrl : work.coverUrl } : null,
    primary,
    status: readStatus === null ? null : { label: statusLabel(readStatus), options: STATUSES.map((value) => ({ value, label: statusLabel(value), selected: value === readStatus })) },
    feeling: readStatus === 2 ? {
      label: FINISH_FEELINGS.find((feeling) => feeling.rating === rating)?.label ?? "How did it land?",
      options: FINISH_FEELINGS.map((feeling) => ({ rating: feeling.rating as FinishRating, label: feeling.label as string, selected: feeling.rating === rating }))
    } : null,
    tabs,
    menu,
    about: work ? { summary: work.summary, preview: work.summary ? summaryPreview(work.summary) : null, editions: work.editions, editionsPreview: work.editions.slice(0, EDITIONS_PREVIEW) } : null,
    highlights,
    community: page ? { countsLabel: readerCountsLabel(page.readers.counts), groups: readerGroups(page.readers), games: gameRows(page.games) } : null
  };
}
