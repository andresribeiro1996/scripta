// Business logic for the arena module. Depends only on the
// ArenaRepository port, not on SQLite — same reasoning as every other
// module's service.ts.
//
// The core mechanic: a duel is "settled" (differing votes → a winner) or
// "tied_pending_tiebreak" (equal votes → waits for the owner) via one
// shared internal settleDuelInternal, called either by the scheduler's
// timer-driven sweep (runScheduledSweep) or the owner's early-settle
// action (settleEarly) — both converge on identical tie-handling and
// round-advancement logic, just with a different `force` flag for
// whether closes_at must already have passed.

import { randomUUID } from "node:crypto";
import type { GameParticipation } from "@scripta/shared/community";
import {
  AlreadyVotedError,
  DuelNotFoundError,
  DuelNotTiedError,
  DuelNotVotableError,
  DuplicateBookError,
  DuplicateSlotError,
  IncompleteSeedError,
  InvalidBookError,
  InvalidBracketSizeError,
  InvalidSlotIndexError,
  NotEnoughBooksError,
  TournamentAlreadyStartedError,
  TournamentNotFoundError
} from "./domain/errors.js";
import { canonicalWorkIds } from "../library/index.js";
import type { ArenaRepository } from "./domain/ports.js";
import type { DuelRow, SeedBookInput, SeedPreview, TournamentRow, TournamentSlotRow } from "./domain/types.js";

export interface SeedBookView {
  workId: string | null;
  title: string;
  author: string;
  cover: string | null;
}

export interface TournamentSummary {
  id: string;
  name: string;
  bracketSize: number;
  roundDurationMinutes: number;
  status: TournamentRow["status"];
  currentRound: number;
  createdAt: string;
  ownerUserId: string;
  /** Up to eight cover URLs from the seeded pool, for the list card.
   *  Empty when nothing is seeded yet, or when no seeded book had art. */
  covers: string[];
  filledSlots: number;
  /** The champion book, once this tournament's final duel has settled —
   *  null for anything still seeding or in progress. */
  winner: SeedBookView | null;
}

export interface TournamentDiscoverRef {
  id: string;
  createdAt: string;
  ownerUserId: string;
}

export interface DuelSideView extends SeedBookView {
  votes: number;
}

export interface DuelView {
  id: string;
  roundNumber: number;
  duelIndex: number;
  bookA: DuelSideView;
  bookB: DuelSideView;
  winnerWorkId: string | null;
  status: DuelRow["status"];
  opensAt: string;
  closesAt: string;
  hasVoted: boolean;
}

export interface TournamentView extends TournamentSummary {
  slots: Array<{ slotIndex: number } & SeedBookView>;
  duels: DuelView[];
}

export interface ArenaService {
  createTournament(ownerUserId: string, input: { name: string; bracketSize: number; roundDurationMinutes: number }): TournamentSummary;
  listMine(ownerUserId: string): TournamentSummary[];
  listPublic(limit: number, offset: number): TournamentSummary[];
  discoverWindow(needle: string, limit: number): TournamentDiscoverRef[];
  listPublicByIds(ids: string[]): TournamentSummary[];
  votedAmong(voterUserId: string, ids: string[]): string[];
  getTournamentView(id: string, voterToken?: string, viewerUserId?: string | null): TournamentView | null;
  setSlotsManual(tournamentId: string, ownerUserId: string, entries: Array<{ slotIndex: number; book: SeedBookInput }>): void;
  seedingSlots(tournamentId: string, ownerUserId: string): TournamentSlotRow[];
  randomFill(tournamentId: string, ownerUserId: string, pool: SeedBookInput[]): void;
  getPublicSummary(tournamentId: string): TournamentSummary | undefined;
  start(tournamentId: string, ownerUserId: string): void;
  /** Casts one vote. `voterUserId` is the signed-in caller's account id,
   *  or null for an anonymous vote — when present, the vote is stamped
   *  with it AND every earlier vote under the same voter_token is claimed
   *  for the account (linkVotesToUser), so a person's pre-sign-in voting
   *  history joins their "voted in" list on their first signed-in vote. */
  vote(tournamentId: string, duelId: string, voterToken: string, workId: string, voterUserId?: string | null): void;
  /** Tournaments the account has voted in, most recent vote first —
   *  own tournaments excluded (listMine already shows those). */
  listVoted(voterUserId: string): TournamentSummary[];
  participationByOwner(ownerUserId: string, since: string): GameParticipation[];
  settleEarly(tournamentId: string, ownerUserId: string, duelId: string): void;
  tiebreak(tournamentId: string, ownerUserId: string, duelId: string, workId: string): void;
  /** Renames a tournament. Allowed at ANY status, unlike seeding or
   *  starting: a name is a label, not part of the bracket, so there's no
   *  reason a running or finished tournament should be stuck with a
   *  placeholder. */
  renameTournament(tournamentId: string, ownerUserId: string, name: string): void;
  deleteTournament(tournamentId: string, ownerUserId: string): void;
  runScheduledSweep(nowIso?: string): void;
}

