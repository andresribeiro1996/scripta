// Reads and votes on a single tournament — used by ArenaViewPage.tsx
// (voting) and ArenaSeedPage.tsx (seeding, which just needs the read side).
//
// Polls while the tournament is still running — this app has no
// realtime/websocket layer (see the arena module's own design notes), so
// a short interval is the simplest way for vote counts, round advances,
// and completion to show up without a manual refresh. Stops polling once
// the tournament is completed, since nothing more will ever change.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchTournament, voteOnDuel } from "../api/arena";
import { getVoterToken } from "../lib/arenaVoter";

const POLL_INTERVAL_MS = 5000;

export function useArena(id: string) {
  const queryClient = useQueryClient();
  const voterToken = getVoterToken();
  const queryKey = ["arena", id, voterToken];

  const query = useQuery({
    queryKey,
    queryFn: () => fetchTournament(id, voterToken),
    refetchInterval: (q) => (q.state.data?.status === "completed" ? false : POLL_INTERVAL_MS)
  });

  async function vote(duelId: string, bookKey: string) {
    await voteOnDuel(id, duelId, voterToken, bookKey);
    await queryClient.invalidateQueries({ queryKey });
  }

  return { tournament: query.data, isLoading: query.isLoading, error: query.error, voterToken, vote, refetch: query.refetch };
}
