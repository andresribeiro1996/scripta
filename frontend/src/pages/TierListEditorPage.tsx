import { useEffect, useState } from "react";
import { Link, useNavigate, useOutletContext, useParams } from "react-router-dom";
import type { TierlistData } from "../api/tierlists";
import { openVotingApi, setVotingStateApi } from "../api/tierlistVoting";
import { TierRow } from "../components/murals/blocks/BookBlocks";
import { PageContainer } from "../components/PageContainer";
import { AddBooksSheet } from "../components/tierlist/AddBooksSheet";
import { TierBoard } from "../components/tierlist/TierBoard";
import { TierlistResultsView } from "../components/tierlist/TierlistResultsView";
import { useDismissible } from "../hooks/useDismissible";
import { useLibrary } from "../hooks/useLibrary";
import { useTierlists } from "../hooks/useTierlists";
import { useTierlistVoting } from "../hooks/useTierlistVoting";
import { bookKey } from "../lib/merge";

export function TierListEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: library } = useLibrary();
  const { data: tierlistsData, isLoading, rename, saveData, refetch } = useTierlists();
  const books = library?.data.books ?? [];
  const tierlist = (tierlistsData ?? []).find((t) => t.id === id);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [addingBooks, setAddingBooks] = useState(false);
  const [editing, setEditing] = useState(false);

  // The voting board (histogram, ballot count, frozen tiers/pool) behind
  // this tier list's OWN vote code, read through the same public route
  // voters hit (GET /tierlists/voting/:code) — reused rather than adding a
  // separate owner-only results fetch, since it already carries everything
  // TierlistResultsView needs. Called unconditionally (hook rules), with ""
  // when there's no code yet; that resolves to a harmless 404 nobody reads.
  const { board: votingBoard } = useTierlistVoting(tierlist?.voteCode ?? "");

  // "Open for voting" and the community copy's own access/open toggles —
  // three independent async actions sharing one error slot, since only one
  // can ever be in flight from this page at a time.
  const [openPanelOpen, setOpenPanelOpen] = useState(false);
  const [voteAccessDraft, setVoteAccessDraft] = useState<"anonymous" | "members">("anonymous");
  const [openingVoting, setOpeningVoting] = useState(false);
  const [savingAccess, setSavingAccess] = useState(false);
  const [savingOpenState, setSavingOpenState] = useState(false);
  const [votingActionError, setVotingActionError] = useState<string | null>(null);

  // Leaving edit mode should leave no editing UI armed for the next Edit tap
  // — without this, Edit → open the add-books sheet → Done → Edit reopens
  // the sheet (and, previously, reopened the rename input) because neither
  // piece of state was ever cleared, only hidden behind `editing`'s own
  // check. Called from both places editing actually turns off (Done below,
  // and the dismissible handler right after) rather than from an effect
  // watching `editing`, so this stays a plain event-driven state update
  // instead of a setState-in-effect.
  function exitEditing() {
    setEditing(false);
    setAddingBooks(false);
    setEditingName(false);
  }

  // Escape and the app-wide edge-swipe-back (components/EdgeSwipeBack.tsx)
  // exit editing first and only leave the page on a second gesture —
  // registering here rather than making the mode a route keeps the
  // browser's own history meaning "which tier list", not "which mode".
  useDismissible(exitEditing, editing);

  // The bottom tab bar covers the pool dock and costs 3.5rem of a phone's
  // height while ranking, which is the whole activity in edit mode. Same
  // trade MuralEditorPage.tsx:89-93 already makes for its canvas. A
  // community copy renders the same fixed-pool-dock TierBoard any time it
  // has a vote code — never gated behind `editing`, since there's no edit
  // mode to enter there — so the nav has to stay clear of it too.
  const { setNavHidden } = useOutletContext<{ setNavHidden: (hidden: boolean) => void }>();
  const isCommunityCopy = tierlist?.voteCode != null;
  useEffect(() => {
    setNavHidden(editing || isCommunityCopy);
    return () => setNavHidden(false);
  }, [editing, isCommunityCopy, setNavHidden]);

  if (isLoading) {
    return (
      <PageContainer>
        <p className="text-sm text-(--color-text-dim)">Loading…</p>
      </PageContainer>
    );
  }

  if (!tierlist) {
    return (
      <PageContainer>
        <p className="text-sm text-(--color-text-dim)">
          No tier list with that id.{" "}
          <Link to="/dashboard/arena?tab=tierlists" className="text-(--color-accent) transition-opacity hover:opacity-80">
            Back to Arena
          </Link>
          .
        </p>
      </PageContainer>
    );
  }

  const data = tierlist.data;
  const tierlistId = tierlist.id;
  const tierlistName = tierlist.name;
  const voteCode = tierlist.voteCode;
  const voteAccess = tierlist.voteAccess;
  const votingOpen = tierlist.votingOpen;

  function commit(next: TierlistData) {
    void saveData(tierlistId, next);
  }

  async function handleRename() {
    const name = nameDraft.trim();
    setEditingName(false);
    if (!name || name === tierlistName) return;
    await rename(tierlistId, name);
  }

  // Mints the vote code and navigates straight to the new community copy —
  // that copy, not this original, is where the owner manages voting from
  // (link, access, close/reopen, results) from here on. `refetch` first so
  // the tierlists cache already has the copy by the time the new route's
  // own `tierlist` lookup runs, avoiding a flash of "No tier list with
  // that id" on arrival.
  async function handleOpenVoting() {
    setVotingActionError(null);
    setOpeningVoting(true);
    try {
      const { tierlist: copy } = await openVotingApi(tierlistId, voteAccessDraft);
      await refetch();
      navigate(`/dashboard/arena/tierlist/${copy.id}`);
    } catch (err) {
      setVotingActionError(err instanceof Error ? err.message : "Couldn't open voting.");
    } finally {
      setOpeningVoting(false);
    }
  }

  async function handleAccessChange(access: "anonymous" | "members") {
    if (access === voteAccess || savingAccess) return;
    setVotingActionError(null);
    setSavingAccess(true);
    try {
      await setVotingStateApi(tierlistId, { access });
      await refetch();
    } catch (err) {
      setVotingActionError(err instanceof Error ? err.message : "Couldn't change who can vote.");
    } finally {
      setSavingAccess(false);
    }
  }

  async function handleToggleVotingOpen() {
    setVotingActionError(null);
    setSavingOpenState(true);
    try {
      await setVotingStateApi(tierlistId, { open: !votingOpen });
      await refetch();
    } catch (err) {
      setVotingActionError(err instanceof Error ? err.message : "Couldn't update voting.");
    } finally {
      setSavingOpenState(false);
    }
  }

  function addBooksToPool(keys: string[]) {
    const taken = new Set([...data.pool, ...data.tiers.flatMap((t) => t.bookKeys)]);
    const fresh = keys.filter((k) => !taken.has(k));
    if (fresh.length === 0) return;
    commit({ ...data, pool: [...data.pool, ...fresh] });
  }

  const byKey = new Map(books.map((b) => [bookKey(b), b] as const));
  const resolvedPool = data.pool.filter((k) => byKey.has(k));

  return (
    <PageContainer>
      <header className="mb-6">
        <Link to="/dashboard/arena?tab=tierlists" className="text-xs text-(--color-text-dim) hover:text-(--color-text)">
          ← Arena
        </Link>
        <div className="flex items-center justify-between gap-3">
          {editingName ? (
            <input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={() => void handleRename()}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleRename();
                if (e.key === "Escape") setEditingName(false);
              }}
              aria-label="Tier list name"
              className="block min-w-0 flex-1 rounded-lg border border-(--color-border) bg-(--color-surface) px-2 py-1 text-lg font-bold"
            />
          ) : (
            <button
              onClick={() => {
                setNameDraft(tierlist.name);
                setEditingName(true);
              }}
              title="Rename this tier list"
              className="block min-w-0 flex-1 truncate text-left text-lg font-bold transition-colors hover:text-(--color-accent)"
            >
              {tierlist.name}
            </button>
          )}
          {/* Structure editing is meaningless once this list has a vote
              code — see the panel below — so the Edit/Done toggle that
              drives it is dropped entirely rather than shown disabled. */}
          {voteCode === null && (
            <button
              onClick={() => (editing ? exitEditing() : setEditing(true))}
              className={`min-h-9 shrink-0 rounded-lg px-3 text-sm font-semibold ${
                editing
                  ? "bg-(--color-accent) text-white"
                  : "border border-(--color-border) bg-(--color-surface) hover:bg-(--color-surface-hover)"
              }`}
            >
              {editing ? "Done" : "Edit"}
            </button>
          )}
        </div>
      </header>

      {votingActionError && <p className="mb-4 text-sm text-(--color-danger)">{votingActionError}</p>}

      {voteCode === null ? (
        <div className="mb-6 rounded-xl border border-(--color-border) bg-(--color-surface) p-3">
          {openPanelOpen ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-(--color-text-dim)">Who can vote?</p>
              <div className="flex items-stretch overflow-hidden rounded-lg border border-(--color-border) bg-(--color-surface)">
                {(["anonymous", "members"] as const).map((access, i) => (
                  <button
                    key={access}
                    onClick={() => setVoteAccessDraft(access)}
                    aria-pressed={voteAccessDraft === access}
                    className={`flex min-h-9 flex-1 items-center justify-center px-3 text-sm font-semibold ${
                      i > 0 ? "border-l border-(--color-border)" : ""
                    } ${
                      voteAccessDraft === access
                        ? "bg-(--color-accent-soft) text-(--color-accent)"
                        : "text-(--color-text-dim) hover:bg-(--color-surface-hover)"
                    }`}
                  >
                    {access === "anonymous" ? "Anyone" : "Members only"}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => void handleOpenVoting()}
                  disabled={openingVoting}
                  className="min-h-9 flex-1 rounded-lg bg-(--color-accent) px-3 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {openingVoting ? "Opening…" : "Confirm and open"}
                </button>
                <button
                  onClick={() => setOpenPanelOpen(false)}
                  disabled={openingVoting}
                  className="min-h-9 rounded-lg border border-(--color-border) bg-(--color-surface) px-3 text-sm font-semibold hover:bg-(--color-surface-hover) disabled:opacity-60"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setOpenPanelOpen(true)}
              className="min-h-9 rounded-lg border border-(--color-border) bg-(--color-surface) px-3 text-sm font-semibold hover:bg-(--color-surface-hover)"
            >
              Open for voting
            </button>
          )}
        </div>
      ) : (
        <div className="mb-6 flex flex-col gap-3 rounded-xl border border-(--color-border) bg-(--color-surface) p-3">
          <p className="text-sm text-(--color-text-dim)">This community tier list is frozen while people vote. Your original stays editable.</p>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <a href={`/vote/${voteCode}`} className="text-sm font-semibold text-(--color-accent) hover:opacity-80">
              /vote/{voteCode}
            </a>
            <span className="text-xs text-(--color-text-dim)">
              {votingBoard?.ballotCount ?? 0} {(votingBoard?.ballotCount ?? 0) === 1 ? "ballot" : "ballots"}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-stretch overflow-hidden rounded-lg border border-(--color-border) bg-(--color-surface)">
              {(["anonymous", "members"] as const).map((access, i) => (
                <button
                  key={access}
                  onClick={() => void handleAccessChange(access)}
                  disabled={savingAccess}
                  aria-pressed={voteAccess === access}
                  className={`flex min-h-9 items-center justify-center px-3 text-sm font-semibold disabled:opacity-60 ${
                    i > 0 ? "border-l border-(--color-border)" : ""
                  } ${
                    voteAccess === access
                      ? "bg-(--color-accent-soft) text-(--color-accent)"
                      : "text-(--color-text-dim) hover:bg-(--color-surface-hover)"
                  }`}
                >
                  {access === "anonymous" ? "Anyone" : "Members only"}
                </button>
              ))}
            </div>
            <button
              onClick={() => void handleToggleVotingOpen()}
              disabled={savingOpenState}
              className="min-h-9 rounded-lg border border-(--color-border) bg-(--color-surface) px-3 text-sm font-semibold hover:bg-(--color-surface-hover) disabled:opacity-60"
            >
              {votingOpen ? (savingOpenState ? "Closing…" : "Close voting") : savingOpenState ? "Reopening…" : "Reopen voting"}
            </button>
          </div>
        </div>
      )}

      {voteCode !== null ? (
        <TierBoard data={data} books={books} onChange={() => {}} structureEditable={false} />
      ) : !editing ? (
        <div className="flex flex-col gap-2">
          {data.tiers.length === 0 ? (
            <p className="text-sm text-(--color-text-dim)">No tiers yet — tap Edit to add one.</p>
          ) : (
            data.tiers.map((tier) => <TierRow key={tier.id} tier={tier} books={books} />)
          )}
          {resolvedPool.length > 0 && (
            <p className="mt-1 text-xs text-(--color-text-dim)">
              {resolvedPool.length} {resolvedPool.length === 1 ? "book" : "books"} still unranked — tap Edit to place them.
            </p>
          )}
        </div>
      ) : (
        <TierBoard data={data} books={books} onChange={commit} structureEditable={editing} onAddBooks={() => setAddingBooks(true)} />
      )}

      {voteCode !== null && (
        // Extra bottom padding — TierBoard above pins its pool dock to the
        // true viewport bottom (see its own comment), which would otherwise
        // sit on top of whatever scrolls to the end of this results section.
        <div className="mt-6 pb-[13rem]">
          <h2 className="mb-2 text-sm font-bold">Results</h2>
          {votingBoard ? (
            <TierlistResultsView
              histogram={votingBoard.histogram}
              tierIds={votingBoard.tiers.map((t) => t.id)}
              tiers={votingBoard.tiers}
              pool={votingBoard.pool}
              books={books}
              ballotCount={votingBoard.ballotCount}
            />
          ) : (
            <p className="text-sm text-(--color-text-dim)">Loading results…</p>
          )}
        </div>
      )}

      {addingBooks && (
        <AddBooksSheet
          books={books.filter((b) => {
            const key = bookKey(b);
            return !data.pool.includes(key) && !data.tiers.some((t) => t.bookKeys.includes(key));
          })}
          onAdd={addBooksToPool}
          onClose={() => setAddingBooks(false)}
        />
      )}
    </PageContainer>
  );
}
