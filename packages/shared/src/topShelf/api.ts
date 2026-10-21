import type { ApiRequest } from "../api/port.js";
import { isKnownContent } from "../community/helpers.js";
import type { TopShelf, TopShelfPeriod, TopShelfView } from "./types.js";

export function createTopShelfApi(request: ApiRequest) {
  return {
    async fetchTopShelf(query: { period: TopShelfPeriod; genre: string | null; view?: TopShelfView }): Promise<TopShelf> {
      const params = new URLSearchParams({ period: query.period });
      if (query.genre) params.set("genre", query.genre);
      if (query.view) params.set("view", query.view);
      const result = await request<TopShelf>(`/top-shelf?${params}`, { auth: "none" });
      return { ...result, games: result.games.filter((game) => isKnownContent(game.item.content)) };
    }
  };
}
