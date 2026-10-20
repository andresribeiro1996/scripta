import { normalizeWords } from "./normalize.js";

export type SeriesSource = "wikidata" | "ol-edition" | "ol-subject" | "original-title";
export type CollectionSource = "bnp" | "ol-edition";
export type SeriesEntry = { name: string; position: string | null };

export const SERIES_SOURCE_RANK: Record<SeriesSource, number> = { wikidata: 0, "ol-edition": 1, "ol-subject": 2, "original-title": 3 };

export function seriesNameKey(name: string): string | null {
  return normalizeWords(name) || null;
}

const WORD_NUMBERS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];
const SERIES_SUBJECT = /^series:/i;
const POSITION_FORMS = [
  /^(.*)\(\s*(\d+)\s*\)$/,
  /^(.*)#\s*(\d+)$/,
  new RegExp(`^(.*),\\s*book\\s+(\\d+|${WORD_NUMBERS.join("|")})$`, "i"),
  /^(.*);\s*(\d+)$/
];

function entryOf(name: string, position: string | null): SeriesEntry | null {
  const trimmed = name.trim();
  return seriesNameKey(trimmed) ? { name: trimmed, position } : null;
}

export function parseSeriesString(raw: string): SeriesEntry | null {
  const text = raw.trim();
  for (const form of POSITION_FORMS) {
    const match = form.exec(text);
    if (!match) continue;
    const word = WORD_NUMBERS.indexOf(match[2]!.toLowerCase());
    return entryOf(match[1]!, word < 0 ? match[2]! : String(word + 1));
  }
  return entryOf(text, null);
}

export function seriesFromSubjects(subjects: unknown): SeriesEntry[] {
  return (Array.isArray(subjects) ? subjects : []).flatMap((subject) =>
    typeof subject === "string" && SERIES_SUBJECT.test(subject) ? parseSeriesString(subject.replace(SERIES_SUBJECT, "").replaceAll("_", " ")) ?? [] : []
  );
}
