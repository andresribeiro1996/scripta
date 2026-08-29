// Thin apiFetch wrappers over the murals module's REST routes (backend's
// modules/murals/routes.ts) — same "one function per backend route, no
// client-side logic" shape as api/socials.ts. The `Mural`/`MuralBlock`
// types themselves live in lib/murals.ts (reused directly, not
// re-declared here) since that's also where every pure function that
// operates on them lives.

import type { Mural, MuralBlock } from "../lib/murals";
import { apiFetch } from "./client";

export async function fetchMurals(): Promise<Mural[]> {
  const body = (await apiFetch("/murals")) as { murals: Mural[] };
  return body.murals;
}

export async function fetchMural(id: string): Promise<Mural> {
  return (await apiFetch(`/murals/${id}`)) as Mural;
}

export async function createMuralApi(name: string): Promise<Mural> {
  return (await apiFetch("/murals", { method: "POST", body: JSON.stringify({ name }) })) as Mural;
}

export async function updateMuralApi(id: string, patch: { name?: string; blocks?: MuralBlock[] }): Promise<Mural> {
  return (await apiFetch(`/murals/${id}`, { method: "PUT", body: JSON.stringify(patch) })) as Mural;
}

export async function deleteMuralApi(id: string): Promise<void> {
  await apiFetch(`/murals/${id}`, { method: "DELETE" });
}

export async function setMuralCoverApi(id: string, imageId: string, url: string): Promise<Mural> {
  return (await apiFetch(`/murals/${id}/cover`, { method: "PUT", body: JSON.stringify({ imageId, url }) })) as Mural;
}

export async function clearMuralCoverApi(id: string): Promise<Mural> {
  return (await apiFetch(`/murals/${id}/cover`, { method: "DELETE" })) as Mural;
}

export async function shareMuralApi(id: string): Promise<Mural> {
  return (await apiFetch(`/murals/${id}/share`, { method: "POST" })) as Mural;
}

export async function unshareMuralApi(id: string): Promise<Mural> {
  return (await apiFetch(`/murals/${id}/unshare`, { method: "POST" })) as Mural;
}
