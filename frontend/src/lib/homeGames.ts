import type { DiscoverItem } from "@scripta/shared/community";
import type { DigestItem, TopShelfGame } from "@scripta/shared";

const LIMIT = 2;

export function homeGames(input: { circle: DigestItem[]; popular: TopShelfGame[]; newest: DiscoverItem[]; viewerId: string }): { followed: DiscoverItem[]; others: DiscoverItem[]; othersLabel: "Popular this month" | "New games" } {
  const followed = input.circle.flatMap((item): DiscoverItem[] => (item.kind === "publication" ? [{ author: item.actor, content: item.content }] : [])).slice(0, LIMIT);
  const followedIds = new Set(followed.map((game) => game.content.id));
  const popular = input.popular
    .map((game) => game.item)
    .filter((game) => game.author.userId !== input.viewerId && !followedIds.has(game.content.id))
    .slice(0, LIMIT);
  if (followed.length === 0 && popular.length === 0) {
    return { followed, others: input.newest.filter((game) => game.author.userId !== input.viewerId).slice(0, LIMIT), othersLabel: "New games" };
  }
  return { followed, others: popular, othersLabel: "Popular this month" };
}
