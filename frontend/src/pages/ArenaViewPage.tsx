// The public bracket + voting page — anyone with the link, no account
// needed. Owner-only controls (settle early, tie-break) are computed
// purely client-side by comparing the logged-in session's own user id
// (if any) against the tournament's plain ownerUserId field — no new
// auth primitive needed on the (deliberately unauthenticated) GET route.

import { useState } from "react";
import { useParams } from "react-router-dom";
import { resolveTiebreak, settleDuelEarly } from "../api/arena";
import { useAuth } from "../auth/AuthContext";
import { BracketTree } from "../components/arena/BracketTree";
import { DuelCard } from "../components/arena/DuelCard";
import { useArena } from "../hooks/useArena";

export function ArenaViewPage() {
  const { id } = useParams<{ id: string }>();
  const { session } = useAuth();
  const { tournament, isLoading, vote, refetch } = useArena(id!);
  const [voteError, setVoteError] = useState<string | null>(null);
  const [ownerActionError, setOwnerActionError] = useState<string | null>(null);
  const [busyDuelId, setBusyDuelId] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl px-5 py-8">
        <p className="text-sm text-(--color-text-dim)">Loading…</p>
      </div>
    );
  }
  if (!tournament) {
    return (
      <div className="mx-auto max-w-5xl px-5 py-8">
        <p className="text-sm text-(--color-text-dim)">No such tournament.</p>
      </div>
    );
  }

  const isOwner = session?.user.id === tournament.ownerUserId;

  async function handleVote(duelId: string, bookKey: string) {
    setVoteError(null);
    try {
      await vote(duelId, bookKey);
    } catch (err) {
      setVoteError(err instanceof Error ? err.message : "Couldn't record that vote.");
    }
  }

  async function handleSettle(duelId: string) {
    setBusyDuelId(duelId);
    setOwnerActionError(null);
    try {
      await settleDuelEarly(tournament!.id, duelId);
      await refetch();
    } catch (err) {
      setOwnerActionError(err instanceof Error ? err.message : "Couldn't settle that duel.");
    } finally {
      setBusyDuelId(null);
    }
  }

  async function handleTiebreak(duelId: string, winnerBookKey: string) {
    setBusyDuelId(duelId);
    setOwnerActionError(null);
    try {
      await resolveTiebreak(tournament!.id, duelId, winnerBookKey);
      await refetch();
    } catch (err) {
      setOwnerActionError(err instanceof Error ? err.message : "Couldn't resolve that tie.");
    } finally {
      setBusyDuelId(null);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      <h2 className="mb-1 text-lg font-bold">{tournament.name}</h2>
      <p className="mb-4 text-sm text-(--color-text-dim)">
        {tournament.bracketSize}-book bracket · {tournament.status === "completed" ? "Completed" : `Round ${tournament.currentRound}`}
      </p>
      {voteError && <p className="mb-4 text-sm text-(--color-danger)">{voteError}</p>}
      {ownerActionError && <p className="mb-4 text-sm text-(--color-danger)">{ownerActionError}</p>}

      <BracketTree
        tournament={tournament}
        renderDuel={(duelId) => {
          const duel = tournament.duels.find((d) => d.id === duelId)!;
          const votingDisabledReason = duel.hasVoted ? "You already voted" : tournament.status !== "active" ? "Tournament not active" : null;
          return (
            <div>
              <DuelCard duel={duel} onVote={(bookKey) => void handleVote(duel.id, bookKey)} votingDisabledReason={votingDisabledReason} />
              {isOwner && duel.status === "active" && (
                <button
                  onClick={() => void handleSettle(duel.id)}
                  disabled={busyDuelId === duel.id}
                  className="mt-2 w-full rounded-lg border border-(--color-border) py-1 text-xs text-(--color-text-dim) hover:bg-(--color-surface-hover)"
                >
                  Settle now
                </button>
              )}
              {isOwner && duel.status === "tied_pending_tiebreak" && (
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => void handleTiebreak(duel.id, duel.bookA.key)}
                    disabled={busyDuelId === duel.id}
                    className="flex-1 rounded-lg bg-(--color-accent) py-1 text-xs font-medium text-white"
                  >
                    {duel.bookA.title} wins
                  </button>
                  <button
                    onClick={() => void handleTiebreak(duel.id, duel.bookB.key)}
                    disabled={busyDuelId === duel.id}
                    className="flex-1 rounded-lg bg-(--color-accent) py-1 text-xs font-medium text-white"
                  >
                    {duel.bookB.title} wins
                  </button>
                </div>
              )}
            </div>
          );
        }}
      />
    </div>
  );
}
