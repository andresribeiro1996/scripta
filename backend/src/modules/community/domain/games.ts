import type { GameParticipation, ParticipationGameKind, PublishedContent } from "@scripta/shared/community";

export type GameKind = ParticipationGameKind;

export const GAME_KINDS: readonly GameKind[] = ["tierlist", "tournament", "quiz"];

export type GameContent<K extends GameKind = GameKind> = Extract<PublishedContent, { kind: K }>;

export interface GameListing {
  id: string;
  ownerUserId: string;
  createdAt: string;
  promoted: boolean;
}

export interface GameCard<K extends GameKind = GameKind> extends GameListing {
  content: GameContent<K>;
}

export interface TierPlacementFact {
  workId: string;
  tierIndex: number;
  tierCount: number;
  ranksWorstFirst: boolean;
  castAt: string;
}

export interface GameShelfFact {
  kind: GameKind;
  id: string;
  ownerUserId: string;
  open: boolean;
  promoted: boolean;
  createdAt: string;
  voters: number;
  votesSince: number;
  workIds: string[];
  placements: TierPlacementFact[];
  champion: { workId: string; settledAt: string } | null;
}

export interface GameSource<K extends GameKind = GameKind> {
  get(id: string): GameCard<K> | undefined;
  getMany(ids: string[], viewerId?: string): GameCard<K>[];
  listByOwner(ownerUserId: string): GameCard<K>[];
  discoverWindow(needle: string, limit: number): GameListing[];
  discoverByWorks(workIds: string[], limit: number): GameListing[];
  participation(ownerUserId: string, since: string): Array<GameParticipation & { voteCode?: string }>;
  shelfFacts(since: string | null, until: string | null): GameShelfFact[];
}

export type GameSources = { [K in GameKind]: GameSource<K> };

export function asGameKind(refType: string): GameKind | null {
  return GAME_KINDS.find((kind) => kind === refType) ?? null;
}
