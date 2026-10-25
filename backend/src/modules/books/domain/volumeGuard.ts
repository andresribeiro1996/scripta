import { normalizeWords, titleNumbers, withoutBrackets } from "@scripta/shared";
import { VOLUME_WORD, mainTitle } from "./translation.js";

export type JoinVerdict = "join" | "review" | "never";

const ROMAN = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"];
const NUMBER_WORDS = [
  ["one", "um"],
  ["two", "dois"],
  ["three", "tres"],
  ["four", "quatro"],
  ["five", "cinco"],
  ["six", "seis"],
  ["seven", "sete"],
  ["eight", "oito"],
  ["nine", "nove"],
  ["ten", "dez"]
];

function toArabic(token: string): string | null {
  if (/^\d+$/.test(token)) return String(Number(token));
  const roman = ROMAN.indexOf(token);
  if (roman >= 0) return String(roman + 1);
  const word = NUMBER_WORDS.findIndex((names) => names.includes(token));
  return word >= 0 ? String(word + 1) : null;
}

function trailingNumber(words: string): string | null {
  const parts = words.split(" ");
  const last = parts.at(-1)!;
  if (parts.length >= 2 && (/^\d{1,2}$/.test(last) || last !== "x" && ROMAN.includes(last))) return toArabic(last);
  return null;
}

export function volumeNumber(text: string): string | null {
  const hash = /#\s*(\d+)/.exec(text);
  if (hash) return String(Number(hash[1]));
  const words = normalizeWords(text);
  const marker = VOLUME_WORD.exec(words);
  const marked = marker ? toArabic(marker[1]!) : null;
  if (marked !== null) return marked;
  return trailingNumber(words);
}

function volumeNumbers(text: string): string[] {
  const numbers: Array<string | null> = [];
  const hash = /#\s*(\d+)/.exec(text);
  if (hash) numbers.push(String(Number(hash[1])));
  const words = normalizeWords(text);
  for (const marker of words.matchAll(new RegExp(VOLUME_WORD.source, "g"))) numbers.push(toArabic(marker[1]!));
  for (const segment of text.split(/[,;:]| [-–—] /)) numbers.push(trailingNumber(normalizeWords(segment)));
  return numbers.filter((value) => value !== null);
}

const VOLUME_BRACKET = /\(([^()]*)\)|\[([^\[\]]*)\]/g;

function withVolumeBrackets(title: string): string {
  const kept = title.replace(VOLUME_BRACKET, (group, paren: string | undefined, square: string | undefined) => {
    const content = paren ?? square ?? "";
    const words = normalizeWords(content);
    return VOLUME_WORD.exec(words)?.[0] === words ? ` ${content} ` : group;
  });
  return withoutBrackets(kept).replace(/\s+/g, " ").trim();
}

const OMNIBUS_PHRASES = ["box set", "boxed set", "boxset", "omnibus", "trilogy", "trilogia", "collection", "colectanea", "coletanea", "obra completa", "obras completas"];

export function isOmnibusTitle(title: string): boolean {
  if (title.includes(" / ")) return true;
  const words = ` ${normalizeWords(title)} `;
  return OMNIBUS_PHRASES.some((phrase) => words.includes(` ${phrase} `)) || /\b(?:books|livros) \d+ \d+\b/.test(words);
}

function seriesStem(main: string): string {
  return main.replace(/\s+(?:(?:book|bk|vol|volume|livro|tomo|tome|part|parte)\.?\s+)?#?\s*\S+$/i, "");
}

export function joinVerdict(work: { title: string; originalTitle: string | null }, target: { title: string }, headsSeries: (title: string) => boolean): JoinVerdict {
  const workTitle = withVolumeBrackets(work.title);
  const targetTitle = withVolumeBrackets(target.title);
  const targetNumbers = new Set([...titleNumbers(targetTitle).split(" ").filter((digits) => digits !== "").map((digits) => String(Number(digits))), ...volumeNumbers(targetTitle)]);
  const main = mainTitle(workTitle);
  const mainNumber = volumeNumber(main);
  if (mainNumber !== null && !targetNumbers.has(mainNumber)) {
    const bare = workTitle.slice(main.length).trim() === "" && !headsSeries(seriesStem(main));
    return bare ? "never" : "review";
  }
  const subNumber = volumeNumber(workTitle.slice(main.length));
  if (subNumber !== null && !targetNumbers.has(subNumber)) return "review";
  if (headsSeries(target.title) || (work.originalTitle !== null && headsSeries(work.originalTitle))) return "review";
  if (isOmnibusTitle(target.title) && !isOmnibusTitle(work.title)) return "review";
  return "join";
}
