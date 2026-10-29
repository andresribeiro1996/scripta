import type { Mural } from "@scripta/shared";

type Book = Record<string, unknown>;

const addedOn = (book: Book) => (typeof book.DateCreated === "string" ? book.DateCreated : "");

export function latestBooks(books: readonly Book[], count: number): Book[] {
  return books
    .map((book, index) => ({ book, index }))
    .sort((a, b) => addedOn(b.book).localeCompare(addedOn(a.book)) || b.index - a.index)
    .slice(0, count)
    .map((entry) => entry.book);
}

export function latestMural(murals: readonly Mural[]): Mural | undefined {
  return murals.reduce<Mural | undefined>((latest, mural) => (!latest || Date.parse(mural.updatedAt) > Date.parse(latest.updatedAt) ? mural : latest), undefined);
}
