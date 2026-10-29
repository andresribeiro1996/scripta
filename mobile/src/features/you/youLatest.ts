import { timestamp, type Mural } from "@scripta/shared";

type Book = Record<string, unknown>;

export function latestBooks(books: readonly Book[], count: number): Book[] {
  return books
    .map((book, index) => ({ book, index }))
    .sort((a, b) => timestamp(b.book.DateCreated) - timestamp(a.book.DateCreated) || b.index - a.index)
    .slice(0, count)
    .map((entry) => entry.book);
}

export function latestMural(murals: readonly Mural[]): Mural | undefined {
  return murals.reduce<Mural | undefined>((latest, mural) => (!latest || Date.parse(mural.updatedAt) > Date.parse(latest.updatedAt) ? mural : latest), undefined);
}
