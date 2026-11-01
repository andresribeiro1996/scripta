// The public bracket + voting page — anyone with the link, no account
// needed. Owner-only controls (settle early, tie-break) are computed
// purely client-side by comparing the logged-in session's own user id
// (if any) against the tournament's plain ownerUserId field — no new
// auth primitive needed on the (deliberately unauthenticated) GET route.

import { sharedT } from "@scripta/shared/i18n";
import { useState } from "react";
import { useParams } from "react-router-dom";
import { renameTournament, resolveTiebreak, settleDuelEarly, type DuelSide } from "../api/arena";
import { useAuth } from "../auth/AuthContext";
import { AddBookSheet } from "../components/AddBookSheet";
import { CharacterHeader } from "../components/CharacterHeader";
import { BracketMap } from "../components/arena/BracketMap";
import { TournamentStatusBadge } from "../components/arena/TournamentStatusBadge";
import { BracketTree } from "../components/arena/BracketTree";
import { DuelCard } from "../components/arena/DuelCard";
import { useArena } from "../hooks/useArena";
import { EmptyState } from "../components/EmptyState";
import { Page } from "../components/page/Page";
import { BUTTON_SECONDARY, TITLE_FIELD_CLASS } from "../components/page/buttonClasses";
import { backTo } from "../lib/areas";
import { useLocale, useT } from "../i18n";

