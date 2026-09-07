export interface SeedBook {
  key: string;
  title: string;
  author: string;
  cover: string | null;
}

export interface DuelSide extends SeedBook {
  votes: number;
}

export interface Duel {
  id: string;
  roundNumber: number;
  duelIndex: number;
  bookA: DuelSide;
  bookB: DuelSide;
  winnerKey: string | null;
  status: "active" | "tied_pending_tiebreak" | "settled";
  opensAt: string;
  closesAt: string;
  hasVoted: boolean;
}
