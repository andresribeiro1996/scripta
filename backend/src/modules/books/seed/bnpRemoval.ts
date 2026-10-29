import type { DatabaseSync } from "node:sqlite";
import { canonicalIsbn } from "@scripta/shared";
import type { BooksRepository } from "../domain/ports.js";
import { isInstitutionalPublisher } from "./bnpScope.js";

export const REMOVAL_CHUNK = 200;
export const REMOVAL_PAUSE_MS = 500;

export interface RemovalHolds {
  workIds: Set<string>;
  isbns: Set<string>;
  bookKeys: Set<string>;
}

export interface GameDatabases {
  tierlists: DatabaseSync;
  arena: DatabaseSync;
  quizzes: DatabaseSync;
  murals: DatabaseSync;
}

export type KeptReason = "workHeld" | "isbnHeld" | "keyHeld";

export interface RemovalPlan {
  selected: number;
  removable: string[];
  kept: Record<KeptReason, number>;
  byPublisher: Array<{ publisher: string; books: number }>;
  samples: Array<{ title: string; publisher: string; isbn: string | null }>;
}

const GAME_WORK_QUERIES: Array<[keyof GameDatabases, string]> = [
  ["tierlists", "SELECT work_id FROM tierlist_works UNION SELECT work_id FROM tierlist_ballot_placements"],
  ["arena", "SELECT work_id FROM tournament_slots UNION SELECT book_a_work_id FROM duels UNION SELECT book_b_work_id FROM duels"],
  ["quizzes", "SELECT work_id FROM quiz_works"],
  ["murals", "SELECT work_id FROM mural_works"]
];

export function readRemovalHolds(library: DatabaseSync, games: GameDatabases): RemovalHolds {
  const holds: RemovalHolds = { workIds: new Set(), isbns: new Set(), bookKeys: new Set() };
  for (const row of library.prepare("SELECT work_id, isbn, book_key FROM library_books").all() as Array<{ work_id: string | null; isbn: string | null; book_key: string }>) {
    if (row.work_id) holds.workIds.add(row.work_id);
    if (row.isbn) holds.isbns.add(canonicalIsbn(row.isbn));
    holds.bookKeys.add(row.book_key);
  }
  for (const [name, sql] of GAME_WORK_QUERIES) {
    for (const row of games[name].prepare(sql).all() as Array<{ work_id: string | null }>) {
      if (typeof row.work_id === "string") holds.workIds.add(row.work_id);
    }
  }
  return holds;
}

export function planBnpRemoval(repo: Pick<BooksRepository, "bnpPublisherBooks" | "bookHolds">, holds: RemovalHolds): RemovalPlan {
  const selected = repo.bnpPublisherBooks().filter((book) => isInstitutionalPublisher(book.publisher));
  const holdsOf = new Map(repo.bookHolds(selected.map((book) => book.id)).map((hold) => [hold.id, hold]));
  const kept: Record<KeptReason, number> = { workHeld: 0, isbnHeld: 0, keyHeld: 0 };
  const removable: typeof selected = [];
  for (const book of selected) {
    const hold = holdsOf.get(book.id);
    const reason: KeptReason | null = hold?.workIds.some((id) => holds.workIds.has(id))
      ? "workHeld"
      : book.isbn && holds.isbns.has(canonicalIsbn(book.isbn))
        ? "isbnHeld"
        : hold?.keys.some((key) => holds.bookKeys.has(key))
          ? "keyHeld"
          : null;
    if (reason) kept[reason] += 1;
    else removable.push(book);
  }
  const counts = new Map<string, number>();
  for (const book of removable) counts.set(book.publisher, (counts.get(book.publisher) ?? 0) + 1);
  const byPublisher = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 40).map(([publisher, books]) => ({ publisher, books }));
  return {
    selected: selected.length,
    removable: removable.map((book) => book.id),
    kept,
    byPublisher,
    samples: removable.slice(0, 20).map(({ title, publisher, isbn }) => ({ title, publisher, isbn }))
  };
}

export interface RemovalDeps {
  repo: Pick<BooksRepository, "removeBooks">;
  deleteObject: (key: string) => Promise<void>;
  pause: (ms: number) => Promise<void>;
  log: (line: string) => void;
}

export async function removeBnpBooks(deps: RemovalDeps, bookIds: string[]) {
  const report = { removed: 0, worksRemoved: 0, coversDeleted: 0, coverDeleteFailures: 0 };
  for (let start = 0; start < bookIds.length; start += REMOVAL_CHUNK) {
    const removed = deps.repo.removeBooks(bookIds.slice(start, start + REMOVAL_CHUNK));
    report.removed += removed.books;
    report.worksRemoved += removed.works;
    if (removed.coverImageIds.length > 0) deps.log(JSON.stringify({ orphanCoverImageIds: removed.coverImageIds }));
    for (const id of removed.coverImageIds) {
      for (const key of [`covers/${id}.webp`, `covers/${id}-thumb.webp`]) {
        try {
          await deps.deleteObject(key);
          report.coversDeleted += 1;
        } catch (error) {
          if (!(error instanceof Error)) throw error;
          report.coverDeleteFailures += 1;
          deps.log(`delete ${key}: ${error.message}`);
        }
      }
    }
    deps.log(`removed ${report.removed} of ${bookIds.length}`);
    if (start + REMOVAL_CHUNK < bookIds.length) await deps.pause(REMOVAL_PAUSE_MS);
  }
  return report;
}
