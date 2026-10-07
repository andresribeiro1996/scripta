import { apiPath } from "../api/path.js";
import type { ApiRequest } from "../api/port.js";
import type { ThemeId } from "../themes/index.js";
import type { Mural, MuralBlock, MuralFolder } from "./murals.js";

export function createMuralsApi(request: ApiRequest) {
  return {
    async fetchMurals(): Promise<Mural[]> {
      return (await request<{ murals: Mural[] }>("/murals", { auth: "required" })).murals;
    },
    fetchMural(id: string): Promise<Mural> {
      return request<Mural>(apiPath`/murals/${id}`, { auth: "required" });
    },
    createMural(name: string, theme: ThemeId, folderId: string | null = null): Promise<Mural> {
      return request<Mural>("/murals", { method: "POST", body: { name, theme, folderId }, auth: "required" });
    },
    updateMural(id: string, patch: { name?: string; theme?: ThemeId; blocks?: MuralBlock[]; folderId?: string | null; updatedAt?: string }): Promise<Mural> {
      return request<Mural>(apiPath`/murals/${id}`, { method: "PUT", body: patch, auth: "required" });
    },
    async deleteMural(id: string): Promise<void> {
      await request(apiPath`/murals/${id}`, { method: "DELETE", auth: "required" });
    },
    setMuralCover(id: string, imageId: string, url: string): Promise<Mural> {
      return request<Mural>(apiPath`/murals/${id}/cover`, { method: "PUT", body: { imageId, url }, auth: "required" });
    },
    clearMuralCover(id: string): Promise<Mural> {
      return request<Mural>(apiPath`/murals/${id}/cover`, { method: "DELETE", auth: "required" });
    },
    shareMural(id: string): Promise<Mural> {
      return request<Mural>(apiPath`/murals/${id}/share`, { method: "POST", auth: "required" });
    },
    unshareMural(id: string): Promise<Mural> {
      return request<Mural>(apiPath`/murals/${id}/unshare`, { method: "POST", auth: "required" });
    },
    async fetchFolders(): Promise<MuralFolder[]> {
      return (await request<{ folders: MuralFolder[] }>("/murals/folders", { auth: "required" })).folders;
    },
    createFolder(name: string, parentId: string | null = null): Promise<MuralFolder> {
      return request<MuralFolder>("/murals/folders", { method: "POST", body: { name, parentId }, auth: "required" });
    },
    updateFolder(id: string, patch: { name?: string; parentId?: string | null }): Promise<MuralFolder> {
      return request<MuralFolder>(apiPath`/murals/folders/${id}`, { method: "PUT", body: patch, auth: "required" });
    },
    async deleteFolder(id: string): Promise<void> {
      await request(apiPath`/murals/folders/${id}`, { method: "DELETE", auth: "required" });
    },
  };
}

export type MuralsApi = ReturnType<typeof createMuralsApi>;
