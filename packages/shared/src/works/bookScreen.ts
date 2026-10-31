import type { Locale } from "../i18n/locale.js";
import { sharedT } from "../i18n/sharedT.js";
import { genreLabel, genresForBook, isBookGenre } from "../library/bookGenres.js";
import type { BookSeries } from "../library/bookSearch.js";
import { statusLabel } from "../library/covers.js";
import { finishFeelings, type FinishRating } from "../library/finish.js";
import type { IdentityKey } from "../readerCards/index.js";
import { PRIZES, awardLabel, knownAwards, prizeLabel } from "./awards.js";
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
  authorAwards: string | null;
  awards: Array<{ label: string; won: boolean }>;
  characters: { shown: string[]; more: string[]; canMakeGame: boolean };
  genres: string[];
  possibleGenres: string[];
  series: BookSeries | null;
  rating: { value: number; label: string } | null;
  year: number | null;
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

export const CHARACTERS_SHOWN = 8;
const GENRE_CAP = 3;
const EDITIONS_PREVIEW = 3;
const STATUSES = [0, 1, 2] as const;
const EDITION_DOTS_MAX = 7;

export function bookMetaLine(work: Pick<WorkPage["work"], "year" | "pages">, locale: Locale, language: string | null = null): string | null {
  const parts = [
    typeof work.year === "number" ? String(work.year) : null,
    typeof work.pages === "number" ? sharedT(locale)("shared.bookScreen.pages", { count: work.pages }) : null,
    language
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}

const readerRow = (reader: WorkReader, locale: Locale): BookScreenReaderRow => ({ username: reader.username, avatarUrl: reader.avatarUrl, readerGlyph: reader.readerGlyph, status: readerStatusLabel(reader.readStatus, locale), linksToProfile: reader.published });

function readerGroups({ followed, others }: WorkPage["readers"], locale: Locale) {
  const t = sharedT(locale);
  const groups = [
    { key: "followed", heading: t("shared.bookScreen.followedReaders"), rows: followed.map((reader) => readerRow(reader, locale)) },
    { key: "others", heading: t("shared.bookScreen.otherReaders"), rows: others.map((reader) => readerRow(reader, locale)) }
  ].filter((group) => group.rows.length > 0);
  return groups.map(({ key, heading, rows }) => ({ key, title: groups.length > 1 ? heading : null, rows }));
}

function gameRows(games: WorkPage["games"], locale: Locale) {
  const t = sharedT(locale);
  const kinds: Array<[string, string, WorkGameRef[]]> = [["tierlist", t("shared.helpers.kindTierlist"), games.tierlists], ["arena", t("shared.helpers.kindTournament"), games.arenas], ["quiz", t("shared.helpers.kindQuiz"), games.quizzes]];
  return kinds.flatMap(([key, label, list]) => list.map((game) => ({ key: `${key}-${game.id}`, title: game.name, detail: t("shared.bookScreen.gameDetail", { kind: label, owner: gameOwnerLabel(game.owner) }), path: game.path })));
}

function awardLines(awards: WorkPage["work"]["awards"], locale: Locale) {
  const known = knownAwards(awards);
  const authorParts = known.filter((award) => PRIZES[award.prize].honours === "author").map((award) => `${prizeLabel(award.prize, locale)} ${award.year}`);
  return {
    awards: known.filter((award) => PRIZES[award.prize].honours === "work").map((award) => ({ label: awardLabel(award, locale), won: award.won })),
    authorAwards: authorParts.length > 0 ? authorParts.join(" · ") : null
  };
}

const genreName = (genre: string, locale: Locale) => (isBookGenre(genre) ? genreLabel(genre, locale) : genre);

const withCount = (label: string, count: number) => (count > 0 ? `${label} (${count})` : label);

function defaultEditionIndex(work: WorkPage["work"]) {
  const mineIndex = work.editions.findIndex((edition) => edition.mine);
  const coverIndex = work.coverUrl === null ? -1 : work.editions.findIndex((edition) => edition.coverUrl === work.coverUrl);
  return [mineIndex, coverIndex].find((found) => found !== -1) ?? 0;
}

function editionState(work: WorkPage["work"], index: number, owned: boolean, locale: Locale) {
  const t = sharedT(locale);
  const { editions } = work;
  const found = editions.findIndex((edition) => edition.mine);
  const mineIndex = found === -1 && owned ? defaultEditionIndex(work) : found;
  const position = t("shared.bookScreen.position", { index: index + 1, count: editions.length });
  return {
    index,
    count: editions.length,
    label: t(index === mineIndex ? "shared.bookScreen.yourEdition" : "shared.bookScreen.edition", { position }),
    showDots: editions.length <= EDITION_DOTS_MAX,
    mineIndex: mineIndex === -1 ? null : mineIndex
  };
}

export function bookScreenModel(page: WorkPage | null, book: Book | null, viewer: { isAdmin: boolean }, locale: Locale, editionId: string | null = null): BookScreenModel {
  const t = sharedT(locale);
  const feelings = finishFeelings(locale);
  const highlights = Array.isArray(book?.highlights) ? (book.highlights as Book[]).filter((h) => String(h.Text ?? "").trim() !== "") : [];
  const readStatus = book ? (book.ReadStatus === 1 || book.ReadStatus === 2 ? book.ReadStatus : 0) : null;
  const rating = typeof book?.Rating === "number" ? book.Rating : null;
  const work = page?.work;
  const picked = editionId === null ? undefined : work?.editions.find((edition) => edition.bookId === editionId);
  const selected = work && picked && work.editions.indexOf(picked) !== defaultEditionIndex(work) ? picked : undefined;
  const displayed = work ? selected ?? work.editions[defaultEditionIndex(work)] : undefined;
  const primary = book ? "owner" : page?.mine ? null : "add";
  const tabs: Array<{ key: BookScreenTabKey; label: string }> = [
    ...(page ? [{ key: "about" as const, label: t("shared.bookScreen.tabAbout") }] : []),
    ...(book ? [{ key: "highlights" as const, label: withCount(t("shared.bookScreen.tabHighlights"), highlights.length) }] : []),
    ...(page ? [{ key: "community" as const, label: withCount(t("shared.bookScreen.tabCommunity"), page.readers.counts.readers) }] : [])
  ];
  const { awards, authorAwards } = awardLines(work?.awards, locale);
  const menu: BookScreenMenuKey[] = [...(book ? (["style", "cover"] as const) : []), ...(viewer.isAdmin && !selected ? (["rejectCover", "replaceCover"] as const) : [])];
  return {
    title: selected?.title ?? work?.title ?? String(book?.Title ?? t("shared.arenaSeed.untitled")),
    author: work?.author ?? String(book?.Attribution ?? t("shared.arenaSeed.unknownAuthor")),
    authorAwards,
    awards,
    characters: { shown: (work?.characters ?? []).slice(0, CHARACTERS_SHOWN), more: (work?.characters ?? []).slice(CHARACTERS_SHOWN), canMakeGame: (work?.characters ?? []).length >= 4 },
    genres: work ? (work.genres ?? []).map((genre) => genreName(genre, locale)) : book ? genresForBook(book).slice(0, GENRE_CAP).map((genre) => genreLabel(genre, locale)) : [],
    possibleGenres: (work?.possibleGenres ?? []).map((genre) => genreName(genre, locale)),
    series: work ? work.series ?? displayed?.collection ?? null : null,
    rating: work?.rating ? { value: work.rating.value, label: t("shared.bookScreen.ratingLabel", { value: work.rating.value.toFixed(1), ratings: ratingCountLabel(work.rating.count, locale) }) } : null,
    year: work ? displayed?.year ?? work.year : null,
    meta: selected ? bookMetaLine(selected, locale, selected.language) : work ? bookMetaLine(work, locale) : null,
    cover: selected ? { url: selected.coverUrl, color: selected.coverColor } : { url: work?.coverUrl ?? null, color: work?.coverColor ?? null },
    edition: work && work.editions.length >= 2 ? editionState(work, selected ? work.editions.indexOf(selected) : defaultEditionIndex(work), book !== null, locale) : null,
    addBook: work && primary === "add" ? { title: work.title, author: work.author, isbn: displayed?.isbn ?? (picked ? null : work.editions.find((edition) => edition.isbn)?.isbn ?? null), coverUrl: selected ? selected.coverUrl : work.coverUrl } : null,
    primary,
    status: readStatus === null ? null : { label: statusLabel(readStatus, locale), options: STATUSES.map((value) => ({ value, label: statusLabel(value, locale), selected: value === readStatus })) },
    feeling: readStatus === 2 ? {
      label: feelings.find((feeling) => feeling.rating === rating)?.label ?? t("shared.finish.howDidItLand"),
      options: feelings.map((feeling) => ({ rating: feeling.rating, label: feeling.label, selected: feeling.rating === rating }))
    } : null,
    tabs,
    menu,
    about: work ? { summary: work.summary, preview: work.summary ? summaryPreview(work.summary) : null, editions: work.editions, editionsPreview: work.editions.slice(0, EDITIONS_PREVIEW) } : null,
    highlights,
    community: page ? { countsLabel: readerCountsLabel(page.readers.counts, locale), groups: readerGroups(page.readers, locale), games: gameRows(page.games, locale) } : null
  };
}
