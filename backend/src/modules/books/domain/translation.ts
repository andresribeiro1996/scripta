import { normalizeTitle, titleNumbers } from "@scripta/shared";

const ORIGINAL_TITLE = /T[íi]tulo original\s*[:\-–—]?\s*([^\n]+)/i;
const MAX_ORIGINAL_TITLE = 200;

export function originalTitleIn(text: string | null): string | null {
  const value = (ORIGINAL_TITLE.exec(text ?? "")?.[1] ?? "").trim().replace(/[.;,\s]+$/, "");
  return value !== "" && value.length <= MAX_ORIGINAL_TITLE ? value : null;
}

export function mainTitle(title: string): string {
  return title.split(/ — | – | - |\. /)[0]!.trim();
}

export function sameMainTitle(a: string, b: string): boolean {
  const left = normalizeTitle(mainTitle(a));
  return left !== "" && left === normalizeTitle(mainTitle(b)) && titleNumbers(mainTitle(a)) === titleNumbers(mainTitle(b));
}
