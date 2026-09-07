import { newId } from "../murals/murals.js";

export interface TierDefinition {
  id: string;
  label: string;
  color: string;
  bookKeys: string[];
}

export function createTier(label: string, color: string): TierDefinition {
  return { id: newId(), label, color, bookKeys: [] };
}
