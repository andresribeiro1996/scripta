import type { Locale } from "../i18n/locale.js";
import { sharedT } from "../i18n/sharedT.js";
import type { PublicBookData } from "../public/types.js";

export type CharacterScope = { kind: "series" | "work"; key: string; label: string; coverUrl: string | null };
export type CastCharacter = { id: string; name: string; works: number };
export type WorkCast = { scope: CharacterScope & { workCount: number }; characters: CastCharacter[] };
export type CharacterSubject = { kind: "characters"; scope: CharacterScope; characters: Array<{ id: string; name: string }> };
export type CharacterGameMode = "tierlist" | "tournament";

const MIN_CAST = 4;
const MAX_BRACKET = 128;
const TIERLIST_DEFAULT = 20;

export function characterBooks(subject: CharacterSubject): Array<Record<string, unknown>> {
  return subject.characters.map((character) => ({ Title: character.name, _workId: character.id, _character: true }));
}

export function isCharacterBook(book: Record<string, unknown>): boolean {
  return book._character === true;
}

export function characterSnapshot(subject: CharacterSubject): PublicBookData[] {
  return subject.characters.map((character) => ({
    key: character.id,
    workId: character.id,
    title: character.name,
    author: subject.scope.label,
    isbn: null,
    imageId: null,
    coverUrl: null,
    readStatus: null
  }));
}

export function bracketSizes(count: number): number[] {
  const sizes: number[] = [];
  for (let size = MIN_CAST; size <= Math.min(count, MAX_BRACKET); size *= 2) sizes.push(size);
  return sizes;
}

export function defaultTicked(cast: CastCharacter[], mode: CharacterGameMode, size: number): string[] {
  return cast.slice(0, mode === "tierlist" ? TIERLIST_DEFAULT : size).map((character) => character.id);
}

export function canCreate(mode: CharacterGameMode, ticked: number, size: number): boolean {
  return mode === "tierlist" ? ticked >= MIN_CAST : ticked === size;
}

export function itemNoun(subject: unknown, count: number, locale: Locale): string {
  return sharedT(locale)(subject ? "shared.characters.character" : "shared.characters.book", { count });
}

export function bookTierlists<T extends { subject?: unknown }>(lists: T[]): T[] {
  return lists.filter((list) => !list.subject);
}
