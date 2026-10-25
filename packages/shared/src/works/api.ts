import { apiPath } from "../api/path.js";
import type { ApiRequest } from "../api/port.js";
import type { BookStats } from "./bookStats.js";
import type { RecentAwards, WorkPage } from "./types.js";

const CHARACTERS_BATCH = 500;

export function createWorksApi(request: ApiRequest) {
  return {
    fetchWork(id: string): Promise<WorkPage> {
      return request<WorkPage>(apiPath`/works/${id}`, { auth: "optional" });
    },
    fetchWorkStats(id: string): Promise<BookStats> {
      return request<BookStats>(apiPath`/works/${id}/stats`, { auth: "optional" });
    },
    async fetchWorkCharacters(workIds: string[]): Promise<{ characters: Record<string, string[]> }> {
      const characters: Record<string, string[]> = {};
      for (let i = 0; i < workIds.length; i += CHARACTERS_BATCH) {
        const page = await request<{ characters: Record<string, string[]> }>("/works/characters", { method: "POST", body: { workIds: workIds.slice(i, i + CHARACTERS_BATCH) }, auth: "optional" });
        Object.assign(characters, page.characters);
      }
      return { characters };
    },
    fetchRecentAwards(): Promise<RecentAwards> {
      return request<RecentAwards>("/awards/recent", { auth: "none" });
    },
  };
}
