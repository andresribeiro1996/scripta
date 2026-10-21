import type { ApiRequest } from "../api/port.js";
import { isKnownContent } from "../community/helpers.js";
import type { TopShelf, TopShelfPeriod, TopShelfRecap, TopShelfRecapCard, TopShelfRecapIndex, TopShelfView } from "./types.js";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

export function recapMonthName(month: string): string {
  return MONTH_NAMES[Number(month.slice(5, 7)) - 1]!;
}

export function createTopShelfApi(request: ApiRequest) {
  return {
    async fetchTopShelf(query: { period: TopShelfPeriod; genre: string | null; view?: TopShelfView }): Promise<TopShelf> {
      const params = new URLSearchParams({ period: query.period });
      if (query.genre) params.set("genre", query.genre);
      if (query.view) params.set("view", query.view);
      const result = await request<TopShelf>(`/top-shelf?${params}`, { auth: "none" });
      return { ...result, games: result.games.filter((game) => isKnownContent(game.item.content)) };
    },
    fetchRecapIndex(): Promise<TopShelfRecapIndex> {
      return request<TopShelfRecapIndex>("/top-shelf/recaps", { auth: "none" });
    },
    async fetchRecap(month: string): Promise<TopShelfRecap> {
      const result = await request<TopShelfRecap>(`/top-shelf/recaps/${encodeURIComponent(month)}`, { auth: "none" });
      return {
        ...result,
        cards: result.cards.flatMap((card): TopShelfRecapCard[] => {
          if (card.kind === "book") {
            return [card.game && !isKnownContent(card.game.content) ? { ...card, game: null } : card];
          }
          if (card.kind === "hottestGame") return isKnownContent(card.game.item.content) ? [card] : [];
          return [card];
        })
      };
    }
  };
}
