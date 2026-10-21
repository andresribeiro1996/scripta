import { LOOSE_METADATA_LABEL, STRICT_METADATA_LABEL, firstAuthor, normalizeTitle, normalizeWords, titleNumbers } from "@scripta/shared";

const ORIGINAL_TITLE = /T[íi]tulo original\s*[:\-–—]?\s*([^\n]+)/i;
const MAX_ORIGINAL_TITLE = 200;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const STARTS_WITH_LABEL = new RegExp(String.raw`^[\s\-–—•*·|]*(?:ISBN\b|(?:${STRICT_METADATA_LABEL}|${LOOSE_METADATA_LABEL})(?:\s*:|\s+[-–—]|\s*$)|(?:Tradu[çc][ãa]o|Traduzido|Tradutor[a]?)\s+(?:de|por)\b)`, "i");

export function isOriginalTitle(value: string): boolean {
  return LETTER_OR_DIGIT.test(value) && !STARTS_WITH_LABEL.test(value);
}

export function originalTitleIn(text: string | null): string | null {
  const value = (ORIGINAL_TITLE.exec(text ?? "")?.[1] ?? "").trim().replace(/[.;,\s]+$/, "");
  return isOriginalTitle(value) && value.length <= MAX_ORIGINAL_TITLE ? value : null;
}

export function mainTitle(title: string): string {
  return title.split(/ — | – | - |\. /)[0]!.trim();
}

export function sameMainTitle(a: string, b: string): boolean {
  const left = normalizeTitle(mainTitle(a));
  return left !== "" && left === normalizeTitle(mainTitle(b)) && titleNumbers(mainTitle(a)) === titleNumbers(mainTitle(b));
}

export const MATCH_MERGE_AT = 0.9;
export const MATCH_REVIEW_AT = 0.5;
export const MAX_CANDIDATES = 40;

export type TranslationEvidence = { workId: string; title: string; author: string; workAuthor: string; publisher: string | null; summary: string | null; originalTitle: string | null; summaries: string[] };

const globLiteral = (value: string) => value.replace(/[*?[]/g, "[$&]");

export function isPortuguese(language: string | null): boolean {
  return language === "pt" || (language?.startsWith("pt-") ?? false);
}

export function titlePattern(title: string): string | null {
  const main = mainTitle(title);
  const normalized = normalizeTitle(main);
  return normalized ? `ta:${globLiteral(normalized)}|*|${globLiteral(titleNumbers(main))}` : null;
}

export function authorPattern(author: string): string | null {
  const first = firstAuthor(author);
  return first ? `${globLiteral(first)}|*` : null;
}

export function surnameOf(author: string): string | null {
  return firstAuthor(author).split(" ").filter((word) => word.length >= 3).at(-1) ?? null;
}

const VOLUME_WORD = /\b(?:book|bk|vol|volume|livro|tomo|tome|part|parte)\s?(?:\d+|[ivx]{1,4}|one|two|three|four|five|six|seven|eight|nine|ten|um|dois|tres|quatro|cinco|seis|sete|oito|nove|dez)\b/;

export function hasVolumeMarker(title: string): boolean {
  return /#\s*\d/.test(title) || VOLUME_WORD.test(normalizeWords(title));
}

export const SERIES_LIKE_TITLES = 3;

export function originalKey(title: string): string | null {
  const main = mainTitle(title);
  const normalized = normalizeTitle(main);
  return normalized === "" ? null : `${normalized}|${titleNumbers(main)}`;
}

export type OriginalClaim = { workId: string | null; title: string; author: string; language: string | null; originalTitle: string };
export type SeriesLike = (originalTitle: string, author: string) => boolean;
export type SeriesLikeGroup = { originalTitle: string; titles: string[]; workIds: string[] };

const groupOf = (original: string, author: string) => `${original}#${surnameOf(author) ?? ""}`;

type ClaimGroup = { originalTitle: string; titles: Map<string, string>; workIds: Set<string> };

function claimGroups(claims: OriginalClaim[]): Map<string, ClaimGroup> {
  const groups = new Map<string, ClaimGroup>();
  for (const claim of claims) {
    if (!isPortuguese(claim.language) || sameMainTitle(claim.title, claim.originalTitle)) continue;
    const original = originalKey(claim.originalTitle);
    const title = originalKey(claim.title);
    if (original === null || title === null) continue;
    const key = groupOf(original, claim.author);
    const group = groups.get(key) ?? { originalTitle: mainTitle(claim.originalTitle), titles: new Map<string, string>(), workIds: new Set<string>() };
    if (!group.titles.has(title)) group.titles.set(title, claim.title);
    if (claim.workId !== null) group.workIds.add(claim.workId);
    groups.set(key, group);
  }
  return groups;
}

export function seriesLikeOriginals(claims: OriginalClaim[]): SeriesLike {
  const qualifying = new Set([...claimGroups(claims)].filter(([, group]) => group.titles.size >= SERIES_LIKE_TITLES).map(([key]) => key));
  return (originalTitle, author) => {
    const original = originalKey(originalTitle);
    return original !== null && qualifying.has(groupOf(original, author));
  };
}

export function seriesLikeGroups(claims: OriginalClaim[]): SeriesLikeGroup[] {
  return [...claimGroups(claims).values()]
    .filter((group) => group.titles.size >= SERIES_LIKE_TITLES)
    .map(({ originalTitle, titles, workIds }) => ({ originalTitle, titles: [...titles.values()], workIds: [...workIds] }));
}

export function mentionsSurname(texts: Array<string | null>, surname: string): boolean {
  return texts.some((text) => text !== null && ` ${normalizeWords(text)} `.includes(` ${surname} `));
}

export function evidenceOf(rows: { workId: string; workAuthor: string; editions: Array<{ title: string; author: string; publisher: string | null; summary: string | null; originalTitle: string | null }> }): TranslationEvidence {
  const first = (values: Array<string | null>) => values.find((value): value is string => Boolean(value?.trim())) ?? null;
  const editions = rows.editions;
  return {
    workId: rows.workId,
    title: first(editions.map((edition) => edition.title)) ?? "",
    author: first(editions.map((edition) => edition.author)) ?? rows.workAuthor,
    workAuthor: rows.workAuthor,
    publisher: first(editions.map((edition) => edition.publisher)),
    summary: first(editions.map((edition) => edition.summary)),
    originalTitle: first(editions.map((edition) => edition.originalTitle ?? originalTitleIn(edition.summary))),
    summaries: editions.flatMap((edition) => (edition.summary?.trim() ? [edition.summary] : []))
  };
}

export const ORIGINAL_KEY_VERSION = 1;

export function arrivalKey(titleKey: string): string | null {
  const parts = titleKey.split("|");
  return parts.length === 3 && parts[0]!.startsWith("ta:") ? `${parts[0]!.slice(3)}|${parts[2]}` : null;
}
