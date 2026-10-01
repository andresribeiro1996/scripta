import { normalizeIsbn } from "./covers.js";

type Book = Record<string, unknown>;

export interface MatchFacts {
  isbn: string;
  exact: string;
  loose: string;
  numbers: string;
}

export function normalizeWords(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function withoutBrackets(value: string): string {
  let result = "";
  let copied = 0;
  let noParen = false;
  let noBracket = false;
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    const closer = char === "(" && !noParen ? ")" : char === "[" && !noBracket ? "]" : undefined;
    if (!closer) continue;
    const end = value.indexOf(closer, index + 1);
    if (end === -1) {
      if (char === "(") noParen = true;
      else noBracket = true;
      continue;
    }
    result += `${value.slice(copied, index)} `;
    copied = end + 1;
    index = end;
  }
  return result + value.slice(copied);
}

export function normalizeTitle(value: string): string {
  return normalizeWords(withoutBrackets(value).split(":")[0] ?? "");
}

export function titleNumbers(title: string): string {
  return (withoutBrackets(title).match(/\d+/g) ?? []).join(" ");
}

export function firstAuthor(attribution: string): string {
  return normalizeWords(attribution.split(",")[0] ?? "");
}

export function canonicalIsbn(raw: unknown): string {
  const isbn = normalizeIsbn(raw).toUpperCase();
  if (isbn.length !== 10) return isbn;
  const core = `978${isbn.slice(0, 9)}`;
  const sum = [...core].reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return `${core}${(10 - (sum % 10)) % 10}`;
}

export function matchFacts(book: Book): MatchFacts {
  const title = String(book.Title ?? "");
  const author = firstAuthor(String(book.Attribution ?? ""));
  const exactTitle = normalizeWords(title);
  const mainTitle = normalizeTitle(title);
  const surname = author.split(" ").at(-1) ?? "";
  return {
    isbn: canonicalIsbn(book.ISBN),
    exact: exactTitle && author ? `${exactTitle}|${author}` : "",
    loose: mainTitle && surname ? `${mainTitle}|${surname}` : "",
    numbers: titleNumbers(title)
  };
}

export function bookMatchKeys(book: Book): string[] {
  const facts = matchFacts(book);
  return [...(facts.isbn ? [`isbn:${facts.isbn}`] : []), ...(facts.exact ? [`ta:${facts.exact}`] : [])];
}

export function certainFacts(a: MatchFacts, b: MatchFacts): boolean {
  if (a.isbn !== "" && a.isbn === b.isbn) return true;
  return a.exact !== "" && a.exact === b.exact && (a.isbn === "" || b.isbn === "");
}

export function likelyFacts(a: MatchFacts, b: MatchFacts): boolean {
  return !certainFacts(a, b) && a.loose !== "" && a.loose === b.loose && a.numbers === b.numbers;
}

export function isCertainMatch(a: Book, b: Book): boolean {
  return certainFacts(matchFacts(a), matchFacts(b));
}

export function isLikelyMatch(a: Book, b: Book): boolean {
  return likelyFacts(matchFacts(a), matchFacts(b));
}
