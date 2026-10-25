// /vote/:code — the page a voting link recipient actually lands on (see
// App.tsx: OUTSIDE every RequireAuth/RequireUsername wrapper, no session
// required at all, same treatment as /shared/murals/:token). Fetches the
// public voting board (api/tierlistVoting.ts, GET /tierlists/voting/:code
// via hooks/useTierlistVoting.ts) and renders exactly one of four states:
//
//  1. not found            — bad/expired code, or the fetch failed.
//  2. open, not submitted   — TierBoard (structureEditable={false}) plus a
//                             Submit button. Ranking is purely local state;
//                             nothing is saved until Submit is pressed —
//                             this page casts ONE ballot, explicitly.
//  3. members-only, signed out — same board, but a "sign in to vote" link
//                             stands in for Submit (voting itself requires
//                             an account; ranking locally first doesn't).
//  4. already voted, or closed — TierlistResultsView (Task 9's pure
//                             aggregate, no further network calls to switch
//                             modes), plus an "Edit ballot" button while
//                             voting is open.
//
// "Already voted" covers any earlier session too, not just this one: the
// hook re-fetches whatever ballot the caller holds (by account, or by the
// localStorage ballot id for an anonymous voter). Editing one loads it back
// onto the board, so a returning voter adjusts their ranking instead of
// rebuilding it from an empty board.
import { ballotBoard, blankBoard } from "@scripta/shared";
import { useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import type { PublicBookData } from "../api/sharedMurals";
import type { TierlistData } from "../api/tierlists";
import { useAuth } from "../auth/AuthContext";
import { AddBookSheet } from "../components/AddBookSheet";
import { CoverImage } from "../components/BookCard";
import { Page } from "../components/page/Page";
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from "../components/page/buttonClasses";
import { Sheet } from "../components/Sheet";
import { TierBoard } from "../components/tierlist/TierBoard";
import { TierlistResultsView } from "../components/tierlist/TierlistResultsView";
import { useTierlistVoting } from "../hooks/useTierlistVoting";
import { toPrivateBook } from "../lib/sharedMural";
import { toPlacements } from "../lib/tierlistResults";

function InfoScreen({ message }: { message: string }) {
  return (
    <Page title="Tier list">
      <p className="text-sm text-(--color-text-dim)">{message}</p>
    </Page>
  );
}

export function VoteTierlistPage() {
  const { code } = useParams<{ code: string }>();
  const location = useLocation();
  const { session } = useAuth();
  const { board, books: publicBooks, isLoading, error, ballotError, ballot, justSubmitted, submit } = useTierlistVoting(code ?? "");
  const [working, setWorking] = useState<TierlistData | null>(null);
  const [editing, setEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [booksOpen, setBooksOpen] = useState(false);
  const [picked, setPicked] = useState<PublicBookData | null>(null);

  if (!code || error) {
    return <InfoScreen message="No tier list at that link." />;
  }
  if (isLoading || !board) {
    return <InfoScreen message="Loading…" />;
  }
  if (ballotError) {
    return <InfoScreen message="Couldn't load your ballot. Reload to try again." />;
  }

  const books = publicBooks.map((b) => toPrivateBook(b as unknown as PublicBookData));
  const signedIn = Boolean(session);
  const alreadySubmitted = ballot !== null;
  const showResults = (alreadySubmitted || !board.votingOpen) && !editing;

  const booksSheet = booksOpen && !picked ? (
    <Sheet title="Books" onClose={() => setBooksOpen(false)}>
      <div className="flex flex-col">
        {publicBooks.map((entry) => {
          const pub = entry as unknown as PublicBookData;
          return (
            <button
              key={`${pub.title}::${pub.author}`}
              onClick={() => setPicked(pub)}
              className="flex min-h-12 items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-(--color-surface-hover)"
            >
              <span className="relative block h-11 w-8 shrink-0 overflow-hidden rounded bg-(--color-border)">
                <CoverImage
                  book={{
                    Title: pub.title,
                    Attribution: pub.author,
                    ISBN: pub.isbn ?? undefined,
                    ImageId: pub.imageId ?? undefined,
                    _coverUrl: pub.coverUrl ?? undefined
                  }}
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium">{pub.title}</span>
                <span className="block truncate text-xs text-(--color-text-dim)">{pub.author}</span>
              </span>
            </button>
          );
        })}
      </div>
    </Sheet>
  ) : null;
  const pickedSheet = picked ? (
    <AddBookSheet
      book={{ title: picked.title, author: picked.author, isbn: picked.isbn, coverUrl: picked.coverUrl }}
      onClose={() => {
        setPicked(null);
        setBooksOpen(false);
      }}
    />
  ) : null;

  if (showResults) {
    // board.histogram is only ever present on a CLOSED poll — while voting
    // is open the backend withholds it, and the only histogram this page
    // has is the one that came back with the caller's own ballot.
    const histogram = ballot?.results.histogram ?? board.histogram ?? [];
    const ballotCount = ballot?.results.ballotCount ?? board.ballotCount;
    return (
      <Page
        title={board.name}
        actions={
          <>
            {ballot && board.votingOpen && (
              <button
                onClick={() => {
                  setWorking(ballotBoard(board, ballot.placements));
                  setEditing(true);
                }}
                className={BUTTON_SECONDARY}
              >
                Edit ballot
              </button>
            )}
            <button onClick={() => setBooksOpen(true)} className={BUTTON_SECONDARY}>
              Books
            </button>
          </>
        }
      >
        {board.ranksWorstFirst ? <p className="mb-2 text-xs text-(--color-text-dim)">Top tier = worst</p> : null}
        <p className="mb-4 text-sm text-(--color-text-dim)">
          {justSubmitted ? "Your ballot is in. " : alreadySubmitted ? "You've already ranked this one. " : ""}
          {board.promotedAt ? "Permanent public reference." : board.votingOpen ? "Voting is still open." : "Voting is closed."}
        </p>
        <TierlistResultsView
          histogram={histogram}
          tierIds={board.tiers.map((t) => t.id)}
          tiers={board.tiers}
          pool={board.pool}
          books={books}
          ballotCount={ballotCount}
        />
        {booksSheet}
        {pickedSheet}
      </Page>
    );
  }

  const data = working ?? (ballot && editing ? ballotBoard(board, ballot.placements) : blankBoard(board));
  const membersOnlyBlocked = board.access === "members" && !signedIn;

  async function handleSubmit() {
    setSubmitError(null);
    setSubmitting(true);
    try {
      await submit(toPlacements(data));
      setEditing(false);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Couldn't submit your ballot.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Page
      title={board.name}
      actions={
        <>
          {membersOnlyBlocked ? (
            <Link to="/login" state={{ from: location }} className={BUTTON_PRIMARY}>
              Sign in to vote
            </Link>
          ) : (
            <>
              {editing && (
                <button
                  onClick={() => {
                    setWorking(null);
                    setEditing(false);
                  }}
                  className={BUTTON_SECONDARY}
                >
                  Cancel
                </button>
              )}
              <button onClick={() => void handleSubmit()} disabled={submitting || toPlacements(data).length === 0} className={BUTTON_PRIMARY}>
                {submitting ? "Submitting…" : editing ? "Update ballot" : "Submit ballot"}
              </button>
            </>
          )}
          <button onClick={() => setBooksOpen(true)} className={BUTTON_SECONDARY}>
            Books
          </button>
        </>
      }
    >
      {board.ranksWorstFirst ? <p className="mb-2 text-xs text-(--color-text-dim)">Top tier = worst</p> : null}
      <p className="mb-4 text-sm text-(--color-text-dim)">
        {membersOnlyBlocked
          ? "This tier list only accepts votes from signed-in members — rank away, then sign in to cast your ballot."
          : "Drag books into tiers to rank them, then submit your ballot."}
      </p>
      {submitError && <p className="mb-4 text-sm text-(--color-danger)">{submitError}</p>}
      <TierBoard data={data} books={books} onChange={setWorking} structureEditable={false} />
      {booksSheet}
      {pickedSheet}
    </Page>
  );
}
