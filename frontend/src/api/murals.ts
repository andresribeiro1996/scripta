import { createMuralsApi } from "@scripta/shared";
import { request } from "./request";

export const {
  fetchMurals,
  fetchMural,
  createMural: createMuralApi,
  updateMural: updateMuralApi,
  deleteMural: deleteMuralApi,
  setMuralCover: setMuralCoverApi,
  clearMuralCover: clearMuralCoverApi,
  shareMural: shareMuralApi,
  unshareMural: unshareMuralApi,
  fetchFolders: fetchMuralFolders,
  createFolder: createMuralFolderApi,
  updateFolder: updateMuralFolderApi,
  deleteFolder: deleteMuralFolderApi,
} = createMuralsApi(request);
