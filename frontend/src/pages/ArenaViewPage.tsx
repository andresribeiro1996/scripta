// The public bracket + voting page — anyone with the link, no account
// needed. Owner-only controls (settle early, tie-break) are computed
// purely client-side by comparing the logged-in session's own user id
// (if any) against the tournament's plain ownerUserId field — no new
// auth primitive needed on the (deliberately unauthenticated) GET route.

import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { renameTournament, resolveTiebreak, settleDuelEarly } from "../api/arena";
import { useAuth } from "../auth/AuthContext";
import { BracketMap } from "../components/arena/BracketMap";
import { TournamentStatusBadge } from "../components/arena/TournamentStatusBadge";
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
  const [view, setView] = useState<"matches" | "bracket">("matches");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

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

  // The seed page can name a tournament, but it stops being reachable
  // the moment one starts — so without this an active or finished
  // tournament would be stuck with whatever it was called forever.
  // Same gesture as the seed page's: tap the name, type, blur or Enter.
  // No icon: an owner-only control that only appears on hover or focus
  // would be invisible on a phone, and one that is always visible costs
  // every viewer a button only the owner can use.
  async function handleRename() {
    const name = nameDraft.trim();
    setEditingName(false);
    if (!name || name === tournament!.name) return;
    setOwnerActionError(null);
    try {
      await renameTournament(tournament!.id, name);
      await refetch();
    } catch (err) {
      setOwnerActionError(err instanceof Error ? err.message : "Couldn't save that name.");
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

  // Live matches this viewer hasn't voted in — the only thing the
  // tournament actually asks of them.
  const pendingVotes =
    tournament.status === "active" ? tournament.duels.filter((d) => d.status === "active" && !d.hasVoted).length : 0;

  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      <Link to="/arena" className="mb-2 inline-block text-xs text-(--color-text-dim) hover:text-(--color-text)">
        ← All tournaments
      </Link>
      {/* The heading stays a heading for everyone; for the owner it is
          also the rename control. */}
      {isOwner && editingName ? (
        <input
          autoFocus
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={() => void handleRename()}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleRename();
            if (e.key === "Escape") setEditingName(false);
          }}
          aria-label="Tournament name"
          className="mb-1 w-full rounded-lg border border-(--color-border) bg-(--color-surface) px-2 py-1 text-lg font-bold"
        />
      ) : (
        <h2 className="mb-1 text-lg font-bold">
          {isOwner ? (
            <button
              onClick={() => {
                setNameDraft(tournament.name);
                setEditingName(true);
              }}
              title="Rename this tournament"
              className="block w-full truncate text-left font-bold transition-colors hover:text-(--color-accent)"
            >
              {tournament.name}
            </button>
          ) : (
            tournament.name
          )}
        </h2>
      )}
      <p className="mb-4 flex flex-wrap items-center gap-1.5 text-sm text-(--color-text-dim)">
        {tournament.bracketSize}-book bracket
        <TournamentStatusBadge status={tournament.status} round={tournament.currentRound} />
      </p>
      {voteError && <p className="mb-4 text-sm text-(--color-danger)">{voteError}</p>}
      {ownerActionError && <p className="mb-4 text-sm text-(--color-danger)">{ownerActionError}</p>}

      {/* Two views of the same duels rather than one compromised view.
          "Matches" is where you vote — full cards with covers, tallies
          and countdowns, which are far too tall to see a bracket's shape
          through. "Bracket" is the shape: compact two-row tiles wired up
          with elbow connectors, read-only. Neither can be the other
          without losing what it's for. Defaults to Matches, since voting
          is what most visits are for. */}
      <div className="mb-4 flex items-stretch overflow-hidden rounded-lg border border-(--color-border) bg-(--color-surface) sm:w-72">
        {(["matches", "bracket"] as const).map((mode, i) => (
          <button
            key={mode}
            onClick={() => setView(mode)}
            aria-pressed={view === mode}
            className={`flex min-h-11 flex-1 items-center justify-center gap-1.5 px-3 text-sm font-semibold capitalize ${
              i > 0 ? "border-l border-(--color-border)" : ""
            } ${view === mode ? "bg-(--color-accent-soft) text-(--color-accent)" : "text-(--color-text-dim) hover:bg-(--color-surface-hover)"}`}
          >
            {mode}
            {/* How many live matches this viewer still hasn't voted in.
                Without it the tournament never asks for anything — you
                have to open a view and hunt for a match still running.
                Shown on both tabs because the count is a property of the
                tournament, not of how you're looking at it. */}
            {pendingVotes > 0 && (
              <span className="rounded-full bg-(--color-accent) px-1.5 text-[10px] font-bold text-white tabular-nums">{pendingVotes}</span>
            )}
          </button>
        ))}
      </div>

      {view === "bracket" &&
        (tournament.status === "seeding" ? (
          // BracketMap draws the full skeleton from bracketSize, so it
          // WOULD render an all-empty bracket here. That reads as broken
          // rather than as "not started", so say so instead.
          <p className="rounded-xl border-2 border-dashed border-(--color-border) py-10 text-center text-sm text-(--color-text-dim)">
            This tournament hasn't started yet — its bracket appears once it's seeded and running.
          </p>
        ) : (
          <BracketMap
            tournament={tournament}
            onVote={(duelId, bookKey) => void handleVote(duelId, bookKey)}
            votingDuelId={busyDuelId}
          />
        ))}

      {view === "matches" && (
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
                  className="mt-2 w-full rounded-lg border border-(--color-border) py-2 text-xs text-(--color-text-dim) hover:bg-(--color-surface-hover)"
                >
                  Settle now
                </button>
              )}
              {isOwner && duel.status === "tied_pending_tiebreak" && (
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => void handleTiebreak(duel.id, duel.bookA.key)}
                    disabled={busyDuelId === duel.id}
                    className="flex-1 rounded-lg bg-(--color-accent) py-2 text-xs font-medium text-white"
                  >
                    {duel.bookA.title} wins
                  </button>
                  <button
                    onClick={() => void handleTiebreak(duel.id, duel.bookB.key)}
                    disabled={busyDuelId === duel.id}
                    className="flex-1 rounded-lg bg-(--color-accent) py-2 text-xs font-medium text-white"
                  >
                    {duel.bookB.title} wins
                  </button>
                </div>
              )}
            </div>
          );
        }}
      />
      )}
    </div>
  );
}
