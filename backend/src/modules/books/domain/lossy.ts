import { canonicalIsbn, repairMojibake } from "@scripta/shared";
import type { LossyBook } from "./types.js";

const LOSSY = /\p{L}©\p{L}/u;
const LETTER = /\p{L}/u;
const LOWERCASE = /\p{Ll}/u;

export interface BookText {
  title: string;
  author: string;
}

export interface RetitleCandidates {
  titles: string[];
  authors: string[];
}

export const isLossy = (text: string) => LOSSY.test(text);

export const hasCopyrightSign = (book: BookText) => book.title.includes("©") || book.author.includes("©");

export const wantsRetitle = (book: { title: string; author: string; isbn: string | null }) =>
  canonicalIsbn(book.isbn ?? "") !== "" && (isLossy(book.title) || isLossy(book.author));

export const textOf = (book: BookText) => `${book.title} — ${book.author}`;

const isAccentedLetter = (char: string) => LETTER.test(char) && char.codePointAt(0)! > 0x7f;

export function fillLossy(stored: string, candidate: string): string | null {
  const have = [...stored.normalize("NFC").trim()];
  const text = repairMojibake(candidate).normalize("NFC").trim();
  const want = [...text];
  if (!have.includes("©") || have.length !== want.length) return null;
  if (!LOWERCASE.test(text) && have.some((char) => LOWERCASE.test(char))) return null;
  return have.every((char, index) => (char === "©" ? isAccentedLetter(want[index]!) : char.toLowerCase() === want[index]!.toLowerCase())) ? text : null;
}

function fillFirst(stored: string, candidates: string[]): string {
  for (const candidate of candidates) {
    const filled = fillLossy(stored, candidate);
    if (filled !== null) return filled;
  }
  return stored;
}

export function retitle(book: BookText, candidates: RetitleCandidates): BookText | null {
  const title = fillFirst(book.title, candidates.titles);
  const author = book.author.split(", ").map((name) => fillFirst(name, candidates.authors)).join(", ");
  return title === book.title && author === book.author ? null : { title, author };
}

export function retitleRepairs(book: LossyBook, next: BookText, origin: string) {
  const change = { title: book.title, author: book.author, repairedTitle: next.title, repairedAuthor: next.author };
  return {
    book: { id: book.id, ...change, origin },
    work: book.work_id !== null && book.work_title === book.title && book.work_author === book.author ? { id: book.work_id, ...change } : null
  };
}
