// Thin apiFetch wrappers over the tierlists module's REST routes
// (backend's modules/tierlists/routes.ts) — same "one function per
// backend route, no client-side logic" shape as api/murals.ts. The
// `Tierlist` type lives here (the tierlists feature has no lib module of
// its own); `TierDefinition` is re-exported from lib/murals.ts, where
// createTier lives, same api-reuses-lib-types split api/murals.ts already
// follows for Mural/MuralBlock.

import { apiFetch } from "./client";
import type { ResolvedTierlist, TierDefinition, TierlistData } from "@scripta/shared";

export type { TierDefinition };
export type { ResolvedTierlist, TierlistData };

export interface Tierlist {
  id: string;
  name: string;
  data: TierlistData;
  createdAt: string;
  updatedAt: string;
  voteCode: string | null;
  voteAccess: "anonymous" | "members";
  votingOpen: boolean;
  sourceTierlistId: string | null;
}

export async function fetchTierlists(): Promise<Tierlist[]> {
  const body = (await apiFetch("/tierlists")) as { tierlists: Tierlist[] };
  return body.tierlists;
}

export async function fetchTierlist(id: string): Promise<Tierlist> {
  return (await apiFetch(`/tierlists/${id}`)) as Tierlist;
}

export async function createTierlistApi(name: string): Promise<Tierlist> {
  return (await apiFetch("/tierlists", { method: "POST", body: JSON.stringify({ name }) })) as Tierlist;
}

export async function updateTierlistApi(id: string, patch: { name?: string; data?: TierlistData }): Promise<Tierlist> {
  return (await apiFetch(`/tierlists/${id}`, { method: "PUT", body: JSON.stringify(patch) })) as Tierlist;
}

export async function deleteTierlistApi(id: string): Promise<void> {
  await apiFetch(`/tierlists/${id}`, { method: "DELETE" });
}
