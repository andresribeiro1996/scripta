import type { GameCard, GameSource } from "../../community/index.js";
import type { PublishedTierlistRef, TierlistsPublicApi } from "../service.js";

function toCard(ref: PublishedTierlistRef): GameCard<"tierlist"> {
  return {
    id: ref.id,
    ownerUserId: ref.ownerUserId,
    createdAt: ref.createdAt,
    promoted: ref.promotedAt !== null,
    content: { kind: "tierlist", id: ref.id, voteCode: ref.voteCode, name: ref.name, poolSize: ref.poolSize, ballotCount: ref.ballotCount, votingOpen: ref.votingOpen, promotedAt: ref.promotedAt, covers: ref.covers }
  };
}

export function createTierlistGameSource(api: TierlistsPublicApi): GameSource<"tierlist"> {
  const listing = (row: { id: string; createdAt: string; ownerUserId: string; promotedAt: string | null }) => ({ id: row.id, ownerUserId: row.ownerUserId, createdAt: row.createdAt, promoted: row.promotedAt !== null });
  return {
    get(id) {
      const ref = api.getPublished(id);
      return ref ? toCard(ref) : undefined;
    },
    getMany(ids, viewerId) {
      const voted = viewerId ? new Set(api.votedAmong(viewerId, ids)) : null;
      return api.getPublishedMany(ids).map((ref) => {
        const card = toCard(ref);
        return voted ? { ...card, content: { ...card.content, viewerVoted: voted.has(ref.id) } } : card;
      });
    },
    listByOwner: (ownerUserId) => api.listPublishedByOwner(ownerUserId).map(toCard),
    discoverWindow: (needle, limit) => api.discoverWindow(needle, limit).map(listing),
    discoverByWorks: (workIds, limit) => api.discoverByWorks(workIds, limit).map(listing),
    participation(ownerUserId, since) {
      const rows = api.participationByOwner(ownerUserId, since);
      const voteCodes = new Map(api.getPublishedMany(rows.map((row) => row.id)).map((ref) => [ref.id, ref.voteCode]));
      return rows.map((row) => {
        const voteCode = voteCodes.get(row.id);
        return voteCode ? { ...row, voteCode } : row;
      });
    },
    shelfFacts: (since, until) => api.topShelfFacts(since, until).map((fact) => ({ ...fact, kind: "tierlist", champion: null }))
  };
}
