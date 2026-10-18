import { BOOK_GENRES, normalizeGenreLabel } from "@scripta/shared";
import type { BookGenre } from "@scripta/shared";
import type { BnpBook } from "./bnpRecord.js";

export type BnpSkip = "noIsbn" | "textbook" | "noPublisher" | "institutional" | "noPerson";

export const BNP_SKIPS: readonly BnpSkip[] = ["noIsbn", "textbook", "noPublisher", "institutional", "noPerson"];

const INSTITUTIONAL = /\b(?:camara municipal|camara municpal|municipio|empresa municipal|junta de freguesia|uniao das? (?:juntas de )?freguesias|comunidade intermunicipal|universidade|faculdade|politecnico|escola superior|agrupamento de escolas|ministerio|direc?cao geral|direc?cao regional|direc?cao de servicos|secretaria regional|governo|regiao autonoma|assembleia da republica|associacao|centro de estudos|centro de investigacao|museu|diocese|paroquia|banda musical|filarmonica|grupo coral|santa casa|conferencia episcopal|instituto (?:politecnico|nacional|superior|portugues|de )|comissao)\b/;

const MAIN_NUMBER = /^[\d.]+/;
const LITERARY_FORM = /-([1-9][\d.]*)/;
const AGE_AUXILIARY = /\(0\.053\.([2-6])/;

const LITERARY_FORMS: Array<[string, BookGenre]> = [
  ["93", "Children's"],
  ["1", "Poetry"],
  ["312.4", "Crime"],
  ["311.9", "Science Fiction"],
  ["311.6", "Historical Fiction"],
  ["94", "Biography & Memoir"],
  ["992", "Travel"]
];

const MAIN_PREFIXES: Array<[string, BookGenre | null]> = [
  ["929.5", null],
  ["929.6", null],
  ["929.7", null],
  ["929.9", null],
  ["641.5", "Cooking"],
  ["159.9", "Psychology"],
  ["004", "Technology"],
  ["133", null],
  ["657", "Business"],
  ["658", "Business"],
  ["659", "Business"],
  ["910", "Travel"],
  ["929", "Biography & Memoir"],
  ["93", "History"],
  ["94", "History"],
  ["32", "Politics"],
  ["33", "Business"],
  ["62", "Technology"],
  ["1", "Philosophy"],
  ["2", "Religion"],
  ["5", "Science"]
];

export function bnpSkipReason(book: BnpBook): BnpSkip | null {
  if (book.isbns.length === 0) return "noIsbn";
  if (book.udc.some((code) => code.includes("(075"))) return "textbook";
  if (book.publisher === null) return "noPublisher";
  if (INSTITUTIONAL.test(normalizeGenreLabel(book.publisher))) return "institutional";
  if (book.author === "") return "noPerson";
  return null;
}

function codeGenres(code: string): BookGenre[] {
  const genres: BookGenre[] = [];
  const age = AGE_AUXILIARY.exec(code)?.[1];
  if (age) genres.push(age === "6" ? "Young Adult" : "Children's");
  const main = MAIN_NUMBER.exec(code)?.[0] ?? "";
  if (main.startsWith("82")) {
    const form = LITERARY_FORM.exec(code)?.[1];
    const literary = form && LITERARY_FORMS.find(([key]) => form === key || form.startsWith(`${key}.`));
    if (literary) genres.push(literary[1]);
    return genres;
  }
  const prefix = MAIN_PREFIXES.find(([key]) => main.startsWith(key));
  if (prefix?.[1]) genres.push(prefix[1]);
  return genres;
}

export function udcGenres(codes: string[]): BookGenre[] {
  const found = new Set(codes.flatMap(codeGenres));
  return BOOK_GENRES.filter((genre) => found.has(genre));
}
