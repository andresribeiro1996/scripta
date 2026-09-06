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
//  4. submitted, or closed  — TierlistResultsView (Task 9's pure aggregate,
//                             no further network calls to switch modes).
//
// "Submitted" here means THIS SESSION explicitly submitted (the hook's
// `ballot` state) — a returning voter in a fresh session sees the board
// again and can resubmit; the backend resolves that to an edit of their
// existing ballot (by account, or by the localStorage ballot id for an
// anonymous voter — see useTierlistVoting.ts's own comment), never a
// second ballot, so this is a UX simplification, not a correctness gap.
import { useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import type { PublicBookData } from "../api/sharedMurals";
import type { TierlistData } from "../api/tierlists";
import { useAuth } from "../auth/AuthContext";
import { TierBoard } from "../components/tierlist/TierBoard";
import { TierlistResultsView } from "../components/tierlist/TierlistResultsView";
import { useTierlistVoting } from "../hooks/useTierlistVoting";
import { toPlacements } from "../lib/tierlistResults";

/** The exact inverse of the backend's toPublicBookData
 *  (publicResolver.ts) — same reconstruction SharedMuralPage.tsx's own
 *  toPrivateBook does, for the same reason: MiniBookTile/CoverImage only
 *  know how to read the PRIVATE book shape (Title/Attribution/ISBN/
 *  ImageId/_coverUrl/ReadStatus), because that's the only shape the
 *  authenticated editor ever hands them. No highlights field here (unlike
 *  the mural page's version) — a tier list book tile never shows one. */
function toPrivateBook(pub: PublicBookData): Record<string, unknown> {
  return {
    Title: pub.title,
    Attribution: pub.author,
    ISBN: pub.isbn,
    ImageId: pub.imageId,
    _coverUrl: pub.coverUrl,
    ReadStatus: pub.readStatus
  };
}

/** The board a voter starts from: the frozen tier structure with every
 *  tier emptied, so every pool book starts unranked. */
function blankBoard(board: { tiers: Array<{ id: string; label: string; color: string }>; pool: string[] }): TierlistData {
  return {
    tiers: board.tiers.map((t) => ({ ...t, bookKeys: [] })),
    pool: board.pool
  };
}

function InfoScreen({ message }: { message: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-5 text-center">
      <p className="text-(--color-text-dim)">{message}</p>
    </div>
  );
}

export function VoteTierlistPage() {
  const { code } = useParams<{ code: string }>();
  const location = useLocation();
  const { session } = useAuth();
  const { board, books: publicBooks, isLoading, error, ballot, submit } = useTierlistVoting(code ?? "");
  const [working, setWorking] = useState<TierlistData | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  if (!code || error) {
    return <InfoScreen message="No tier list at that link." />;
  }
  if (isLoading || !board) {
    return <InfoScreen message="Loading…" />;
  }

  const books = publicBooks.map((b) => toPrivateBook(b as unknown as PublicBookData));
  const signedIn = Boolean(session);
  const alreadySubmitted = ballot !== null;
  const showResults = alreadySubmitted || !board.votingOpen;

  if (showResults) {
    const histogram = ballot?.results.histogram ?? board.histogram;
    const ballotCount = ballot?.results.ballotCount ?? board.ballotCount;
    return (
      <div className="mx-auto max-w-5xl px-5 py-8">
        <h1 className="mb-1 text-lg font-bold">{board.name}</h1>
        <p className="mb-4 text-sm text-(--color-text-dim)">
          {alreadySubmitted && "Your ballot is in. "}
          {board.votingOpen ? "Voting is still open." : "Voting is closed."}
        </p>
        <TierlistResultsView
          histogram={histogram}
          tierIds={board.tiers.map((t) => t.id)}
          tiers={board.tiers}
          pool={board.pool}
          books={books}
          ballotCount={ballotCount}
        />
      </div>
    );
  }

  const data = working ?? blankBoard(board);
  const membersOnlyBlocked = board.access === "members" && !signedIn;

  async function handleSubmit() {
    setSubmitError(null);
    setSubmitting(true);
    try {
      await submit(toPlacements(data));
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Couldn't submit your ballot.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      <header className="mb-4 flex items-center justify-between gap-3">
        <h1 className="min-w-0 flex-1 truncate text-lg font-bold">{board.name}</h1>
        {membersOnlyBlocked ? (
          <Link
            to="/login"
            state={{ from: location }}
            className="min-h-9 shrink-0 rounded-lg bg-(--color-accent) px-3 text-sm font-semibold text-white flex items-center"
          >
            Sign in to vote
          </Link>
        ) : (
          <button
            onClick={() => void handleSubmit()}
            disabled={submitting}
            className="min-h-9 shrink-0 rounded-lg bg-(--color-accent) px-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {submitting ? "Submitting…" : "Submit ballot"}
          </button>
        )}
      </header>
      <p className="mb-4 text-sm text-(--color-text-dim)">
        {membersOnlyBlocked
          ? "This tier list only accepts votes from signed-in members — rank away, then sign in to cast your ballot."
          : "Drag books into tiers to rank them, then submit your ballot."}
      </p>
      {submitError && <p className="mb-4 text-sm text-(--color-danger)">{submitError}</p>}
      <TierBoard data={data} books={books} onChange={setWorking} structureEditable={false} />
    </div>
  );
}
