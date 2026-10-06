import type { WorkPage } from "@scripta/shared";
import { apiClient } from "../../core/api";

export function fetchWork(id: string, signedIn: boolean) {
  return apiClient.request<WorkPage>(`/works/${encodeURIComponent(id)}`, { auth: signedIn });
}
