import type { TierDefinition } from "./tierlist.js";

export interface TierlistData {
  tiers: TierDefinition[];
  pool: string[];
}

export interface ResolvedTierlist {
  name: string;
  tiers: TierDefinition[];
  pool: string[];
}
