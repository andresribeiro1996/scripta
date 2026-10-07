import { createTierlistsApi } from "@scripta/shared";
import { request } from "./request";

export type { ResolvedTierlist, TierDefinition, Tierlist, TierlistData } from "@scripta/shared";

export const {
  fetchTierlists,
  fetchTierlist,
  createTierlist: createTierlistApi,
  updateTierlist: updateTierlistApi,
  deleteTierlist: deleteTierlistApi,
} = createTierlistsApi(request);
