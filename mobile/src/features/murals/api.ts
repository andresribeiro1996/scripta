import type { Mural, MuralBlock, MuralFolder } from "@scripta/shared";
import { apiClient } from "../../core/api";

export async function fetchMurals(): Promise<Mural[]> {
  return (await apiClient.request<{ murals: Mural[] }>("/murals", { auth: true })).murals;
}

export function fetchMural(id: string): Promise<Mural> {
  return apiClient.request(`/murals/${id}`, { auth: true });
}

export function createMural(name: string, folderId: string | null = null): Promise<Mural> {
  return apiClient.request("/murals", { method: "POST", body: { name, folderId }, auth: true });
}

export function updateMural(id: string, patch: { name?: string; blocks?: MuralBlock[]; folderId?: string | null; updatedAt?: string }): Promise<Mural> {
  return apiClient.request(`/murals/${id}`, { method: "PUT", body: patch, auth: true });
}

export function deleteMural(id: string): Promise<void> {
  return apiClient.request(`/murals/${id}`, { method: "DELETE", auth: true });
}

export function setMuralCover(id: string, imageId: string, url: string): Promise<Mural> {
  return apiClient.request(`/murals/${id}/cover`, { method: "PUT", body: { imageId, url }, auth: true });
}

export function clearMuralCover(id: string): Promise<Mural> {
  return apiClient.request(`/murals/${id}/cover`, { method: "DELETE", auth: true });
}

export function shareMural(id: string): Promise<Mural> {
  return apiClient.request(`/murals/${id}/share`, { method: "POST", auth: true });
}

export function unshareMural(id: string): Promise<Mural> {
  return apiClient.request(`/murals/${id}/unshare`, { method: "POST", auth: true });
}

export async function fetchFolders(): Promise<MuralFolder[]> {
  return (await apiClient.request<{ folders: MuralFolder[] }>("/murals/folders", { auth: true })).folders;
}

export function createFolder(name: string, parentId: string | null = null): Promise<MuralFolder> {
  return apiClient.request("/murals/folders", { method: "POST", body: { name, parentId }, auth: true });
}

export function updateFolder(id: string, patch: { name?: string; parentId?: string | null }): Promise<MuralFolder> {
  return apiClient.request(`/murals/folders/${id}`, { method: "PUT", body: patch, auth: true });
}

export function deleteFolder(id: string): Promise<void> {
  return apiClient.request(`/murals/folders/${id}`, { method: "DELETE", auth: true });
}

export async function fetchHome(): Promise<Mural | null> {
  return (await apiClient.request<{ mural: Mural | null }>("/murals/home", { auth: true })).mural;
}
export async function selectHome(muralId: string): Promise<Mural> {
  return apiClient.request("/murals/home", { method: "PUT", body: { muralId }, auth: true });
}
export async function initializeHome(withPassage: boolean): Promise<Mural> {
  return apiClient.request("/murals/home", { method: "POST", body: { withPassage }, auth: true });
}
