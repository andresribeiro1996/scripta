// Thin apiFetch wrappers over the tierlists module's REST routes
// (backend's modules/tierlists/routes.ts) — same "one function per
// backend route, no client-side logic" shape as api/murals.ts. Unlike
// murals (whose Mural/MuralBlock types live in lib/murals.ts next to
// their pure helpers), the Tierlist type lives here: the tierlists
// feature has no separate lib module, and `data` mirrors the backend
// DTO exactly (dates as ISO strings, document parsed by the service).

import { apiFetch } from "./client";

export interface TierDefinition {
  id: string;
  label: string;
  color: string;
  bookKeys: string[];
}

export interface TierlistData {
  tiers: TierDefinition[];
  pool: string[];
}

export interface Tierlist {
  id: string;
  name: string;
  data: TierlistData;
  createdAt: string;
  updatedAt: string;
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
