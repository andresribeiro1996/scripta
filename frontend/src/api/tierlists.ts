// Thin apiFetch wrappers over the tierlists module's REST routes
// (backend's modules/tierlists/routes.ts) — same "one function per
// backend route, no client-side logic" shape as api/murals.ts. The
// `Tierlist` type lives here (the tierlists feature has no lib module of
// its own); `TierDefinition` is re-exported from lib/murals.ts, where
// createTier lives, same api-reuses-lib-types split api/murals.ts already
// follows for Mural/MuralBlock.

import type { TierDefinition } from "../lib/murals";
import { apiFetch } from "./client";

export type { TierDefinition };

export interface TierlistData {
  tiers: TierDefinition[];
  pool: string[];
}

/** A tier list resolved for RENDERING — its name and its document in one
 *  flat shape. What the mural `tierlist` block displays (threaded
 *  MuralCanvas → BlockRenderer → TierListBlockView) and what GET
 *  /murals/shared/:token resolves each referenced tierlistId into
 *  server-side (api/sharedMurals.ts's response `tierlists` map) — mirrors
 *  the backend's own cross-module TierlistData
 *  (modules/tierlists/service.ts) exactly. */
export interface ResolvedTierlist {
  name: string;
  tiers: TierDefinition[];
  pool: string[];
}

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
