// Business logic for the tierlists module. Depends only on the
// TierlistsRepository port, not on SQLite — same reasoning as every other
// module's service.ts.

import { randomBytes, randomUUID } from "node:crypto";
import { DEFAULT_TIER_PRESET } from "@scripta/shared";
import type { GameParticipation } from "@scripta/shared/community";
import type { TierlistsRepository } from "./domain/ports.js";
import type { BallotRow, HistogramCell, Placement, Tierlist, TierlistGameRow, TierlistRow, VoteAccess } from "./domain/types.js";
import { canonicalBoard } from "./wire.js";

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

export interface TierlistsService {
  listTierlists(userId: string): Tierlist[];
  createTierlist(userId: string, name: string, data?: TierlistDocument, access?: VoteAccess, publicBooks?: unknown[]): Tierlist;
  /** undefined if no tier list with that id is owned by userId — a
   *  caller-facing 404, not a server error. Same convention as
   *  modules/murals/service.ts's getMural. */
  getTierlist(userId: string, id: string): Tierlist | undefined;
  /** Partial merge onto the existing row — only the keys present in
   *  `patch` change. undefined if not owned. */
  updateTierlist(userId: string, id: string, patch: { name?: string; data?: unknown }): Tierlist | undefined;
  /** Returns false if no tier list with that id was owned by userId —
   *  same convention as modules/murals/service.ts's deleteMural. */
  deleteTierlist(userId: string, id: string): boolean;
  /** Publishes the existing tier list and seeds the owner's ranking. */
  openVoting(userId: string, id: string, access: VoteAccess, publicBooks?: unknown[]): Tierlist | undefined;
  setVotingState(userId: string, id: string, patch: { access?: VoteAccess; open?: boolean }): Tierlist | undefined;
  submitBallot(code: string, placements: Placement[], voter: Voter): BallotOutcome;
  getBallot(code: string, voter: Voter): BallotOutcome;
  getResults(tierlistId: string): { histogram: HistogramCell[]; ballotCount: number };
  getVotingBoard(code: string): VotingBoard | undefined;
  listPublicTierlists(limit: number, offset: number): PublicTierlistSummary[];
  discoverWindow(needle: string, limit: number): TierlistDiscoverRef[];
  getPublishedRefs(ids: string[]): PublishedTierlistRef[];
  listPublishedByWorks(workIds: string[], limit: number): TierlistGameRow[];
  votedAmong(voterUserId: string, ids: string[]): string[];
  getPublishedRef(id: string): PublishedTierlistRef | undefined;
  listPublishedRefsByOwner(ownerUserId: string): PublishedTierlistRef[];
  /** Public tier lists the account has a ballot on, latest ballot first —
   *  own polls excluded (openVoting seeds the owner's ballot, which is
   *  not participation). Feeds the "Voted on" section of the games list. */
  listVotedByUser(voterUserId: string): PublishedTierlistRef[];
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

/** Covers come from the published snapshot rather than the owner's live
 *  library: a stranger reading the feed can't resolve the owner's books,
 *  and the snapshot is what the vote page already shows them. */
function publishedCovers(publicBooks: string | null): string[] {
  if (!publicBooks) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(publicBooks);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const covers: string[] = [];
  for (const book of parsed) {
    if (covers.length >= COVER_PREVIEW_LIMIT) break;
    const url = (book as Record<string, unknown> | null)?.coverUrl;
    if (typeof url === "string" && url) covers.push(url);
  }
  return covers;
}

/** The public voting board's book snapshot — null when absent or corrupt
 *  (see publishedCovers above for the same defensive JSON.parse stance). */
function parsePublicBooks(value: string | null): unknown[] | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown[];
  } catch {
    return null;
  }
}

function toPublishedRef(row: TierlistRow, ballotCount: number): PublishedTierlistRef {
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
    covers: publishedCovers(row.public_books)
  };
}

export type EmitPublished = (tierlistId: string, ownerUserId: string) => void;

export type EmitVotedOn = (voterUserId: string, tierlistId: string, tierlistName: string) => void;

