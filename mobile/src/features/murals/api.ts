import { createMuralsApi } from "@scripta/shared";
import { request } from "../../core/api";

export const {
  fetchMurals,
  fetchMural,
  createMural,
  updateMural,
  deleteMural,
  setMuralCover,
  clearMuralCover,
  shareMural,
  unshareMural,
  fetchFolders,
  createFolder,
  updateFolder,
  deleteFolder,
} = createMuralsApi(request);