function isPowerOfTwo(n: number): boolean {
  return n >= 2 && (n & (n - 1)) === 0;
}

const COVER_PREVIEW_LIMIT = 8;
const RECENT_PARTICIPANT_LIMIT = 10;
const EMPTY_PREVIEW: SeedPreview = { covers: [], filledSlots: 0 };

// The preview and winner are required arguments rather than optional ones:
// every caller has to say what a card should show, so a new list endpoint
// can't quietly ship summaries with no covers/winner and no error to notice.
function toTournamentSummary(row: TournamentRow, preview: SeedPreview, winner: SeedBookView | null): TournamentSummary {
  return {
    id: row.id,
    name: row.name,
    bracketSize: row.bracket_size,
    roundDurationMinutes: row.round_duration_minutes,
    status: row.status,
    currentRound: row.current_round,
    createdAt: row.created_at,
    ownerUserId: row.owner_user_id,
    covers: preview.covers,
    filledSlots: preview.filledSlots,
    winner: winner && { workId: winner.workId, title: winner.title, author: winner.author, cover: winner.cover }
  };
}

// Only the final round's duel can produce a champion — an early round's
// settled duel just fed its winner into the next round, not the title.
function winnerFromDuels(duels: DuelRow[]): SeedBookView | null {
  if (duels.length === 0) return null;
  const maxRound = Math.max(...duels.map((d) => d.round_number));
  const final = duels.find((d) => d.round_number === maxRound && d.winner_side !== null);
  return final ? winnerBookFromDuel(final) : null;
}

export function previewFromSlots(slots: TournamentSlotRow[]): SeedPreview {
  const covers: string[] = [];
  for (const slot of slots) {
    if (covers.length >= COVER_PREVIEW_LIMIT) break;
    if (slot.cover_url) covers.push(slot.cover_url);
  }
  return { covers, filledSlots: slots.length };
}

function summariesWithPreviews(repo: ArenaRepository, rows: TournamentRow[]): TournamentSummary[] {
  if (rows.length === 0) return [];
  const previews = repo.getSeedPreviews(rows.map((row) => row.id), COVER_PREVIEW_LIMIT);
  const completedIds = rows.filter((row) => row.status === "completed").map((row) => row.id);
  const winners = new Map<string, SeedBookView>();
  for (const duel of repo.getFinalDuels(completedIds)) {
    if (duel.winner_side !== null) winners.set(duel.tournament_id, winnerBookFromDuel(duel));
  }
  return rows.map((row) => toTournamentSummary(row, previews.get(row.id) ?? EMPTY_PREVIEW, winners.get(row.id) ?? null));
}

function winnerBookFromDuel(d: DuelRow): SeedBookView {
  return d.winner_side === "a"
    ? { title: d.book_a_title, author: d.book_a_author, cover: d.book_a_cover, workId: d.book_a_work_id }
    : { title: d.book_b_title, author: d.book_b_author, cover: d.book_b_cover, workId: d.book_b_work_id };
}

