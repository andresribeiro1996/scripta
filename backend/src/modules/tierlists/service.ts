// Business logic for the tierlists module. Depends only on the
// TierlistsRepository port, not on SQLite — same reasoning as every other
// module's service.ts.

import { randomBytes, randomUUID } from "node:crypto";
import type { TierlistsRepository } from "./domain/ports.js";
import type { BallotRow, Placement, Tierlist, TierlistRow, VoteAccess } from "./domain/types.js";

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
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export interface TierlistsService {
  listTierlists(userId: string): Tierlist[];
  createTierlist(userId: string, name: string): Tierlist;
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
  /** Duplicates the tier list into a public community copy whose structure
   *  is frozen, seeding the owner's current ranking as its first ballot.
   *  undefined if not owned. */
  openVoting(userId: string, id: string, access: VoteAccess): Tierlist | undefined;
  setVotingState(userId: string, id: string, patch: { access?: VoteAccess; open?: boolean }): Tierlist | undefined;
}

/** Where a new tier list starts — the familiar S–D ladder, matching the
 *  preset the old mural-embedded tier list used to seed (down to the
 *  colors). Not a fixed scale: the editor can rename/recolor/reorder/
 *  delete every one of these and add more — this is just the starting
 *  point, so "New tier list" opens on a recognizable board instead of
 *  an empty one. */
const DEFAULT_TIER_PRESET: Array<{ label: string; color: string }> = [
  { label: "S", color: "#c9482f" },
  { label: "A", color: "#d98a3d" },
  { label: "B", color: "#c9a53d" },
  { label: "C", color: "#5c9e5c" },
  { label: "D", color: "#4a7fc9" }
];

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
  tiers: Array<{ id: string; label: string; color: string; bookKeys: string[] }>;
  pool: string[];
}

function readDocument(tierlist: Tierlist): TierlistDocument {
  const data = (tierlist.data ?? {}) as Partial<TierlistDocument>;
  return { tiers: data.tiers ?? [], pool: data.pool ?? [] };
}

export function createTierlistsService(repo: TierlistsRepository): TierlistsService {
  return {
    listTierlists(userId) {
      return repo.listByUser(userId).map(toTierlist);
    },

    createTierlist(userId, name) {
      const now = new Date().toISOString();
      const row: TierlistRow = {
        id: randomUUID(),
        owner_user_id: userId,
        name,
        data: JSON.stringify({
          tiers: DEFAULT_TIER_PRESET.map((t) => ({ id: randomUUID(), label: t.label, color: t.color, bookKeys: [] })),
          pool: []
        }),
        vote_code: null,
        vote_access: "anonymous",
        voting_open: 0,
        source_tierlist_id: null,
        created_at: now,
        updated_at: now
      };
      repo.insert(row);
      return toTierlist(row);
    },

    getTierlist(userId, id) {
      const row = repo.getOwned(id, userId);
      return row ? toTierlist(row) : undefined;
    },

    updateTierlist(userId, id, patch) {
      // A community copy's tiers and pool are frozen for the life of the
      // vote — that's what makes ballots comparable, and it's why the
      // owner's ORIGINAL is left untouched and editable when voting opens.
      // Renaming stays allowed: the name is not part of the structure any
      // ballot was cast against.
      if (patch.data !== undefined) {
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

    openVoting(userId, id, access) {
      const row = repo.getOwned(id, userId);
      if (!row) return undefined;
      const original = toTierlist(row);

      const { tiers, pool } = readDocument(original);
      const placements: Placement[] = [];
      const poolKeys = new Set(pool);
      for (const tier of tiers) {
        for (const bookKey of tier.bookKeys) {
          placements.push({ bookKey, tierId: tier.id });
          poolKeys.add(bookKey);
        }
      }

      const now = new Date().toISOString();
      const copy: TierlistRow = {
        id: randomUUID(),
        owner_user_id: userId,
        name: `${original.name} (community)`,
        data: JSON.stringify({ tiers: tiers.map((t) => ({ ...t, bookKeys: [] })), pool: [...poolKeys] }),
        vote_code: generateVoteCode(),
        vote_access: access,
        voting_open: 1,
        source_tierlist_id: original.id,
        created_at: now,
        updated_at: now
      };
      const ballot: BallotRow = {
        id: randomUUID(),
        tierlist_id: copy.id,
        voter_user_id: userId,
        created_at: now,
        updated_at: now
      };

      repo.insertCommunityCopy(copy, ballot, placements);
      return toTierlist(copy);
    },

    setVotingState(userId, id, patch) {
      const row = repo.setVoting(id, userId, {
        ...(patch.access !== undefined ? { vote_access: patch.access } : {}),
        ...(patch.open !== undefined ? { voting_open: patch.open ? 1 : 0 } : {})
      });
      return row ? toTierlist(row) : undefined;
    }
  };
}

/** The raw document shape the cross-module getter below hands out —
 *  tiers/pool are OPAQUE JSON values cast to their expected shape, never
 *  validated here (same "store and return the document without
 *  understanding its internals" stance as `data` itself). */
export interface TierlistData {
  name: string;
  tiers: Array<{ id: string; label: string; color: string; bookKeys: string[] }>;
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
}

/** Factory over the service. app.ts can't call this directly — it has no
 *  way (and no business) constructing a TierlistsService itself — so
 *  plugin.ts wraps it in the lazily-composed getTierlistsPublicApi(). */
export function createTierlistsPublicApi(service: TierlistsService): TierlistsPublicApi {
  return {
    getTierlistData(ownerUserId, tierlistId) {
      const tierlist = service.getTierlist(ownerUserId, tierlistId);
      if (!tierlist) return undefined;
      const data = (tierlist.data ?? {}) as Partial<Pick<TierlistData, "tiers" | "pool">>;
      return { name: tierlist.name, tiers: data.tiers ?? [], pool: data.pool ?? [] };
    }
  };
}
