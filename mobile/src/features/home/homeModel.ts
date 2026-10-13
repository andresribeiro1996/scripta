import type { DashboardCard } from "@scripta/shared";

export interface HomeSections {
  readingKeys: string[];
  nextKeys: string[] | null;
  highlight: Extract<DashboardCard, { kind: "rediscover" }> | null;
}

export function homeSections(cards: DashboardCard[]): HomeSections {
  const readingKeys = cards.find((card) => card.kind === "currentlyReading")?.bookKeys ?? [];
  const upNext = cards.find((card) => card.kind === "upNext")?.bookKeys ?? [];
  return {
    readingKeys,
    nextKeys: readingKeys.length === 0 && upNext.length >= 2 ? upNext : null,
    highlight: cards.find((card) => card.kind === "rediscover") ?? null,
  };
}

export function shouldMarkFeedSeen({ focused, rowVisible, loaded, failed, fetching, sent }: { focused: boolean; rowVisible: boolean; loaded: boolean; failed: boolean; fetching: boolean; sent: boolean }): boolean {
  return focused && rowVisible && loaded && !failed && !fetching && !sent;
}