export function ArenaViewPage() {
  const locale = useLocale();
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const { session } = useAuth();
  const { tournament, isLoading, vote, refetch } = useArena(id!);
  const [voteError, setVoteError] = useState<string | null>(null);
  const [ownerActionError, setOwnerActionError] = useState<string | null>(null);
  const [busyDuelId, setBusyDuelId] = useState<string | null>(null);
  const [view, setView] = useState<"matches" | "bracket">("matches");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [picked, setPicked] = useState<DuelSide | null>(null);

  const back = session ? backTo("tournament") : { to: "/arena", label: t("shell.areaGames") };

  if (isLoading) {
    return (
      <Page title={t("arena.tournament")} back={back}>
        <p className="text-sm text-(--color-text-dim)">{t("library.loadingEllipsis")}</p>
      </Page>
    );
  }
  if (!tournament) {
    return (
      <Page title={t("arena.tournament")} back={back}>
        <p className="text-sm text-(--color-text-dim)">{t("arena.noSuchTournament")}</p>
      </Page>
    );
  }

  const isOwner = session?.user.id === tournament.ownerUserId;

  async function handleVote(duelId: string, workId: string) {
    setVoteError(null);
    try {
      await vote(duelId, workId);
    } catch (err) {
      setVoteError(err instanceof Error ? err.message : t("arena.couldntRecordVote"));
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
      setOwnerActionError(err instanceof Error ? err.message : t("arena.couldntSaveName"));
    }
  }

  async function handleSettle(duelId: string) {
    setBusyDuelId(duelId);
    setOwnerActionError(null);
    try {
      await settleDuelEarly(tournament!.id, duelId);
      await refetch();
    } catch (err) {
      setOwnerActionError(err instanceof Error ? err.message : t("arena.couldntSettle"));
    } finally {
      setBusyDuelId(null);
    }
  }

  async function handleTiebreak(duelId: string, winnerWorkId: string) {
    setBusyDuelId(duelId);
    setOwnerActionError(null);
    try {
      await resolveTiebreak(tournament!.id, duelId, winnerWorkId);
      await refetch();
    } catch (err) {
      setOwnerActionError(err instanceof Error ? err.message : t("arena.couldntResolveTie"));
    } finally {
      setBusyDuelId(null);
    }
  }

  // Live matches this viewer hasn't voted in — the only thing the
  // tournament actually asks of them.
  const pendingVotes =
    tournament.status === "active" ? tournament.duels.filter((d) => d.status === "active" && !d.hasVoted).length : 0;

  return (
    <Page
      title={
        isOwner && editingName ? (
          <input
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => void handleRename()}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleRename();
              if (e.key === "Escape") setEditingName(false);
            }}
            aria-label={t("arena.tournamentName")}
            className={TITLE_FIELD_CLASS}
          />
        ) : isOwner ? (
          <button
            onClick={() => {
              setNameDraft(tournament.name);
              setEditingName(true);
            }}
            title={t("arena.renameTournament")}
            className="flex min-h-11 w-full items-center text-left font-bold transition-colors hover:text-(--color-accent)"
          >
            <span className="min-w-0 break-words">{tournament.name}</span>
          </button>
        ) : (
          tournament.name
        )
      }
      subtitle={
        <span className="flex flex-wrap items-center gap-1.5">
          {sharedT(locale)(tournament.subject ? "shared.helpers.bracketCharacters" : "shared.helpers.bracketBooks", { size: tournament.bracketSize })}
          <TournamentStatusBadge status={tournament.status} round={tournament.currentRound} />
        </span>
      }
      back={back}
    >
      {tournament.subject ? <CharacterHeader subject={tournament.subject} /> : null}
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
            {mode === "matches" ? t("arena.viewMatches") : t("arena.viewBracket")}
            {/* How many live matches this viewer still hasn't voted in.
                Without it the tournament never asks for anything — you
                have to open a view and hunt for a match still running.
                Shown on both tabs because the count is a property of the
                tournament, not of how you're looking at it. */}
            {pendingVotes > 0 && (
              <span className="rounded-full bg-(--color-accent) px-1.5 text-[10px] font-bold text-(--color-on-accent) tabular-nums">{pendingVotes}</span>
            )}
          </button>
        ))}
      </div>

      {view === "bracket" &&
        (tournament.status === "seeding" ? (
          // BracketMap draws the full skeleton from bracketSize, so it
          // WOULD render an all-empty bracket here. That reads as broken
          // rather than as "not started", so say so instead.
          <EmptyState title={t("arena.notStarted")} body={t("arena.notStartedBody")} />
        ) : (
          <BracketMap
            tournament={tournament}
            onVote={(duelId, workId) => void handleVote(duelId, workId)}
            votingDuelId={busyDuelId}
          />
        ))}

      {view === "matches" && (
      <BracketTree
        tournament={tournament}
        renderDuel={(duelId, round) => {
          const duel = tournament.duels.find((d) => d.id === duelId)!;
          const votingDisabledReason = duel.hasVoted ? t("arena.alreadyVoted") : tournament.status !== "active" ? t("arena.notActive") : null;
          return (
            <div>
              <DuelCard
                duel={duel}
                round={round}
                character={tournament.subject !== null}
                onVote={(workId) => void handleVote(duel.id, workId)}
                votingDisabledReason={votingDisabledReason}
                onAddBook={tournament.subject ? undefined : setPicked}
              />
              {isOwner && duel.status === "active" && (
                <button
                  onClick={() => void handleSettle(duel.id)}
                  disabled={busyDuelId === duel.id}
                  className={`${BUTTON_SECONDARY} mt-2 w-full`}
                >
                  {t("arena.settleNow")}
                </button>
              )}
              {isOwner && duel.status === "tied_pending_tiebreak" && (
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => void handleTiebreak(duel.id, duel.bookA.workId!)}
                    disabled={busyDuelId === duel.id || duel.bookA.workId === null}
                    className={`${BUTTON_SECONDARY} flex-1`}
                  >
                    {t("arena.winsTitle", { title: duel.bookA.title })}
                  </button>
                  <button
                    onClick={() => void handleTiebreak(duel.id, duel.bookB.workId!)}
                    disabled={busyDuelId === duel.id || duel.bookB.workId === null}
                    className={`${BUTTON_SECONDARY} flex-1`}
                  >
                    {t("arena.winsTitle", { title: duel.bookB.title })}
                  </button>
                </div>
              )}
            </div>
          );
        }}
      />
      )}
      {picked && (
        <AddBookSheet
          book={{ title: picked.title, author: picked.author, isbn: null, coverUrl: picked.cover ?? null }}
          onClose={() => setPicked(null)}
        />
      )}
    </Page>
  );
}
