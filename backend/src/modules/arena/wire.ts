import { canonicalWorkIds } from "../library/index.js";
import type { Duel, DuelSide, SeedBook, Tournament, TournamentView } from "@scripta/shared";

function workOf(id: string | null, canonical: Map<string, string>): string | null {
  return id === null ? null : canonical.get(id) ?? id;
}

function bookForWire(book: SeedBook, canonical: Map<string, string>): SeedBook {
  return { workId: workOf(book.workId, canonical), title: book.title, author: book.author, cover: book.cover };
}

function sideForWire(side: DuelSide, canonical: Map<string, string>): DuelSide {
  return { ...bookForWire(side, canonical), votes: side.votes };
}

function duelForWire(duel: Duel, canonical: Map<string, string>): Duel {
  return {
    id: duel.id,
    roundNumber: duel.roundNumber,
    duelIndex: duel.duelIndex,
    bookA: sideForWire(duel.bookA, canonical),
    bookB: sideForWire(duel.bookB, canonical),
    winnerWorkId: workOf(duel.winnerWorkId, canonical),
    status: duel.status,
    opensAt: duel.opensAt,
    closesAt: duel.closesAt,
    hasVoted: duel.hasVoted
  };
}

function summaryForWire<T extends Tournament>(summary: T, canonical: Map<string, string>): T {
  return { ...summary, winner: summary.winner && bookForWire(summary.winner, canonical) };
}

function canonicalFor(ids: Array<string | null>) {
  return canonicalWorkIds(ids.filter((id): id is string => id !== null));
}

export function summariesForWire(summaries: Tournament[]): Tournament[] {
  const canonical = canonicalFor(summaries.map((summary) => summary.winner?.workId ?? null));
  return summaries.map((summary) => summaryForWire(summary, canonical));
}

export function tournamentForWire(view: TournamentView): TournamentView {
  const canonical = canonicalFor([
    view.winner?.workId ?? null,
    ...view.slots.map((slot) => slot.workId),
    ...view.duels.flatMap((duel) => [duel.bookA.workId, duel.bookB.workId, duel.winnerWorkId])
  ]);
  return {
    ...summaryForWire(view, canonical),
    slots: view.slots.map(({ slotIndex, ...book }) => ({ slotIndex, ...bookForWire(book, canonical) })),
    duels: view.duels.map((duel) => duelForWire(duel, canonical))
  };
}
