import { apiPath } from "../api/path.js";
import type { ApiRequest } from "../api/port.js";
import type { WorkPage } from "./types.js";

export function createWorksApi(request: ApiRequest) {
  return {
    fetchWork(id: string): Promise<WorkPage> {
      return request<WorkPage>(apiPath`/works/${id}`, { auth: "optional" });
    },
  };
}
