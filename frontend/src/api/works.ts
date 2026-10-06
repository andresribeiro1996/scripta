import type { WorkPage } from "@scripta/shared";
import { apiFetch } from "./client";

export async function fetchWork(id: string): Promise<WorkPage> {
  return (await apiFetch(`/works/${encodeURIComponent(id)}`)) as WorkPage;
}
