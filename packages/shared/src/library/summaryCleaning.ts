import { htmlToText } from "./htmlText.js";
import { cleanCatalogText, fromWindows1252Controls } from "./mojibake.js";

export const STRICT_METADATA_LABEL = String.raw`T[íi]tulo\s+original|Tradu[çc][ãa]o|Tradutor[a]?|Traduzido|P[áa]ginas|N\.?\s?[º°o]\.?\s*de\s+P[áa]ginas|N[úu]m\.?\s*p[áa]g\w*\.?|Dimens[õo]es|Encaderna[çc][ãa]o|Formato(?:\s+Capa)?|Peso|Categoria|Sub-?\s?categoria|S[ée]rie|Data\s+de\s+Lan[çc]amento|Autores|EAN|ISBN(?:-1[03])?|Cole[çc][ãa]o`;
export const LOOSE_METADATA_LABEL = String.raw`Edi[çc][ãa]o|Data|Ano|Pre[çc]o|Autor[a]?`;

const MAX_PASSES = 5;
const MAX_LABEL_LINE = 80;
const DETAILS_REACH = 6;
const MIN_WRAP_LINE = 45;
const NOT_A_WRAP_END = /[.!?:;…»"”)]$/;
const SENTENCE_END = /[.!?»"]$/;
const MARKUP = /<\/?[a-z!?][^<>]*>|&(?:#\d+|#x[0-9a-f]+|[a-z]+);/i;
const REFERENCE_LINE = /^[ \t]*\[[^\]]+\]:[ \t]*\S.*$/;
const RULE_LINE = /^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const TAIL_MARKER = /^(?:(?:also contained in|contains)[ \t]*:.*|source[ \t]*:[ \t]*https?:\/\/\S+|\(from[ \t]+https?:\/\/[^)\s]*\)|\([ \t]*\[source\]\[\d*\][ \t]*\))$/i;
const SHOP_CHROME = /(?:[^\S\n]*(?:Adicionar aos Favoritos|J[áa] se encontra nos favoritos))+[^\S\n]*$/gim;
const PLACEHOLDER_LINE = /^\[data_lancamento\]/i;
const STRICT_LABEL = new RegExp(`^(?:${STRICT_METADATA_LABEL})`, "i");
const LOOSE_LABEL = new RegExp(`^(?:${LOOSE_METADATA_LABEL})`, "i");
const NAME_LABEL = /^(?:T[íi]tulo\s+original|Tradu[çc][ãa]o|Tradutor[a]?|Traduzido|Cole[çc][ãa]o)/i;
const AFTER_STRICT_LABEL = /^\s*$|^\s*[:–—-]|^\s+\d/;
const AFTER_NAME_LABEL = /^\s+[\p{Lu}(\[]/u;
const AFTER_LOOSE_LABEL = /^:|^\s+(?:\d[\d\s./,:–-]*(?:\s?(?:€|mm|cm|kg|g|pp?))?|\d{1,2}\s+de\s+\p{L}+\s+de\s+\d{4})$/u;
const EDITION_LINE = /^\d{1,2}\s*\.?\s*[ªº°]?\s*(?:edi[çc][ãa]o|reimpress[ãa]o)(?:\s+\p{L}+)?(?:\s+(?:de\s+)?\d{4})?$/iu;
const EMPTY_HEADING = /^(?:Cita[çc][õo]es|Cr[íi]ticas|Pr[ée]mios)$/i;
const LEADING_LABEL = /^(?:sinopse|synopsis|resumo|descri[çc][ãa]o|description|sobre o livro|about the book)(?=\s|:|[–—-]|$)/i;
const LABEL_SEPARATOR = /^\s*:\s*|^\s+[–—-]\s+/;
const GLUED_SENTENCE = /(\p{Ll}{2}[.!?])(?=\p{Lu}\p{Ll})/gu;

function isMetadataLabelLine(line: string): boolean {
  if (line.length > MAX_LABEL_LINE || SENTENCE_END.test(line)) return false;
  const strict = STRICT_LABEL.exec(line);
  if (strict) {
    const rest = line.slice(strict[0].length);
    return AFTER_STRICT_LABEL.test(rest) || (NAME_LABEL.test(line) && AFTER_NAME_LABEL.test(rest));
  }
  const loose = LOOSE_LABEL.exec(line);
  return loose !== null && AFTER_LOOSE_LABEL.test(line.slice(loose[0].length));
}

function isRemovableLine(line: string): boolean {
  return PLACEHOLDER_LINE.test(line) || isMetadataLabelLine(line) || (line.length <= MAX_LABEL_LINE && EDITION_LINE.test(line));
}

function tailStart(lines: string[]): number {
  return lines.findIndex((line, index) => {
    if (!lines.slice(0, index).some((before) => before.trim() !== "")) return false;
    const text = line.trim();
    if (text.length <= MAX_LABEL_LINE && TAIL_MARKER.test(text)) return true;
    return text === "Detalhes" && lines.slice(index + 1, index + 1 + DETAILS_REACH).some((next) => isMetadataLabelLine(next.trim()));
  });
}

function dropLines(text: string): string {
  let lines = text.split("\n").filter((line) => !REFERENCE_LINE.test(line) && !RULE_LINE.test(line));
  const cut = tailStart(lines);
  if (cut >= 0) lines = lines.slice(0, cut);
  lines = lines.map((line) => line.replace(SHOP_CHROME, "")).filter((line) => !isRemovableLine(line.trim()));
  while (lines.length > 0 && (lines[lines.length - 1]!.trim() === "" || EMPTY_HEADING.test(lines[lines.length - 1]!.trim()))) lines.pop();
  return lines.join("\n");
}

function inlineMarkdown(text: string): string {
  return text
    .replace(/\[((?:\\.|[^\]\\])+)\]\(https?:\/\/[^)]+\)/g, "$1")
    .replace(/\[((?:\\.|[^\]\\])+)\]\[[^\]]*\]/g, "$1")
    .replace(/\*\*(\S(?:[^*\n]*\S)?)\*\*/g, "$1")
    .replace(/\*(\S(?:[^*\n]*\S)?)\*/g, "$1")
    .replace(/\\([[\]*_])/g, "$1");
}

