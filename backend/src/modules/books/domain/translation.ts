import { firstAuthor, normalizeTitle, normalizeWords, titleNumbers } from "@scripta/shared";

const ORIGINAL_TITLE = /T[íi]tulo original\s*[:\-–—]?\s*([^\n]+)/i;
const MAX_ORIGINAL_TITLE = 200;

export function originalTitleIn(text: string | null): string | null {
  const value = (ORIGINAL_TITLE.exec(text ?? "")?.[1] ?? "").trim().replace(/[.;,\s]+$/, "");
  return value !== "" && value.length <= MAX_ORIGINAL_TITLE ? value : null;
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
