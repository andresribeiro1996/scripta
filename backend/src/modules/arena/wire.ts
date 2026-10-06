import { canonicalByKey, canonicalWorkIds, firstKeyPerWork, keysForWorks, knownWorkIds } from "../library/index.js";
import type { TournamentSlotRow } from "./domain/types.js";
import type { DuelSideView, DuelView, SeedBookView, TournamentSummary, TournamentView } from "./service.js";

type Canonical = Map<string, string> | null;

function workOf(id: string | null, canonical: Map<string, string>): string | null {
  return id === null ? null : canonical.get(id) ?? id;
}

function bookForWire(book: SeedBookView, canonical: Canonical) {
  return canonical
    ? { workId: workOf(book.workId, canonical), title: book.title, author: book.author, cover: book.cover }
    : { key: book.key, title: book.title, author: book.author, cover: book.cover };
}

function sideForWire(side: DuelSideView, canonical: Canonical) {
  return { ...bookForWire(side, canonical), votes: side.votes };
}

function duelForWire(duel: DuelView, canonical: Canonical) {
  const winner = canonical ? { winnerWorkId: workOf(duel.winnerWorkId, canonical) } : { winnerKey: duel.winnerKey };
  return {
    id: duel.id,
    roundNumber: duel.roundNumber,
    duelIndex: duel.duelIndex,
    bookA: sideForWire(duel.bookA, canonical),
    bookB: sideForWire(duel.bookB, canonical),
    ...winner,
    status: duel.status,
    opensAt: duel.opensAt,
    closesAt: duel.closesAt,
    hasVoted: duel.hasVoted
  };
}

function summaryForWire<T extends TournamentSummary>(summary: T, canonical: Canonical) {
  return { ...summary, winner: summary.winner && bookForWire(summary.winner, canonical) };
}

function canonicalFor(works: boolean, ids: Array<string | null>): Canonical {
  return works ? canonicalWorkIds(ids.filter((id): id is string => id !== null)) : null;
}

export function summariesForWire(summaries: TournamentSummary[], works: boolean) {
  const canonical = canonicalFor(works, summaries.map((summary) => summary.winner?.workId ?? null));
  return summaries.map((summary) => summaryForWire(summary, canonical));
}

export function tournamentForWire(view: TournamentView, works: boolean) {
  const canonical = canonicalFor(works, [
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

export function keyedSeedBooks<T extends { workId: string }>(ownerUserId: string, books: T[], slots: TournamentSlotRow[]) {
  const ids = knownWorkIds(books.map((book) => book.workId));
  const stored = canonicalByKey(new Map(slots.map((slot) => [slot.book_key, slot.work_id])));
  const keys = keysForWorks(ownerUserId, ids, firstKeyPerWork(slots.map((slot) => slot.book_key), stored));
  const works = new Map<string, { workId: string | null }>();
  const keyed = books.map(({ workId: _workId, ...book }, index) => {
    const key = keys.get(ids[index]!)!;
    works.set(key, { workId: ids[index]! });
    return { ...book, key };
  });
  return { books: keyed, works, ids };
}
