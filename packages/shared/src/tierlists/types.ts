import type { CharacterSubject } from "../characters/index.js";
import type { Placement } from "./ballot.js";
import type { HistogramCell } from "./results.js";
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

export interface Tierlist {
  id: string;
  name: string;
  data: TierlistData;
  createdAt: string;
  updatedAt: string;
  voteCode: string | null;
  voteAccess: "anonymous" | "members";
  votingOpen: boolean;
  sourceTierlistId: string | null;
  promotedAt: string | null;
  originCreatorId: string;
  ranksWorstFirst: boolean;
  subject: CharacterSubject | null;
}

export interface VotingBoard {
  name: string;
  tiers: Array<{ id: string; label: string; color: string }>;
  pool: string[];
  access: "anonymous" | "members";
  votingOpen: boolean;
  ballotCount: number;
  eligibleVoteCount: number;
  promotedAt: string | null;
  ranksWorstFirst: boolean;
  subject: CharacterSubject | null;
  histogram?: HistogramCell[];
}

export interface BallotResponse {
  ballotId: string;
  placements: Placement[];
  results: { histogram: HistogramCell[]; ballotCount: number };
}

export interface VotedTierlist {
  id: string;
  ownerUserId: string;
  createdAt: string;
  voteCode: string;
  name: string;
  poolSize: number;
  ballotCount: number;
  eligibleVoteCount: number;
  promotedAt: string | null;
  votingOpen: boolean;
  covers: string[];
  subject?: { kind: "characters"; label: string };
}
