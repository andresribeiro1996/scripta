import type { GameCard, GameSource } from "../../community/index.js";
import type { ArenaPublicApi, PublishedTournamentRef } from "../service.js";

function toCard(ref: PublishedTournamentRef): GameCard<"tournament"> {
  return {
    id: ref.id,
    ownerUserId: ref.ownerUserId,
    createdAt: ref.createdAt,
    promoted: false,
    content: { kind: "tournament", id: ref.id, name: ref.name, bracketSize: ref.bracketSize, status: ref.status, bookCount: ref.bracketSize, covers: ref.covers }
  };
}

export function createTournamentGameSource(api: ArenaPublicApi): GameSource<"tournament"> {
  const listing = (row: { id: string; createdAt: string; ownerUserId: string }) => ({ ...row, promoted: false });
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
    participation: (ownerUserId, since) => api.participationByOwner(ownerUserId, since),
    shelfFacts: (since, until) => api.topShelfFacts(since, until).map((fact) => ({ ...fact, kind: "tournament", promoted: false, placements: [] }))
  };
}

export function createCompletedTournaments(api: ArenaPublicApi) {
  return (viewerId: string, since: string) =>
    api.completedForParticipant(viewerId, since).map((ref) => ({
      card: toCard(ref),
      completedAt: ref.completedAt,
      winner: { title: ref.winner.title, author: ref.winner.author, cover: ref.winner.cover, workId: ref.winner.workId }
    }));
}
