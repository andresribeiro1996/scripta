// Business logic for the tierlists module. Depends only on the
// TierlistsRepository port, not on SQLite — same reasoning as every other
// module's service.ts.

import { randomBytes, randomUUID } from "node:crypto";
import { DEFAULT_TIER_PRESET, type PublicBookData, type ResolvedTierlist, type TierlistData, type VotedTierlist } from "@scripta/shared";
import type { GameParticipation, RankingTierPreview } from "@scripta/shared/community";
import { boardWorks } from "./domain/boardKeys.js";
import { canonicalBoard, storedIds } from "./domain/board.js";
import type { TierlistsRepository, TierlistWorks } from "./domain/ports.js";
import type { BallotRow, HistogramCell, Placement, Tierlist, TierlistGameRow, TierlistRow, TierlistShelfFacts, TierPlacement, VoteAccess } from "./domain/types.js";

function toTierlist(row: TierlistRow): Tierlist {
  const parsed = JSON.parse(row.data) as { tiers?: unknown; pool?: unknown };
  return {
    id: row.id,
    name: row.name,
    data: { tiers: parsed.tiers ?? [], pool: parsed.pool ?? [] },
    voteCode: row.vote_code,
    voteAccess: row.vote_access,
    votingOpen: row.voting_open === 1,
    sourceTierlistId: row.source_tierlist_id,
    promotedAt: row.promoted_at,
    originCreatorId: row.origin_user_id,
    ranksWorstFirst: row.ranks_worst_first === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export type Voter = { kind: "user"; userId: string } | { kind: "anonymous"; ballotId: string | null };

export type BallotOutcome =
  | { ok: true; ballotId: string; placements: Placement[] }
  | { ok: false; reason: "not-found" | "closed" | "members-only" | "invalid" };

export interface VotingBoard {
  id: string;
  /** For routes.ts's resolvePublicLibraryData call only — never serialized
   *  to a public response. */
  ownerUserId: string;
  name: string;
  tiers: Array<{ id: string; label: string; color: string }>;
  pool: string[];
  access: VoteAccess;
  votingOpen: boolean;
  histogram: HistogramCell[];
  ballotCount: number;
  eligibleVoteCount: number;
  promotedAt: string | null;
  publicBooks: unknown[] | null;
  ranksWorstFirst: boolean;
}

export interface PublicTierlistSummary {
  voteCode: string;
  name: string;
  poolSize: number;
  ballotCount: number;
  eligibleVoteCount: number;
  promotedAt: string | null;
  votingOpen: boolean;
}

export interface PublishedTierlistRef {
  id: string;
  ownerUserId: string;
  createdAt: string;
  voteCode: string;
  name: string;
  poolSize: number;
  ballotCount: number;
  eligibleVoteCount: number;
  promotedAt: string | null;
  votingOpen: boolean;
  covers: string[];
}

export interface TierlistDiscoverRef {
  id: string;
  createdAt: string;
  ownerUserId: string;
  promotedAt: string | null;
}

export interface GameByWork {
  id: string;
  name: string;
  path: string;
  ownerUserId: string | null;
}

function knownFor(works: TierlistWorks, data: unknown): Map<string, string> {
  return works.canonicalByKey(new Map(storedIds(data).map((id) => [id, id])));
}

export type TierlistWriteOutcome =
  | { ok: true; tierlist: Tierlist; data: TierlistData }
  | { ok: false; reason: "not-found" | "invalid"; error: string }
  | { ok: false; reason: "duplicate-work"; title: string | null };

type StoredBoard = { ok: true; data: TierlistData } | Exclude<TierlistWriteOutcome, { ok: true }>;

export interface TierlistsService {
  listTierlists(userId: string): Tierlist[];
  createTierlist(userId: string, input: { name: string; data?: TierlistData; access?: VoteAccess; ranksWorstFirst?: boolean }): TierlistWriteOutcome;
  /** undefined if no tier list with that id is owned by userId — a
   *  caller-facing 404, not a server error. Same convention as
   *  modules/murals/service.ts's getMural. */
  getTierlist(userId: string, id: string): Tierlist | undefined;
  /** Partial merge onto the existing row — only the keys present in
   *  `patch` change. not-found if not owned or already public. */
  updateTierlist(userId: string, id: string, patch: { name?: string; data?: TierlistData }): TierlistWriteOutcome;
  /** Returns false if no tier list with that id was owned by userId —
   *  same convention as modules/murals/service.ts's deleteMural. */
  deleteTierlist(userId: string, id: string): boolean;
  /** Publishes the existing tier list and seeds the owner's ranking. */
  openVoting(userId: string, id: string, access: VoteAccess): { tierlist: Tierlist; known: Map<string, string> } | undefined;
  booksInOrder(ownerUserId: string, workIds: string[]): PublicBookData[];
  setVotingState(userId: string, id: string, patch: { access?: VoteAccess; open?: boolean }): Tierlist | undefined;
  submitBallot(code: string, placements: Placement[], voter: Voter): BallotOutcome;
  getBallot(code: string, voter: Voter): BallotOutcome;
  getResults(tierlistId: string): { histogram: HistogramCell[]; ballotCount: number };
  getVotingBoard(code: string): VotingBoard | undefined;
  listPublicTierlists(limit: number, offset: number): PublicTierlistSummary[];
  discoverWindow(needle: string, limit: number): TierlistDiscoverRef[];
  getPublishedRefs(ids: string[]): PublishedTierlistRef[];
  listPublishedByWorks(workIds: string[], limit: number): TierlistGameRow[];
  tierPlacements(workIds: string[]): TierPlacement[];
  topShelfFacts(since: string | null, until: string | null): TierlistShelfFacts[];
  votedAmong(voterUserId: string, ids: string[]): string[];
  getPublishedRef(id: string): PublishedTierlistRef | undefined;
  fillRankingCovers(tierlistId: string, ranking: RankingTierPreview[]): RankingTierPreview[];
  listPublishedRefsByOwner(ownerUserId: string): PublishedTierlistRef[];
  /** Public tier lists the account has a ballot on, latest ballot first —
   *  own polls excluded (openVoting seeds the owner's ballot, which is
   *  not participation). Feeds the "Voted on" section of the games list. */
  listVotedByUser(voterUserId: string): VotedTierlist[];
  participationByOwner(ownerUserId: string, since: string): GameParticipation[];
}

/** Where a new tier list starts — the familiar S–D ladder, matching the
 *  preset the old mural-embedded tier list used to seed (down to the
 *  colors). Not a fixed scale: the editor can rename/recolor/reorder/
 *  delete every one of these and add more — this is just the starting
 *  point, so "New tier list" opens on a recognizable board instead of
 *  an empty one. */
// Unambiguous alphabet: no 0/O/1/I/L, because these codes get read aloud
// and typed by hand. 8 chars over 32 symbols is ~10^12 combinations —
// enough that a poll isn't stumbled upon, though it is an identifier and
// not a secret (community tier lists are publicly listed; vote_access is
// what actually authorizes a ballot).
const CODE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

export function generateVoteCode(): string {
  const bytes = randomBytes(8);
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

/** The two places this module looks inside the opaque `data` document —
 *  see the spec's "Why duplication simplifies everything downstream". */
interface TierlistDocument {
  tiers: Array<{ id: string; label: string; color: string; workIds: string[] }>;
  pool: string[];
}

function readDocument(tierlist: Tierlist): TierlistDocument {
  const data = (tierlist.data ?? {}) as Partial<TierlistDocument>;
  return { tiers: data.tiers ?? [], pool: data.pool ?? [] };
}

const COVER_PREVIEW_LIMIT = 8;
const RECENT_PARTICIPANT_LIMIT = 10;

export type CoverPeek = (params: Array<{ isbn: string | null; title: string | null; author: string | null }>) => Array<string | null>;

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function fillMissingCovers(books: unknown[], peek: CoverPeek | undefined): unknown[] {
  if (!peek) return books;
  const missing = books.flatMap((book, index) => {
    if (!book || typeof book !== "object") return [];
    const entry = book as Record<string, unknown>;
    return typeof entry.coverUrl === "string" && entry.coverUrl ? [] : [index];
  });
  if (missing.length === 0) return books;
  const urls = peek(missing.map((index) => {
    const entry = books[index] as Record<string, unknown>;
    return { isbn: text(entry.isbn), title: text(entry.title), author: text(entry.author) };
  }));
  const filled = [...books];
  missing.forEach((index, position) => {
    const url = urls[position];
    if (url) filled[index] = { ...(books[index] as Record<string, unknown>), coverUrl: url };
  });
  return filled;
}

/** The public voting board's book snapshot — null when absent or corrupt. */
function parsePublicBooks(value: string | null): unknown[] | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown[];
  } catch {
    return null;
  }
}

function fillPublicBooks(books: unknown[] | null, peek: CoverPeek | undefined): unknown[] | null {
  return Array.isArray(books) ? fillMissingCovers(books, peek) : books;
}

/** Covers come from the published snapshot rather than the owner's live
 *  library: a stranger reading the feed can't resolve the owner's books,
 *  and the snapshot is what the vote page already shows them. */
function publishedCovers(publicBooks: string | null, peek: CoverPeek | undefined): string[] {
  const parsed = parsePublicBooks(publicBooks);
  if (!Array.isArray(parsed)) return [];
  const wanted: unknown[] = [];
  for (const book of parsed) {
    if (wanted.length >= COVER_PREVIEW_LIMIT) break;
    if (!book || typeof book !== "object") continue;
    const url = (book as Record<string, unknown>).coverUrl;
    if (peek || (typeof url === "string" && url)) wanted.push(book);
  }
  const covers: string[] = [];
  for (const book of fillMissingCovers(wanted, peek)) {
    const url = (book as Record<string, unknown>).coverUrl;
    if (typeof url === "string" && url) covers.push(url);
  }
  return covers;
}

function toPublishedRef(row: TierlistRow, ballotCount: number, peek: CoverPeek | undefined): PublishedTierlistRef {
  const { tiers, pool } = readDocument(toTierlist(row));
  const keys = new Set(pool);
  for (const tier of tiers) for (const id of tier.workIds) keys.add(id);
  return {
    id: row.id,
    ownerUserId: row.origin_user_id,
    createdAt: row.created_at,
    voteCode: row.vote_code!,
    name: row.name,
    poolSize: keys.size,
    ballotCount,
    eligibleVoteCount: 0,
    promotedAt: row.promoted_at,
    votingOpen: row.voting_open === 1,
    covers: publishedCovers(row.public_books, peek)
  };
}

export type EmitPublished = (tierlistId: string, ownerUserId: string) => void;

export type EmitVotedOn = (voterUserId: string, tierlistId: string, tierlistName: string, ranking: RankingTierPreview[]) => void;

export function createTierlistsService(repo: TierlistsRepository, works: TierlistWorks, emitPublished?: EmitPublished, emitVotedOn?: EmitVotedOn, peekCovers?: CoverPeek): TierlistsService {
  function storedBoard(board: TierlistData): StoredBoard {
    const all = [...board.tiers.flatMap((tier) => tier.workIds), ...board.pool];
    if (new Set(all).size !== all.length) return { ok: false, reason: "invalid", error: "Duplicate tier or book." };
    const ids = works.knownWorkIds(all);
    if (new Set(ids).size !== ids.length) return { ok: false, reason: "duplicate-work", title: null };
    const canonical = new Map(all.map((id, index) => [id, ids[index]!]));
    const swap = (workIds: string[]) => workIds.map((id) => canonical.get(id)!);
    return { ok: true, data: { tiers: board.tiers.map((tier) => ({ ...tier, workIds: swap(tier.workIds) })), pool: swap(board.pool) } };
  }

  function booksInOrder(ownerUserId: string, workIds: string[]): PublicBookData[] {
    const found = works.publicBooksByWork(ownerUserId, workIds);
    return workIds.flatMap((id) => found.get(id) ?? []);
  }

  return {
    listTierlists(userId) {
      return repo.listByUser(userId).map(toTierlist);
    },

    createTierlist(userId, { name, data, access, ranksWorstFirst = false }) {
      if (access && !data) return { ok: false, reason: "invalid", error: "Choose books and tiers before publishing." };
      if (data) {
        const tierIds = data.tiers.map((tier) => tier.id);
        if (new Set(tierIds).size !== tierIds.length) return { ok: false, reason: "invalid", error: "Duplicate tier or book." };
        if (access && (!data.pool.length || data.tiers.some((tier) => tier.workIds.length))) return { ok: false, reason: "invalid", error: "Public tier lists need an unranked book pool." };
      }
      let board: TierlistData;
      let publicBooks: PublicBookData[] = [];
      if (data) {
        const stored = storedBoard(data);
        if (!stored.ok) return stored;
        board = stored.data;
        if (access) {
          publicBooks = booksInOrder(userId, board.pool);
          if (publicBooks.length !== board.pool.length) return { ok: false, reason: "invalid", error: "A selected book is no longer in your library." };
        }
      } else {
        board = { tiers: DEFAULT_TIER_PRESET.map((t) => ({ id: randomUUID(), label: t.label, color: t.color, workIds: [] })), pool: [] };
      }
      const now = new Date().toISOString();
      const row: TierlistRow = {
        id: randomUUID(),
        owner_user_id: userId,
        origin_user_id: userId,
        name,
        data: JSON.stringify(board),
        vote_code: access ? generateVoteCode() : null,
        vote_access: access ?? "anonymous",
        voting_open: access ? 1 : 0,
        source_tierlist_id: null,
        promoted_at: null,
        public_books: access ? JSON.stringify(publicBooks) : null,
        ranks_worst_first: ranksWorstFirst ? 1 : 0,
        created_at: now,
        updated_at: now
      };
      repo.insert(row);
      if (access) emitPublished?.(row.id, userId);
      return { ok: true, tierlist: toTierlist(row), data: board };
    },

    getTierlist(userId, id) {
      const row = repo.getOwned(id, userId);
      return row ? toTierlist(row) : undefined;
    },

    updateTierlist(userId, id, patch) {
      const existing = repo.getOwned(id, userId);
      if (!existing || existing.vote_code !== null) return { ok: false, reason: "not-found", error: "No tier list with that id." };
      let board: TierlistData;
      if (patch.data !== undefined) {
        const stored = storedBoard(patch.data);
        if (!stored.ok) return stored;
        board = stored.data;
      } else {
        const current = toTierlist(existing);
        board = canonicalBoard(current.data, knownFor(works, current.data));
      }
      const row = repo.update(id, userId, {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.data !== undefined ? { data: JSON.stringify(board) } : {})
      });
      if (!row) return { ok: false, reason: "not-found", error: "No tier list with that id." };
      return { ok: true, tierlist: toTierlist(row), data: board };
    },

    deleteTierlist(userId, id) {
      return repo.delete(id, userId);
    },

    booksInOrder,

    openVoting(userId, id, access) {
      const row = repo.getOwned(id, userId);
      if (!row || row.vote_code !== null) return undefined;
      const original = toTierlist(row);
      const known = knownFor(works, original.data);
      const publicBooks = booksInOrder(userId, boardWorks(original.data));

      const { tiers, pool } = readDocument(original);
      const placements: Placement[] = [];
      const poolWorks = new Set(pool);
      for (const tier of tiers) {
        for (const workId of tier.workIds) {
          placements.push({ workId, tierId: tier.id });
          poolWorks.add(workId);
        }
      }

      const now = new Date().toISOString();
      const ballot: BallotRow = {
        id: randomUUID(),
        tierlist_id: original.id,
        voter_user_id: userId,
        created_at: now,
        updated_at: now
      };

      const published = repo.publish(original.id, userId, JSON.stringify({ tiers: tiers.map((t) => ({ ...t, workIds: [] })), pool: [...poolWorks] }), access, generateVoteCode(), JSON.stringify(publicBooks), ballot, placements);
      if (!published) return undefined;
      emitPublished?.(original.id, userId);
      return { tierlist: toTierlist(published), known };
    },

    setVotingState(userId, id, patch) {
      const row = repo.setVoting(id, userId, {
        ...(patch.access !== undefined ? { vote_access: patch.access } : {}),
        ...(patch.open !== undefined ? { voting_open: patch.open ? 1 : 0 } : {})
      });
      return row ? toTierlist(row) : undefined;
    },

    submitBallot(code, placements, voter) {
      const row = repo.getByVoteCode(code);
      if (!row) return { ok: false, reason: "not-found" };
      if (row.voting_open !== 1) return { ok: false, reason: "closed" };
      if (row.vote_access === "members" && voter.kind !== "user") return { ok: false, reason: "members-only" };

      const { tiers, pool } = readDocument(toTierlist(row));
      const validPool = new Set(pool);
      const validTiers = new Set(tiers.map((t) => t.id));
      const seen = new Set<string>();
      for (const placement of placements) {
        if (!validPool.has(placement.workId)) return { ok: false, reason: "invalid" };
        if (!validTiers.has(placement.tierId)) return { ok: false, reason: "invalid" };
        if (seen.has(placement.workId)) return { ok: false, reason: "invalid" };
        seen.add(placement.workId);
      }

      const existing =
        voter.kind === "user"
          ? repo.getBallotByVoter(row.id, voter.userId)
          : voter.ballotId
            ? repo.getBallotById(row.id, voter.ballotId)
            : undefined;

      const now = new Date().toISOString();
      const ballot: BallotRow = existing
        ? { ...existing, updated_at: now }
        : {
            id: randomUUID(),
            tierlist_id: row.id,
            voter_user_id: voter.kind === "user" ? voter.userId : null,
            created_at: now,
            updated_at: now
          };

      let ranking: RankingTierPreview[] | undefined;
      if (!existing && voter.kind === "user" && emitVotedOn) {
        const snapshot = parsePublicBooks(row.public_books);
        const books = new Map((Array.isArray(snapshot) ? snapshot : []).flatMap((entry) => {
          if (!entry || typeof entry !== "object") return [];
          const book = entry as Record<string, unknown>;
          return typeof book.workId === "string" && typeof book.title === "string" ? [[book.workId, book] as const] : [];
        }));
        const picked = tiers
          .map((tier) => ({ label: tier.label, color: tier.color, entries: placements.filter((placement) => placement.tierId === tier.id).slice(0, 2).flatMap((placement) => { const book = books.get(placement.workId); return book ? [book] : []; }) }))
          .filter((tier) => tier.entries.length > 0)
          .slice(0, 3);
        const filled = fillMissingCovers(picked.flatMap((tier) => tier.entries), peekCovers) as Array<Record<string, unknown>>;
        let next = 0;
        ranking = picked.map((tier) => ({
          label: tier.label,
          color: tier.color,
          books: tier.entries.map(() => {
            const book = filled[next++]!;
            return { title: book.title as string, coverUrl: typeof book.coverUrl === "string" ? book.coverUrl : null };
          })
        }));
      }

      repo.saveBallot(ballot, placements);
      if (ranking && voter.kind === "user" && emitVotedOn) emitVotedOn(voter.userId, row.id, row.name, ranking);
      if (voter.kind === "user" && voter.userId !== row.origin_user_id && row.promoted_at === null && repo.eligibleVoteCount(row.id, row.origin_user_id) >= 100) {
        repo.promote(row.id, now);
      }
      return { ok: true, ballotId: ballot.id, placements };
    },

    getBallot(code, voter) {
      const row = repo.getByVoteCode(code);
      if (!row) return { ok: false, reason: "not-found" };

      const existing =
        voter.kind === "user"
          ? repo.getBallotByVoter(row.id, voter.userId)
          : voter.ballotId
            ? repo.getBallotById(row.id, voter.ballotId)
            : undefined;
      if (!existing) return { ok: false, reason: "not-found" };

      return { ok: true, ballotId: existing.id, placements: repo.getPlacements(existing.id) };
    },

    getResults(tierlistId) {
      return { histogram: repo.histogram(tierlistId), ballotCount: repo.ballotCount(tierlistId) };
    },

    getVotingBoard(code) {
      const row = repo.getByVoteCode(code);
      if (!row) return undefined;
      const { tiers, pool } = readDocument(toTierlist(row));
      return {
        id: row.id,
        ownerUserId: row.origin_user_id,
        name: row.name,
        tiers: tiers.map((t) => ({ id: t.id, label: t.label, color: t.color })),
        pool,
        access: row.vote_access,
        votingOpen: row.voting_open === 1,
        histogram: repo.histogram(row.id),
        ballotCount: repo.ballotCount(row.id),
        eligibleVoteCount: repo.eligibleVoteCount(row.id, row.origin_user_id),
        promotedAt: row.promoted_at,
        // Corrupt JSON here omits the field rather than 500ing the whole
        // public voting board — same defensive stance as murals' shared
        // route and library's getPublicByToken.
        publicBooks: fillPublicBooks(parsePublicBooks(row.public_books), peekCovers),
        ranksWorstFirst: row.ranks_worst_first === 1
      };
    },

    listPublicTierlists(limit, offset) {
      const counts = repo.ballotCountsByTierlist();
      return repo.listPublic(limit, offset).map((row) => {
        const ref = toPublishedRef(row, counts.get(row.id) ?? 0, undefined);
        return { voteCode: ref.voteCode, name: ref.name, poolSize: ref.poolSize, ballotCount: ref.ballotCount, eligibleVoteCount: repo.eligibleVoteCount(row.id, row.origin_user_id), promotedAt: ref.promotedAt, votingOpen: ref.votingOpen };
      });
    },

    discoverWindow(needle, limit) {
      return repo.discoverWindow(needle, limit).map((row) => ({ id: row.id, createdAt: row.created_at, ownerUserId: row.origin_user_id, promotedAt: row.promoted_at }));
    },

    getPublishedRefs(ids) {
      const totals = repo.ballotTotalsFor(ids);
      return repo.listPublicByIds(ids).map((row) => {
        const total = totals.get(row.id);
        return { ...toPublishedRef(row, total?.ballots ?? 0, peekCovers), eligibleVoteCount: total?.eligible ?? 0 };
      });
    },

    listPublishedByWorks: (workIds, limit) => repo.listPublishedByWorks(workIds, limit),

    tierPlacements: (workIds) => repo.tierPlacements(workIds),

    topShelfFacts: (since, until) => repo.topShelfFacts(since, until),

    votedAmong(voterUserId, ids) {
      return repo.votedAmong(voterUserId, ids);
    },

    fillRankingCovers(tierlistId, ranking) {
      const titles = new Set(ranking.flatMap((tier) => tier.books.filter((book) => !book.coverUrl).map((book) => book.title)));
      const snapshot = parsePublicBooks(repo.getPublicById(tierlistId)?.public_books ?? null);
      if (titles.size === 0 || !Array.isArray(snapshot)) return ranking;
      const candidates = snapshot.filter((entry) => !!entry && typeof entry === "object" && titles.has(text((entry as Record<string, unknown>).title) ?? ""));
      const covers = new Map<string, string>();
      for (const entry of fillMissingCovers(candidates, peekCovers) as Array<Record<string, unknown>>) {
        const title = text(entry.title);
        if (title && typeof entry.coverUrl === "string" && entry.coverUrl && !covers.has(title)) covers.set(title, entry.coverUrl);
      }
      return ranking.map((tier) => ({ ...tier, books: tier.books.map((book) => (book.coverUrl ? book : { ...book, coverUrl: covers.get(book.title) ?? null })) }));
    },

    getPublishedRef(id) {
      const row = repo.getPublicById(id);
      return row ? { ...toPublishedRef(row, repo.ballotCount(id), peekCovers), eligibleVoteCount: repo.eligibleVoteCount(row.id, row.origin_user_id) } : undefined;
    },

    listPublishedRefsByOwner(ownerUserId) {
      const counts = repo.ballotCountsByTierlist();
      return repo.listPublicByUser(ownerUserId).map((row) => ({ ...toPublishedRef(row, counts.get(row.id) ?? 0, peekCovers), eligibleVoteCount: repo.eligibleVoteCount(row.id, row.origin_user_id) }));
    },

    listVotedByUser(voterUserId) {
      const counts = repo.ballotCountsByTierlist();
      return repo.listVotedByUser(voterUserId).map((row) => ({ ...toPublishedRef(row, counts.get(row.id) ?? 0, peekCovers), eligibleVoteCount: repo.eligibleVoteCount(row.id, row.origin_user_id) }));
    },

    participationByOwner(ownerUserId, since) {
      return repo.listParticipation(ownerUserId, since).map((row) => ({
        id: row.id,
        name: row.name,
        covers: publishedCovers(row.public_books, peekCovers),
        participantCount: row.participants,
        latestAt: row.latest_at,
        recent: repo.listRecentVoters(row.id, ownerUserId, RECENT_PARTICIPANT_LIMIT).map((r) => ({ userId: r.user_id, at: r.at }))
      }));
    }
  };
}