function tidy(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/ {2,}/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function withoutLeadingLabel(text: string): string {
  const lines = text.split("\n");
  const index = lines.findIndex((line) => line.trim() !== "");
  if (index < 0) return text;
  const line = lines[index]!.trim();
  const label = LEADING_LABEL.exec(line)?.[0];
  if (label === undefined) return text;
  const rest = line.slice(label.length);
  const separator = LABEL_SEPARATOR.exec(rest);
  if (rest.trim() === "") lines.splice(index, 1);
  else if (separator) lines[index] = rest.slice(separator[0].length);
  else if (label === label.toUpperCase() && /^\s+\S/.test(rest)) lines[index] = rest.trim();
  else return text;
  return lines.join("\n").trim();
}

function joinWraps(text: string): string {
  const parts = text.split(/(\n+)/);
  const units: string[] = [];
  const separators: string[] = [];
  for (let index = 0; index < parts.length; index += 2) {
    const unit = parts[index]!;
    const previous = units[units.length - 1];
    if (previous !== undefined && /\p{Ll}-$/u.test(previous) && /^\p{Ll}/u.test(unit)) units[units.length - 1] = previous.slice(0, -1) + unit;
    else {
      if (previous !== undefined) separators.push(parts[index - 1]!);
      units.push(unit);
    }
  }
  const joinable = units.slice(0, -1).map((unit, index) => unit.length >= MIN_WRAP_LINE && !NOT_A_WRAP_END.test(unit) && /^[\p{L}\p{N}]/u.test(units[index + 1]!));
  let out = units[0] ?? "";
  for (let index = 0; index < joinable.length;) {
    if (!joinable[index]) {
      out += separators[index]! + units[index + 1]!;
      index += 1;
      continue;
    }
    let end = index;
    while (end < joinable.length && joinable[end]) end += 1;
    const chain = units.slice(index + 1, end + 1);
    if (end - index >= 2 && chain.some((unit) => /^\p{Ll}/u.test(unit))) out += ` ${chain.join(" ")}`;
    else for (let step = index; step < end; step += 1) out += separators[step]! + units[step + 1]!;
    index = end;
  }
  return out;
}

function separateGluedSentences(text: string): string {
  return text.replace(GLUED_SENTENCE, (match, head: string, offset: number) => {
    let start = offset;
    while (start > 0 && !/\s/.test(text[start - 1]!)) start -= 1;
    let end = offset;
    while (end < text.length && !/\s/.test(text[end]!)) end += 1;
    const token = text.slice(start, end);
    return /:\/\/|www\./i.test(token) ? match : `${head} `;
  });
}

function cleanPass(input: string): string {
  let text = input.replace(/\r\n?/g, "\n").replace(/[\t\xa0]/g, " ");
  text = fromWindows1252Controls(cleanCatalogText(text));
  if (MARKUP.test(text)) text = htmlToText(text);
  text = inlineMarkdown(dropLines(text));
  text = withoutLeadingLabel(tidy(text));
  return tidy(separateGluedSentences(joinWraps(text)));
}

export function cleanSummary(text: string): string | null {
  let current = text;
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const next = cleanPass(current);
    if (next === current) break;
    current = next;
  }
  return current === "" ? null : current;
}