function buildDuelsForRound(
  tournamentId: string,
  roundNumber: number,
  books: SeedBookView[],
  opensAtIso: string,
  roundDurationMinutes: number
): DuelRow[] {
  const closesAt = new Date(new Date(opensAtIso).getTime() + roundDurationMinutes * 60_000).toISOString();
  const rows: DuelRow[] = [];
  for (let i = 0; i < books.length; i += 2) {
    const a = books[i]!;
    const b = books[i + 1]!;
    rows.push({
      id: randomUUID(),
      tournament_id: tournamentId,
      round_number: roundNumber,
      duel_index: i / 2,
      book_a_title: a.title,
      book_a_author: a.author,
      book_a_cover: a.cover,
      book_a_work_id: a.workId,
      book_b_title: b.title,
      book_b_author: b.author,
      book_b_cover: b.cover,
      book_b_work_id: b.workId,
      winner_side: null,
      status: "active",
      opens_at: opensAtIso,
      closes_at: closesAt,
      settled_at: null
    });
  }
  return rows;
}

export type EmitPublished = (tournamentId: string, ownerUserId: string) => void;

export type EmitVotedOn = (voterUserId: string, tournamentId: string, tournamentName: string | null) => void;

export function createArenaService(
  repo: ArenaRepository,
  emitPublished?: EmitPublished,
  emitVotedOn?: EmitVotedOn,
  canonicalWorks: (ids: string[]) => Map<string, string> = canonicalWorkIds
): ArenaService {
  function sideOf(duel: DuelRow, workId: string): "a" | "b" {
    const found = canonicalWorks([workId, ...[duel.book_a_work_id, duel.book_b_work_id].filter((id): id is string => id !== null)]);
    const canonical = (id: string | null) => (id === null ? null : found.get(id) ?? id);
    const wanted = canonical(workId);
    if (canonical(duel.book_a_work_id) === wanted) return "a";
    if (canonical(duel.book_b_work_id) === wanted) return "b";
    throw new InvalidBookError();
  }

  /** Checks whether every duel in a round has settled, and if so either
   *  generates the next round (from the winners, same pairing logic as
   *  the first round) or — if that round had exactly one duel — marks
   *  the tournament completed. Called after any duel settles, whether
   *  via the scheduler's sweep, an early settle, or a tie-break. */
  function maybeAdvanceRound(tournament: TournamentRow, roundNumber: number, nowIso: string): void {
    const roundDuels = repo.getDuelsForRound(tournament.id, roundNumber);
    if (roundDuels.some((d) => d.status !== "settled")) return;

    const winners = roundDuels.sort((a, b) => a.duel_index - b.duel_index).map(winnerBookFromDuel);

    if (winners.length === 1) {
      repo.updateTournamentStatus(tournament.id, "completed", roundNumber);
      return;
    }

    const nextRoundNumber = roundNumber + 1;
    const nextDuels = buildDuelsForRound(tournament.id, nextRoundNumber, winners, nowIso, tournament.round_duration_minutes);
    repo.insertDuels(nextDuels);
    repo.updateTournamentStatus(tournament.id, "active", nextRoundNumber);
  }

  /** Shared by runScheduledSweep (force: false — only settles if
   *  closes_at has passed) and settleEarly (force: true — the owner's
   *  "settle now" action). Idempotent: a duel that's no longer `active`
   *  (already settled, or already tied-pending) is left alone, so a
   *  scheduler tick racing an owner's early settle can't double-process
   *  the same duel. */
  function settleDuelInternal(tournament: TournamentRow, duel: DuelRow, force: boolean, nowIso: string): void {
    if (duel.status !== "active") return;
    if (!force && duel.closes_at > nowIso) return;

    const votes = repo.countVotesBySide(duel.id);

    if (votes.a === votes.b) {
      repo.updateDuelSettlement(duel.id, "tied_pending_tiebreak", null, null);
      return;
    }

    repo.updateDuelSettlement(duel.id, "settled", votes.a > votes.b ? "a" : "b", nowIso);
    maybeAdvanceRound(tournament, duel.round_number, nowIso);
  }

  function toDuelView(d: DuelRow, voterToken: string | undefined, viewerUserId: string | null | undefined): DuelView {
    const votes = repo.countVotesBySide(d.id);
    return {
      id: d.id,
      roundNumber: d.round_number,
      duelIndex: d.duel_index,
      bookA: { workId: d.book_a_work_id, title: d.book_a_title, author: d.book_a_author, cover: d.book_a_cover, votes: votes.a },
      bookB: { workId: d.book_b_work_id, title: d.book_b_title, author: d.book_b_author, cover: d.book_b_cover, votes: votes.b },
      winnerWorkId: d.winner_side === null ? null : d.winner_side === "a" ? d.book_a_work_id : d.book_b_work_id,
      status: d.status,
      opensAt: d.opens_at,
      closesAt: d.closes_at,
      // Account-wide, not just this token: a signed-in voter on a fresh
      // browser already had their vote locked in (idx_votes_duel_user),
      // and the badge must say so instead of dangling a vote the API
      // would reject as already cast.
      hasVoted: repo.hasVoted(d.id, voterToken ?? null, viewerUserId ?? null)
    };
  }

  return {
    createTournament(ownerUserId, input) {
      if (!isPowerOfTwo(input.bracketSize)) throw new InvalidBracketSizeError();
      const now = new Date().toISOString();
      const row: TournamentRow = {
        id: randomUUID(),
        owner_user_id: ownerUserId,
        name: input.name,
        bracket_size: input.bracketSize,
        round_duration_minutes: input.roundDurationMinutes,
        status: "seeding",
        current_round: 0,
        created_at: now,
        updated_at: now
      };
      repo.insertTournament(row);
      return toTournamentSummary(row, EMPTY_PREVIEW, null);
    },

    listMine(ownerUserId) {
      return summariesWithPreviews(repo, repo.listTournamentsByOwner(ownerUserId));
    },

    listVoted(voterUserId) {
      return summariesWithPreviews(repo, repo.listVotedByUser(voterUserId));
    },

    participationByOwner(ownerUserId, since) {
      return repo.listParticipation(ownerUserId, since).map((row) => ({
        id: row.id,
        name: row.name,
        covers: previewFromSlots(repo.getSlots(row.id)).covers,
        participantCount: row.participants,
        latestAt: row.latest_at,
        recent: repo.listRecentVoters(row.id, ownerUserId, RECENT_PARTICIPANT_LIMIT).map((r) => ({ userId: r.user_id, at: r.at }))
      }));
    },

    listPublic(limit, offset) {
      return summariesWithPreviews(repo, repo.listPublicTournaments(limit, offset));
    },

    discoverWindow(needle, limit) {
      return repo.discoverWindow(needle, limit).map((row) => ({ id: row.id, createdAt: row.created_at, ownerUserId: row.owner_user_id }));
    },

    listPublicByIds(ids) {
      return summariesWithPreviews(repo, repo.listPublicByIds(ids));
    },

    votedAmong(voterUserId, ids) {
      return repo.votedAmong(voterUserId, ids);
    },

    getTournamentView(id, voterToken, viewerUserId) {
      const tournament = repo.getTournament(id);
      if (!tournament) return null;
      const slots = repo.getSlots(id).sort((a, b) => a.slot_index - b.slot_index);
      const duels = repo
        .getDuelsForTournament(id)
        .sort((a, b) => a.round_number - b.round_number || a.duel_index - b.duel_index);
      return {
        ...toTournamentSummary(tournament, previewFromSlots(slots), winnerFromDuels(duels)),
        slots: slots.map((s) => ({ slotIndex: s.slot_index, workId: s.work_id, title: s.title, author: s.author, cover: s.cover_url })),
        duels: duels.map((d) => toDuelView(d, voterToken, viewerUserId))
      };
    },

    getPublicSummary(tournamentId) {
      const tournament = repo.getTournament(tournamentId);
      if (!tournament || tournament.status === "seeding") return undefined;
      const winner = winnerFromDuels(repo.getDuelsForTournament(tournament.id));
      return toTournamentSummary(tournament, previewFromSlots(repo.getSlots(tournament.id)), winner);
    },

    setSlotsManual(tournamentId, ownerUserId, requested) {
      const tournament = repo.getOwnedTournament(tournamentId, ownerUserId);
      if (!tournament) throw new TournamentNotFoundError();
      if (tournament.status !== "seeding") throw new TournamentAlreadyStartedError();

      const indices = new Set(requested.map((e) => e.slotIndex));
      if (indices.size !== requested.length) throw new DuplicateSlotError();
      if (requested.some((e) => e.slotIndex < 0 || e.slotIndex >= tournament.bracket_size)) {
        throw new InvalidSlotIndexError(tournament.bracket_size);
      }
      const works = new Set<string>();
      for (const { book } of requested) {
        if (works.has(book.workId)) throw new DuplicateBookError(book.title);
        works.add(book.workId);
      }

      // Full-replace, same semantics as PUT /library — see this module's
      // own domain/ports.ts comment on replaceSlots.
      const rows: TournamentSlotRow[] = requested.map((e) => ({
        tournament_id: tournamentId,
        slot_index: e.slotIndex,
        work_id: e.book.workId,
        title: e.book.title,
        author: e.book.author,
        cover_url: e.book.cover
      }));
      repo.replaceSlots(tournamentId, rows);
    },

    seedingSlots(tournamentId, ownerUserId) {
      const tournament = repo.getOwnedTournament(tournamentId, ownerUserId);
      if (!tournament) throw new TournamentNotFoundError();
      if (tournament.status !== "seeding") throw new TournamentAlreadyStartedError();
      return repo.getSlots(tournamentId);
    },

    randomFill(tournamentId, ownerUserId, requested) {
      const tournament = repo.getOwnedTournament(tournamentId, ownerUserId);
      if (!tournament) throw new TournamentNotFoundError();
      if (tournament.status !== "seeding") throw new TournamentAlreadyStartedError();
      const seen = new Set<string>();
      const unique = requested.filter((book) => !seen.has(book.workId) && (seen.add(book.workId), true));
      if (unique.length < tournament.bracket_size) throw new NotEnoughBooksError(tournament.bracket_size, unique.length);

      // Fisher-Yates.
      const shuffled = [...unique];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
      }
      const chosen = shuffled.slice(0, tournament.bracket_size);
      const rows: TournamentSlotRow[] = chosen.map((book, i) => ({
        tournament_id: tournamentId,
        slot_index: i,
        work_id: book.workId,
        title: book.title,
        author: book.author,
        cover_url: book.cover
      }));
      repo.replaceSlots(tournamentId, rows);
    },

    start(tournamentId, ownerUserId) {
      const tournament = repo.getOwnedTournament(tournamentId, ownerUserId);
      if (!tournament) throw new TournamentNotFoundError();
      if (tournament.status !== "seeding") throw new TournamentAlreadyStartedError();
      const slots = repo.getSlots(tournamentId).sort((a, b) => a.slot_index - b.slot_index);
      if (slots.length !== tournament.bracket_size) throw new IncompleteSeedError(tournament.bracket_size, slots.length);

      const books: SeedBookView[] = slots.map((s) => ({ workId: s.work_id, title: s.title, author: s.author, cover: s.cover_url }));
      const nowIso = new Date().toISOString();
      const duels = buildDuelsForRound(tournamentId, 1, books, nowIso, tournament.round_duration_minutes);
      repo.insertDuels(duels);
      repo.updateTournamentStatus(tournamentId, "active", 1);
      emitPublished?.(tournamentId, ownerUserId);
    },

    vote(tournamentId, duelId, voterToken, workId, voterUserId = null) {
      const duel = repo.getDuel(duelId);
      if (!duel || duel.tournament_id !== tournamentId) throw new DuelNotFoundError();
      if (duel.status !== "active" || new Date() >= new Date(duel.closes_at)) throw new DuelNotVotableError();
      const side = sideOf(duel, workId);

      const inserted = repo.insertVote({
        id: randomUUID(),
        duel_id: duelId,
        voter_token: voterToken,
        voter_user_id: voterUserId,
        side,
        created_at: new Date().toISOString()
      });
      // Backfill runs even when THIS duel was already voted: the token's
      // other votes should still join the account on a signed-in revisit.
      if (voterUserId) repo.linkVotesToUser(voterToken, voterUserId);
      if (!inserted) throw new AlreadyVotedError();
      if (voterUserId && emitVotedOn) {
        emitVotedOn(voterUserId, tournamentId, repo.getTournament(tournamentId)?.name ?? null);
      }
    },

    settleEarly(tournamentId, ownerUserId, duelId) {
      const tournament = repo.getOwnedTournament(tournamentId, ownerUserId);
      if (!tournament) throw new TournamentNotFoundError();
      const duel = repo.getDuel(duelId);
      if (!duel || duel.tournament_id !== tournamentId) throw new DuelNotFoundError();
      settleDuelInternal(tournament, duel, true, new Date().toISOString());
    },

    tiebreak(tournamentId, ownerUserId, duelId, workId) {
      const tournament = repo.getOwnedTournament(tournamentId, ownerUserId);
      if (!tournament) throw new TournamentNotFoundError();
      const duel = repo.getDuel(duelId);
      if (!duel || duel.tournament_id !== tournamentId) throw new DuelNotFoundError();
      if (duel.status !== "tied_pending_tiebreak") throw new DuelNotTiedError();
      const winnerSide = sideOf(duel, workId);

      const nowIso = new Date().toISOString();
      repo.updateDuelSettlement(duelId, "settled", winnerSide, nowIso);
      maybeAdvanceRound(tournament, duel.round_number, nowIso);
    },

    renameTournament(tournamentId, ownerUserId, name) {
      const tournament = repo.getOwnedTournament(tournamentId, ownerUserId);
      if (!tournament) throw new TournamentNotFoundError();
      repo.renameTournament(tournamentId, name);
    },
    deleteTournament(tournamentId, ownerUserId) {
      const tournament = repo.getOwnedTournament(tournamentId, ownerUserId);
      if (!tournament) throw new TournamentNotFoundError();
      repo.deleteTournament(tournamentId);
    },

    runScheduledSweep(nowIso = new Date().toISOString()) {
      for (const duel of repo.findActiveDuelsPastDeadline(nowIso)) {
        const tournament = repo.getTournament(duel.tournament_id);
        if (!tournament) continue; // shouldn't happen (ON DELETE CASCADE), but never let one bad row crash the sweep
        settleDuelInternal(tournament, duel, false, nowIso);
      }
    }
  };
}

