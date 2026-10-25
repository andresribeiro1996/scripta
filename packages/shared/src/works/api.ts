import { apiPath } from "../api/path.js";
import type { ApiRequest } from "../api/port.js";
import type { BookStats } from "./bookStats.js";
import type { RecentAwards, WorkPage } from "./types.js";

export function createWorksApi(request: ApiRequest) {
  return {
    fetchWork(id: string): Promise<WorkPage> {
      return request<WorkPage>(apiPath`/works/${id}`, { auth: "optional" });
    },
    fetchWorkStats(id: string): Promise<BookStats> {
      return request<BookStats>(apiPath`/works/${id}/stats`, { auth: "optional" });
    },
    fetchRecentAwards(): Promise<RecentAwards> {
      return request<RecentAwards>("/awards/recent", { auth: "none" });
    },
  };
}