/** tierlists' cross-module public surface — the ONLY way another module
 *  (murals, for its public GET /murals/shared/:token route) may read a
 *  tier list. app.ts gets a ready-built instance from plugin.ts's
 *  getTierlistsPublicApi(), exported through index.ts; never reach into
 *  this module's internals (service.ts, adapters/, domain/) for this —
 *  same module-boundary discipline every cross-module import in this
 *  codebase already follows. */
export interface TierlistsPublicApi {
  getTierlistData(ownerUserId: string, tierlistId: string): ResolvedTierlist | undefined;
  discoverWindow(needle: string, limit: number): TierlistDiscoverRef[];
  getPublishedMany(ids: string[]): PublishedTierlistRef[];
  votedAmong(voterUserId: string, ids: string[]): string[];
  publishedByWorks(workIds: string[], limit: number): GameByWork[];
  discoverByWorks(workIds: string[], limit: number): TierlistDiscoverRef[];
  tierPlacements(workIds: string[]): TierPlacement[];
  topShelfFacts(since: string | null, until: string | null): TierlistShelfFacts[];
  getPublished(id: string): PublishedTierlistRef | undefined;
  fillRankingCovers(tierlistId: string, ranking: RankingTierPreview[]): RankingTierPreview[];
  listPublishedByOwner(ownerUserId: string): PublishedTierlistRef[];
  participationByOwner(ownerUserId: string, since: string): GameParticipation[];
}

