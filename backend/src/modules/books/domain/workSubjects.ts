import { seriesNameKey } from "./series.js";

export type WorkSubjects = { person: string[]; place: string[]; time: string[] };
export type RawWorkSubjects = { people: unknown; places: unknown; times: unknown; subjects: unknown; authors: unknown };
export type CleanedSubjects = { subjects: WorkSubjects; gatedOut: boolean };

const FICTION = /(?<![\p{L}\p{N}])(?:fiction|ficción|ficção|novels?|romance|romans)(?![\p{L}\p{N}])/iu;
const NON_FICTION = /non-?fiction/i;
const CHARACTER_QUALIFIER = /\s*\((?:fictional|fictitious|legendary|mythical) character\)\s*$/i;
const FICTIONAL_QUALIFIER = /\((?:fictional|fictitious) character\)\s*$/i;
const TRAILING_PARENTHETICAL = /\s*\([^()]*\)\s*$/;
const OTHER_LANGUAGE_QUALIFIER = /\((?:personaje|personnage|personagem|personaggio|mythologie|mitolog)/i;
const LIFE_DATES = /\d{3,}/;
const HONORIFICS = new Set(["mr", "mrs", "ms", "miss", "dr", "sir", "lady"]);

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function personWords(name: string): string[] | null {
  const key = seriesNameKey(name);
  if (!key) return null;
  const words = key.split(" ");
  return words.length >= 3 && HONORIFICS.has(words[0]!) ? words.slice(1) : words;
}

export function personNameKey(name: string): string | null {
  const words = personWords(name);
  return words ? [...words].sort().join(" ") : null;
}

function cleanPersonName(name: string): string {
  const stripped = name.replace(TRAILING_PARENTHETICAL, "").trim();
  const parts = stripped.split(",").map((part) => part.trim());
  return parts.length === 2 && parts[0] && parts[1] ? `${parts[1]} ${parts[0]}` : stripped;
}

function wordCount(name: string): number {
  return name.split(/\s+/).length;
}

function mergeAliases(names: string[]): string[] {
  const entries = names.map((name) => ({ name, words: personWords(name) ?? [] }));
  const sets = entries.map((entry) => new Set(entry.words));
  const parent = entries.map((_, index) => index);
  const singleAliases = new Set<number>();
  const rootOf = (index: number): number => (parent[index] === index ? index : rootOf(parent[index]!));
  entries.forEach((entry, index) => {
    if (entry.words.length < 2) return;
    const superset = entries.findIndex((_, other) => other !== index && sets[other]!.size > sets[index]!.size && entry.words.every((word) => sets[other]!.has(word)));
    if (superset >= 0) parent[index] = superset;
  });
  entries.forEach((entry, index) => {
    if (entry.words.length !== 1) return;
    const roots = new Set<number>();
    entries.forEach((other, otherIndex) => {
      if (otherIndex !== index && other.words[0] === entry.words[0]) roots.add(rootOf(otherIndex));
    });
    if (roots.size === 1) {
      parent[index] = [...roots][0]!;
      singleAliases.add(index);
    }
  });
  const groups = new Map<number, string>();
  entries.forEach((entry, index) => {
    const root = rootOf(index);
    if (!groups.has(root)) groups.set(root, "");
    if (singleAliases.has(index)) return;
    const current = groups.get(root);
    if (!current || wordCount(entry.name) < wordCount(current)) groups.set(root, entry.name);
  });
  return [...groups.values()];
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

export function cleanWorkSubjects(raw: RawWorkSubjects): CleanedSubjects {
  const people = strings(raw.people);
  const isFiction = strings(raw.subjects).some((subject) => FICTION.test(subject) && !NON_FICTION.test(subject)) || people.some((name) => FICTIONAL_QUALIFIER.test(name.trim()));
  const place = uniqueByKey(strings(raw.places).map((name) => name.trim()), seriesNameKey, false);
  const time = uniqueByKey(strings(raw.times).map((name) => name.trim()), seriesNameKey, false);
  if (!isFiction) return { subjects: { person: [], place, time }, gatedOut: people.length > 0 };
  const authorKeys = new Set(strings(raw.authors).map(personNameKey));
  const names = people
    .filter((name) => !OTHER_LANGUAGE_QUALIFIER.test(name))
    .map((name) => name.trim().replace(CHARACTER_QUALIFIER, "").trim())
    .filter((name) => !LIFE_DATES.test(name))
    .map(cleanPersonName)
    .filter((name) => name && !authorKeys.has(personNameKey(name)));
  return { subjects: { person: mergeAliases(uniqueByKey(names, personNameKey, true)), place, time }, gatedOut: false };
}
