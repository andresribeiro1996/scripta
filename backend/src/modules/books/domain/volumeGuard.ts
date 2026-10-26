import { normalizeWords, titleNumbers, withoutBrackets } from "@scripta/shared";
import { withoutArticle } from "./searchRank.js";
import { seriesNameKey } from "./series.js";
import { VOLUME_WORD, VOLUME_WORDS, mainTitle } from "./translation.js";

export type JoinVerdict = "join" | "review" | "never";

const ROMAN = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"];
const NUMBER_WORDS = [
  ["one", "um", "primeiro", "primeira"],
  ["two", "dois", "segundo", "segunda"],
  ["three", "tres", "terceiro", "terceira"],
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

const SPELLED_VOLUME = new RegExp(String.raw`\b(?:${VOLUME_WORDS.join("|")})\s?(\d+|[ivx]{1,4}|${NUMBER_WORDS.flat().join("|")})\b`, "g");

function volumeNumbers(text: string): string[] {
  const numbers: Array<string | null> = [];
  const hash = /#\s*(\d+)/.exec(text);
  if (hash) numbers.push(String(Number(hash[1])));
  const words = normalizeWords(text);
  for (const marker of words.matchAll(SPELLED_VOLUME)) numbers.push(toArabic(marker[1]!));
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

const STEM_END = new RegExp(String.raw`\s+(?:(?:${VOLUME_WORDS.join("|")})\.?\s+)?#?\s*\S+$`, "i");

function seriesStem(main: string): string {
  return main.replace(STEM_END, "");
}

const NUMBERED_END = /(?:#|\bn\.?\s*[º°]|\bno\.)\s*\d+\s*$/i;

type EndMarker = { n: string; strong: boolean; word: boolean };

function endMarker(title: string): EndMarker | null {
  if (NUMBERED_END.test(title)) return null;
  const words = normalizeWords(title).split(" ");
  const last = words.at(-1)!;
  const n = last === "x" ? null : toArabic(last);
  if (n === null || words.length < 2) return null;
  if (VOLUME_WORDS.includes(words.at(-2)!)) return { n, strong: true, word: true };
  if (/^\d+$/.test(last)) return last.length === 1 ? { n, strong: false, word: false } : null;
  return ROMAN.includes(last) ? { n, strong: true, word: false } : null;
}

export type JoinTarget = { title: string; series: Array<{ nameKey: string; position: string | null }> };

const SERIES_WORDS = ["serie", "series", "saga", "ciclo", "cycle", "cronica", "cronicas", "chronicles", "trilogia", "trilogy", "tetralogia", "colecao", "coleccao"];

function showsSeriesContext(workTitle: string, target: JoinTarget): boolean {
  const padded = ` ${normalizeWords(workTitle)} `;
  return SERIES_WORDS.some((word) => padded.includes(` ${word} `)) ||
    target.series.some((entry) => {
      const key = withoutArticle(entry.nameKey);
      return key.length >= 3 && padded.includes(` ${key} `);
    });
}

export function joinVerdict(work: { title: string }, target: JoinTarget, memberKind: (title: string) => "series" | "collection" | null): JoinVerdict {
  const workTitle = withVolumeBrackets(work.title);
  const targetTitle = withVolumeBrackets(target.title);
  const marker = endMarker(workTitle);
  const positionsCount = !marker?.word || showsSeriesContext(work.title, target);
  const targetNumbers = new Set([
    ...titleNumbers(targetTitle).split(" ").filter((digits) => digits !== "").map((digits) => String(Number(digits))),
    ...volumeNumbers(targetTitle),
    ...[endMarker(targetTitle)?.n ?? []].flat(),
    ...(positionsCount ? target.series.flatMap((entry) => [...(entry.position ?? "").matchAll(/\d+/g)].map((digits) => String(Number(digits[0])))) : [])
  ]);
  if (marker && !targetNumbers.has(marker.n)) {
    const main = mainTitle(workTitle);
    if (main.length === workTitle.length) {
      const free = marker.strong && !workTitle.includes("..") && memberKind(seriesStem(main)) === null;
      return free ? "never" : "review";
    }
    if (marker.word) return "review";
  }
  const kind = memberKind(target.title);
  if (kind === "series") {
    const key = seriesNameKey(target.title);
    if (!target.series.some((entry) => entry.nameKey === key && entry.position !== null && Number(entry.position) === 1)) return "review";
  } else if (kind === "collection" && volumeNumber(work.title) !== null) return "review";
  if (isOmnibusTitle(target.title) && !isOmnibusTitle(work.title)) return "review";
  return "join";
}