/** Factory over the service. app.ts can't call this directly — it has no
 *  way (and no business) constructing a TierlistsService itself — so
 *  plugin.ts wraps it in the lazily-composed getTierlistsPublicApi(). */
export function createTierlistsPublicApi(service: TierlistsService, works: TierlistWorks): TierlistsPublicApi {
  return {
    getTierlistData(ownerUserId, tierlistId) {
      const tierlist = service.getTierlist(ownerUserId, tierlistId);
      if (!tierlist) return undefined;
      return { name: tierlist.name, ...canonicalBoard(tierlist.data, knownFor(works, tierlist.data)) };
    },
    discoverWindow: (needle, limit) => service.discoverWindow(needle, limit),
    getPublishedMany: (ids) => service.getPublishedRefs(ids),
    votedAmong: (voterUserId, ids) => service.votedAmong(voterUserId, ids),
    publishedByWorks: (workIds, limit) =>
      service.listPublishedByWorks(workIds, limit).map((row) => ({
        id: row.id,
        name: row.name,
        path: `/vote/${row.vote_code}`,
        ownerUserId: row.owner_user_id === "__app__" ? null : row.origin_user_id
      })),
    discoverByWorks: (workIds, limit) =>
      service.listPublishedByWorks(workIds, limit).map((row) => ({ id: row.id, createdAt: row.created_at, ownerUserId: row.origin_user_id, promotedAt: row.promoted_at })),
    tierPlacements: (workIds) => service.tierPlacements(workIds),
    topShelfFacts: (since, until) => service.topShelfFacts(since, until),
    getPublished: (id) => service.getPublishedRef(id),
    fillRankingCovers: (tierlistId, ranking) => service.fillRankingCovers(tierlistId, ranking),
    listPublishedByOwner: (ownerUserId) => service.listPublishedRefsByOwner(ownerUserId),
    participationByOwner: (ownerUserId, since) => service.participationByOwner(ownerUserId, since)
  };
}

export type { TierlistShelfFacts };
