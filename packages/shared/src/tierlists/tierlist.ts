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

export const DEFAULT_TIER_PRESET = [
  { label: "S", color: "#c9482f" },
  { label: "A", color: "#d98a3d" },
  { label: "B", color: "#c9a53d" },
  { label: "C", color: "#5c9e5c" },
  { label: "D", color: "#4a7fc9" },
] as const;
