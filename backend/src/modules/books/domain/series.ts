import { normalizeWords } from "./normalize.js";

export type SeriesSource = "wikidata" | "hardcover" | "ol-edition" | "ol-subject" | "original-title";
export type CollectionSource = "bnp" | "ol-edition";
export type SeriesEntry = { name: string; position: string | null };

export const SERIES_SOURCE_RANK: Record<SeriesSource, number> = { wikidata: 0, hardcover: 1, "ol-edition": 2, "ol-subject": 3, "original-title": 4 };
export const SERIES_SOURCES = Object.keys(SERIES_SOURCE_RANK) as SeriesSource[];

export type SeriesRow = { root: string; name: string; nameKey: string; position: string | null; source: SeriesSource; createdAt: string };
export type CollectionRow = { root: string; name: string; nameKey: string; position: string | null; createdAt: string };
export type SeriesMatch = { nameKey: string; name: string; exact: boolean; members: Array<{ workId: string; position: string | null }> };
type SeriesCandidate = SeriesEntry & { nameKey: string; source: SeriesSource; rank: number; createdAt: string };

export function seriesNameKey(name: string): string | null {
  return normalizeWords(name) || null;
}

const WORD_NUMBERS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];
const SERIES_SUBJECT = /^series:/i;
const NUMBER = "\\d+(?:\\.\\d+)?";
const SHORT_NUMBER = "\\d{1,3}(?:\\.\\d+)?";
const MARKER = "(?:book\\s+|(?:bk|vol|v|no)\\.\\s*)";
const MARKED_NUMBER = `${MARKER}(${NUMBER}|${WORD_NUMBERS.join("|")})`;
const TRAILING_SEPARATORS = /[\s,;:–—-]+$/;
const TRAILING_YEAR = /^(.*)\(\s*\d{4}\s*\)$/;
const POSITION_FORMS = [
  new RegExp(`^(.*)\\(\\s*(?:${MARKED_NUMBER}|(${SHORT_NUMBER}))\\s*\\)$`, "i"),
  new RegExp(`^(.*)#\\s*(${SHORT_NUMBER})$`),
  new RegExp(`^(.*)(?:(?:,|;|:|--)\\s*${MARKED_NUMBER}|(?:(?:,|;)\\s+|\\s[–—]\\s+)(${SHORT_NUMBER}))$`, "i")
];

function entryOf(name: string, position: string | null): SeriesEntry | null {
  const trimmed = name.replace(TRAILING_SEPARATORS, "");
  return seriesNameKey(trimmed) ? { name: trimmed, position } : null;
}

export function parseSeriesString(raw: string): SeriesEntry | null {
  const trimmed = raw.trim();
  const text = (TRAILING_YEAR.exec(trimmed)?.[1] ?? trimmed).trim();
  for (const form of POSITION_FORMS) {
    const match = form.exec(text);
    if (!match) continue;
    const position = (match[2] ?? match[3])!;
    const word = WORD_NUMBERS.indexOf(position.toLowerCase());
    return entryOf(match[1]!, word < 0 ? position : String(word + 1));
  }
  return entryOf(text, null);
}

export function seriesFromSubjects(subjects: unknown): SeriesEntry[] {
  return (Array.isArray(subjects) ? subjects : []).flatMap((subject) =>
    typeof subject === "string" && SERIES_SUBJECT.test(subject) ? parseSeriesString(subject.replace(SERIES_SUBJECT, "").replaceAll("_", " ")) ?? [] : []
  );
}

export function pickSeries(rows: SeriesRow[], collections: CollectionRow[]): Map<string, SeriesEntry & { nameKey: string }> {
  const best = new Map<string, SeriesEntry & { nameKey: string }>();
  const candidates = new Map<string, SeriesCandidate[]>();
  for (const row of rows) {
    const candidate = { name: row.name, position: row.position, nameKey: row.nameKey, source: row.source, rank: SERIES_SOURCE_RANK[row.source], createdAt: row.createdAt };
    const list = candidates.get(row.root) ?? [];
    list.push(candidate);
    candidates.set(row.root, list);
  }
  for (const row of collections) {
    const named = candidates.get(row.root);
    if (named?.some((candidate) => candidate.nameKey === row.nameKey && (candidate.source === "wikidata" || candidate.source === "hardcover" || candidate.source === "ol-subject"))) {
      named.push({ name: row.name, position: row.position, nameKey: row.nameKey, source: "ol-edition", rank: SERIES_SOURCE_RANK["ol-edition"], createdAt: row.createdAt });
    }
  }
  for (const [root, list] of candidates) {
    list.sort((left, right) => left.rank - right.rank || (left.createdAt < right.createdAt ? -1 : left.createdAt > right.createdAt ? 1 : 0));
    const top = list[0]!;
    best.set(root, { name: top.name, nameKey: top.nameKey, position: list.find((candidate) => candidate.nameKey === top.nameKey && candidate.position !== null)?.position ?? null });
  }
  return best;
}

export function rankSeriesMatches(
  names: Map<string, { name: string; exact: boolean }>,
  rows: Array<{ workId: string; nameKey: string; position: string | null; source: SeriesSource }>
): SeriesMatch[] {
  const bestRank = new Map<string, number>();
  const members = new Map<string, Map<string, { position: string | null; rank: number }>>();
  for (const row of rows) {
    const own = members.get(row.nameKey) ?? new Map<string, { position: string | null; rank: number }>();
    const rank = SERIES_SOURCE_RANK[row.source];
    bestRank.set(row.nameKey, Math.min(bestRank.get(row.nameKey) ?? rank, rank));
    const seen = own.get(row.workId);
    if (!seen || rank < seen.rank) own.set(row.workId, { position: row.position, rank });
    members.set(row.nameKey, own);
  }
  return [...names].map(([nameKey, { name, exact }]) => ({
    nameKey,
    name,
    exact,
    members: [...(members.get(nameKey) ?? [])].map(([workId, { position }]) => ({ workId, position }))
  })).sort((a, b) => Number(b.exact) - Number(a.exact) || b.members.length - a.members.length || (bestRank.get(a.nameKey) ?? Infinity) - (bestRank.get(b.nameKey) ?? Infinity));
}
