import { seriesNameKey } from "./series.js";

export type WorkSubjects = { person: string[]; place: string[]; time: string[] };
export type CleanedSubjects = { subjects: WorkSubjects; gatedOut: boolean };

const FICTION = /(?<![\p{L}\p{N}])(?:fiction|ficción|ficção|novels?|romance|romans)(?![\p{L}\p{N}])/iu;
const NON_FICTION = /non-?fiction/i;
const CHARACTER_QUALIFIER = /\s*\((?:fictional|fictitious|legendary|mythical) character\)\s*$/i;
const FICTIONAL_QUALIFIER = /\((?:fictional|fictitious) character\)\s*$/i;
const LIFE_DATES = /\d{3,}/;
const HONORIFICS = new Set(["mr", "mrs", "ms", "miss", "dr", "sir", "lady"]);

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function personNameKey(name: string): string | null {
  const key = seriesNameKey(name);
  if (!key) return null;
  const words = key.split(" ");
  return words.length >= 3 && HONORIFICS.has(words[0]!) ? words.slice(1).join(" ") : key;
}

function uniqueByKey(names: string[], keyOf: (name: string) => string | null, preferShorter: boolean): string[] {
  const entries = new Map<string, string>();
  for (const name of names) {
    const key = keyOf(name);
    if (!key) continue;
    const current = entries.get(key);
    if (current === undefined || (preferShorter && name.split(/\s+/).length < current.split(/\s+/).length)) entries.set(key, name);
  }
  return [...entries.values()];
}

export function cleanWorkSubjects(raw: { people: unknown; places: unknown; times: unknown; subjects: unknown; authors: unknown }): CleanedSubjects {
  const people = strings(raw.people);
  const isFiction = strings(raw.subjects).some((subject) => FICTION.test(subject) && !NON_FICTION.test(subject)) || people.some((name) => FICTIONAL_QUALIFIER.test(name.trim()));
  const place = uniqueByKey(strings(raw.places).map((name) => name.trim()), seriesNameKey, false);
  const time = uniqueByKey(strings(raw.times).map((name) => name.trim()), seriesNameKey, false);
  if (!isFiction) return { subjects: { person: [], place, time }, gatedOut: people.length > 0 };
  const authorKeys = new Set(strings(raw.authors).map(personNameKey));
  const names = people
    .map((name) => name.trim().replace(CHARACTER_QUALIFIER, "").trim())
    .filter((name) => name && !LIFE_DATES.test(name) && !authorKeys.has(personNameKey(name)));
  return { subjects: { person: uniqueByKey(names, personNameKey, true), place, time }, gatedOut: false };
}