export function createTierlistsService(repo: TierlistsRepository, emitPublished?: EmitPublished, emitVotedOn?: EmitVotedOn): TierlistsService {
  return {
    listTierlists(userId) {
      return repo.listByUser(userId).map(toTierlist);
    },

    createTierlist(userId, name, data, access, publicBooks) {
      const now = new Date().toISOString();
      const row: TierlistRow = {
        id: randomUUID(),
        owner_user_id: userId,
        origin_user_id: userId,
        name,
        data: JSON.stringify(data ?? {
          tiers: DEFAULT_TIER_PRESET.map((t) => ({ id: randomUUID(), label: t.label, color: t.color, workIds: [] })),
          pool: []
        }),
        vote_code: access ? generateVoteCode() : null,
        vote_access: access ?? "anonymous",
        voting_open: access ? 1 : 0,
        source_tierlist_id: null,
        promoted_at: null,
        public_books: access ? JSON.stringify(publicBooks ?? []) : null,
        created_at: now,
        updated_at: now
      };
      repo.insert(row);
      if (access) emitPublished?.(row.id, userId);
      return toTierlist(row);
    },

    getTierlist(userId, id) {
      const row = repo.getOwned(id, userId);
      return row ? toTierlist(row) : undefined;
    },

    updateTierlist(userId, id, patch) {
      if (patch.data !== undefined || patch.name !== undefined) {
        const existing = repo.getOwned(id, userId);
        if (!existing) return undefined;
        if (existing.vote_code !== null) return undefined;
      }
      const row = repo.update(id, userId, {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.data !== undefined ? { data: JSON.stringify(patch.data) } : {})
      });
      return row ? toTierlist(row) : undefined;
    },

    deleteTierlist(userId, id) {
      return repo.delete(id, userId);
    },

    openVoting(userId, id, access, publicBooks = []) {
      const row = repo.getOwned(id, userId);
      if (!row || row.vote_code !== null) return undefined;
      const original = toTierlist(row);

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
      return toTierlist(published);
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

      repo.saveBallot(ballot, placements);
      if (!existing && voter.kind === "user" && emitVotedOn) {
        emitVotedOn(voter.userId, row.id, row.name);
      }
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
        publicBooks: parsePublicBooks(row.public_books)
      };
    },

    listPublicTierlists(limit, offset) {
      const counts = repo.ballotCountsByTierlist();
      return repo.listPublic(limit, offset).map((row) => {
        const ref = toPublishedRef(row, counts.get(row.id) ?? 0);
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
        return { ...toPublishedRef(row, total?.ballots ?? 0), eligibleVoteCount: total?.eligible ?? 0 };
      });
    },

    listPublishedByWorks: (workIds, limit) => repo.listPublishedByWorks(workIds, limit),

    votedAmong(voterUserId, ids) {
      return repo.votedAmong(voterUserId, ids);
    },

    getPublishedRef(id) {
      const row = repo.getPublicById(id);
      return row ? { ...toPublishedRef(row, repo.ballotCount(id)), eligibleVoteCount: repo.eligibleVoteCount(row.id, row.origin_user_id) } : undefined;
    },

    listPublishedRefsByOwner(ownerUserId) {
      const counts = repo.ballotCountsByTierlist();
      return repo.listPublicByUser(ownerUserId).map((row) => ({ ...toPublishedRef(row, counts.get(row.id) ?? 0), eligibleVoteCount: repo.eligibleVoteCount(row.id, row.origin_user_id) }));
    },

    listVotedByUser(voterUserId) {
      const counts = repo.ballotCountsByTierlist();
      return repo.listVotedByUser(voterUserId).map((row) => ({ ...toPublishedRef(row, counts.get(row.id) ?? 0), eligibleVoteCount: repo.eligibleVoteCount(row.id, row.origin_user_id) }));
    },

    participationByOwner(ownerUserId, since) {
      return repo.listParticipation(ownerUserId, since).map((row) => ({
        id: row.id,
        name: row.name,
        covers: publishedCovers(row.public_books),
        participantCount: row.participants,
        latestAt: row.latest_at,
        recent: repo.listRecentVoters(row.id, ownerUserId, RECENT_PARTICIPANT_LIMIT).map((r) => ({ userId: r.user_id, at: r.at }))
      }));
    }
  };
}

/** The raw document shape the cross-module getter below hands out —
 *  tiers/pool are OPAQUE JSON values cast to their expected shape, never
 *  validated here (same "store and return the document without
 *  understanding its internals" stance as `data` itself). */
export interface TierlistData {
  name: string;
  tiers: Array<{ id: string; label: string; color: string; workIds: string[] }>;
  pool: string[];
}

/** tierlists' cross-module public surface — the ONLY way another module
 *  (murals, for its public GET /murals/shared/:token route) may read a
 *  tier list. app.ts gets a ready-built instance from plugin.ts's
 *  getTierlistsPublicApi(), exported through index.ts; never reach into
 *  this module's internals (service.ts, adapters/, domain/) for this —
 *  same module-boundary discipline every cross-module import in this
 *  codebase already follows. */
export interface TierlistsPublicApi {
  getTierlistData(ownerUserId: string, tierlistId: string): TierlistData | undefined;
  discoverWindow(needle: string, limit: number): TierlistDiscoverRef[];
  getPublishedMany(ids: string[]): PublishedTierlistRef[];
  votedAmong(voterUserId: string, ids: string[]): string[];
  publishedByWorks(workIds: string[], limit: number): GameByWork[];
  getPublished(id: string): PublishedTierlistRef | undefined;
  listPublishedByOwner(ownerUserId: string): PublishedTierlistRef[];
  participationByOwner(ownerUserId: string, since: string): GameParticipation[];
}

/** Factory over the service. app.ts can't call this directly — it has no
 *  way (and no business) constructing a TierlistsService itself — so
 *  plugin.ts wraps it in the lazily-composed getTierlistsPublicApi(). */
export function createTierlistsPublicApi(service: TierlistsService): TierlistsPublicApi {
  return {
    getTierlistData(ownerUserId, tierlistId) {
      const tierlist = service.getTierlist(ownerUserId, tierlistId);
      if (!tierlist) return undefined;
      return { name: tierlist.name, ...canonicalBoard(tierlist.data) };
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
    getPublished: (id) => service.getPublishedRef(id),
    listPublishedByOwner: (ownerUserId) => service.listPublishedRefsByOwner(ownerUserId),
    participationByOwner: (ownerUserId, since) => service.participationByOwner(ownerUserId, since)
  };
}