export interface PublishedTournamentRef {
  id: string;
  ownerUserId: string;
  createdAt: string;
  name: string;
  bracketSize: number;
  status: "active" | "completed";
  covers: string[];
}

export interface ArenaPublicApi {
  discoverWindow(needle: string, limit: number): TournamentDiscoverRef[];
  getPublishedMany(ids: string[]): PublishedTournamentRef[];
  votedAmong(voterUserId: string, ids: string[]): string[];
  getPublished(id: string): PublishedTournamentRef | undefined;
  listPublishedByOwner(ownerUserId: string): PublishedTournamentRef[];
  participationByOwner(ownerUserId: string, since: string): GameParticipation[];
}

function toPublishedRef(summary: TournamentSummary): PublishedTournamentRef {
  return {
    id: summary.id,
    ownerUserId: summary.ownerUserId,
    createdAt: summary.createdAt,
    name: summary.name,
    bracketSize: summary.bracketSize,
    status: summary.status === "completed" ? "completed" : "active",
    covers: summary.covers
  };
}

export function createArenaPublicApi(service: ArenaService): ArenaPublicApi {
  return {
    discoverWindow: (needle, limit) => service.discoverWindow(needle, limit),
    getPublishedMany: (ids) => service.listPublicByIds(ids).map(toPublishedRef),
    votedAmong: (voterUserId, ids) => service.votedAmong(voterUserId, ids),
    getPublished: (id) => {
      const summary = service.getPublicSummary(id);
      return summary ? toPublishedRef(summary) : undefined;
    },
    listPublishedByOwner: (ownerUserId) =>
      service.listMine(ownerUserId).filter((s) => s.status !== "seeding").map(toPublishedRef),
    participationByOwner: (ownerUserId, since) => service.participationByOwner(ownerUserId, since)
  };
}
