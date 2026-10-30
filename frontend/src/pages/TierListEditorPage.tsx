import { ballotBoard, workIdOf, booksByWork, characterBooks, itemNoun } from "@scripta/shared";
import { useEffect, useState } from "react";
import { useOutletContext, useParams } from "react-router-dom";
import type { TierlistData } from "../api/tierlists";
import { openVotingApi, setVotingStateApi } from "../api/tierlistVoting";
import { TierRow } from "../components/murals/blocks/BookBlocks";
import { CharacterHeader } from "../components/CharacterHeader";
import { Page } from "../components/page/Page";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, TITLE_FIELD_CLASS } from "../components/page/buttonClasses";
import { backTo } from "../lib/areas";
import { AddBooksSheet } from "../components/tierlist/AddBooksSheet";
import { TierBoard } from "../components/tierlist/TierBoard";
import { TierlistResultsView } from "../components/tierlist/TierlistResultsView";
import { useDismissible } from "../hooks/useDismissible";
import { useLibrary } from "../hooks/useLibrary";
import { useTierlists } from "../hooks/useTierlists";
import { useTierlistResults, useTierlistVoting } from "../hooks/useTierlistVoting";
import { useWorkBooks } from "../hooks/useWorkBooks";

export function TierListEditorPage() {
  const { id } = useParams<{ id: string }>();
  const { data: library } = useLibrary();
  const { data: tierlistsData, isLoading, rename, saveData, refetch } = useTierlists();
  const libraryBooks = useWorkBooks(library);
  const tierlist = (tierlistsData ?? []).find((t) => t.id === id);
  const subject = tierlist?.subject ?? null;
  const books = subject ? characterBooks(subject) : libraryBooks;
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [addingBooks, setAddingBooks] = useState(false);
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);

  // The voting board (ballot count, frozen tiers/pool) behind this tier
  // list's OWN vote code, read through the same public route voters hit
  // (GET /tierlists/voting/:code). Called unconditionally (hook rules),
  // with "" when there's no code yet — the hook itself declines to fire on
  // an empty code rather than spending the public rate limit on a 404.
  // `ownBallot`: opening voting MOVES the owner's ranking out of the tier
  // list document and into a seeded ballot, leaving `tierlist.data` as the
  // blank template every voter ranks. Rendering that alone showed the owner
  // an empty board and looked like their ranking had been thrown away.
  const { board: votingBoard, ballot: ownBallot } = useTierlistVoting(tierlist?.voteCode ?? "");
  // The histogram does NOT come from that board: it's withheld while voting
  // is open, so nobody reads the standings before voting. The owner is the
  // exception the spec grants ("owner sees them any time"), and this is the
  // ownership-checked route that serves them.
  const ownerResults = useTierlistResults(tierlist?.voteCode ? tierlist.id : undefined);

  // "Open for voting" and the public tier list's access/open toggles —
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
  // public tier list renders the same fixed-pool-dock TierBoard any time it
  // has a vote code — never gated behind `editing`, since there's no edit
  // mode to enter there — so the nav has to stay clear of it too.
  const { setNavHidden } = useOutletContext<{ setNavHidden: (hidden: boolean) => void }>();
  const isPublic = tierlist?.voteCode != null;
  useEffect(() => {
    setNavHidden(editing || isPublic);
    return () => setNavHidden(false);
  }, [editing, isPublic, setNavHidden]);

  if (isLoading) {
    return (
      <Page title="Tier list" back={backTo("tierlist")}>
        <p className="text-sm text-(--color-text-dim)">Loading…</p>
      </Page>
    );
  }

  if (!tierlist) {
    return (
      <Page title="Tier list" back={backTo("tierlist")}>
        <p className="text-sm text-(--color-text-dim)">No tier list with that id.</p>
      </Page>
    );
  }

  const data = tierlist.data;
  const tierlistId = tierlist.id;
  const tierlistName = tierlist.name;
  const voteCode = tierlist.voteCode;
  const voteLink = `${window.location.origin}/vote/${voteCode}`;
  const voteAccess = tierlist.voteAccess;
  const votingOpen = tierlist.votingOpen;

  async function copyVoteLink() {
    try {
      await navigator.clipboard.writeText(voteLink);
    } catch {
      setVotingActionError("Couldn't copy the link.");
      return;
    }
    setVotingActionError(null);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  async function commit(next: TierlistData) {
    setVotingActionError(null);
    try {
      await saveData(tierlistId, next);
    } catch (err) {
      setVotingActionError(err instanceof Error ? err.message : "Couldn't save the tier list.");
    }
  }

  async function handleRename() {
    const name = nameDraft.trim();
    setEditingName(false);
    if (!name || name === tierlistName) return;
    setVotingActionError(null);
    try {
      await rename(tierlistId, name);
    } catch (err) {
      setVotingActionError(err instanceof Error ? err.message : "Couldn't rename the tier list.");
    }
  }

  async function handleOpenVoting() {
    setVotingActionError(null);
    setOpeningVoting(true);
    try {
      await openVotingApi(tierlistId, voteAccessDraft);
      await refetch();
      setOpenPanelOpen(false);
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

  function addBooksToPool(workIds: string[]) {
    const taken = new Set([...data.pool, ...data.tiers.flatMap((t) => t.workIds)]);
    const fresh = workIds.filter((id) => !taken.has(id));
    if (fresh.length === 0) return;
    void commit({ ...data, pool: [...data.pool, ...fresh] });
  }

  const byWork = booksByWork(books);
  const resolvedPool = data.pool.filter((id) => byWork.has(id));

  return (
    <Page
      back={backTo("tierlist")}
      title={editingName && voteCode === null ? (
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
          className={TITLE_FIELD_CLASS}
        />
      ) : (
        <button
          disabled={voteCode !== null}
          onClick={() => {
            setNameDraft(tierlist.name);
            setEditingName(true);
          }}
          title="Rename this tier list"
          className="flex min-h-11 min-w-0 max-w-full items-center text-left transition-colors hover:text-(--color-accent)"
        >
          <span className="min-w-0 break-words">{tierlist.name}</span>
        </button>
      )}
      actions={voteCode === null ? (
        <>
          <button
            onClick={() => (editing ? exitEditing() : setEditing(true))}
            className={BUTTON_SECONDARY}
          >
            {editing ? "Done" : "Edit"}
          </button>
          {openPanelOpen ? null : (
            <button onClick={() => setOpenPanelOpen(true)} className={BUTTON_PRIMARY}>
              Open for voting
            </button>
          )}
        </>
      ) : undefined}
    >

      {subject ? <CharacterHeader subject={subject} /> : null}
      {votingActionError && <p className="mb-4 text-sm text-(--color-danger)">{votingActionError}</p>}

      {voteCode === null ? (
        openPanelOpen ? (
          <div className="mb-6 rounded-xl border border-(--color-border) bg-(--color-surface) p-3">
            <div className="flex flex-col gap-2">
              <p className="text-sm text-(--color-text-dim)">Who can vote?</p>
              <div className="flex items-stretch overflow-hidden rounded-lg border border-(--color-border) bg-(--color-surface)">
                {(["anonymous", "members"] as const).map((access, i) => (
                  <button
                    key={access}
                    onClick={() => setVoteAccessDraft(access)}
                    aria-pressed={voteAccessDraft === access}
                    className={`flex min-h-11 flex-1 items-center justify-center px-3 text-sm font-semibold ${
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
                  className={`${BUTTON_PRIMARY} flex-1`}
                >
                  {openingVoting ? "Opening…" : "Confirm and open"}
                </button>
                <button
                  onClick={() => setOpenPanelOpen(false)}
                  disabled={openingVoting}
                  className={BUTTON_SECONDARY}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : null
      ) : (
        <div className="mb-6 flex flex-col gap-3 rounded-xl border border-(--color-border) bg-(--color-surface) p-3">
          <p className="text-sm text-(--color-text-dim)">This public tier list is locked. At 100 distinct signed-in voters, it becomes an app-owned reference.</p>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-1 basis-60 items-center gap-2">
              <a href={voteLink} className="inline-flex min-h-11 min-w-0 flex-1 items-center text-sm font-semibold text-(--color-accent) hover:opacity-80">
                <span className="truncate">{voteLink}</span>
              </a>
              <button type="button" onClick={() => void copyVoteLink()} className={`${BUTTON_SECONDARY} shrink-0`}>
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <span className="text-xs text-(--color-text-dim)">
              {votingBoard?.ballotCount ?? 0} {(votingBoard?.ballotCount ?? 0) === 1 ? "ballot" : "ballots"} · {votingBoard?.eligibleVoteCount ?? 0}/100 eligible voters
            </span>
          </div>
          <a
            href={`/vote/${voteCode}`}
            className={`${BUTTON_SECONDARY} self-start`}
          >
            {ownBallot?.placements.length ? "Edit your ballot" : "Rank your ballot"}
          </a>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-stretch overflow-hidden rounded-lg border border-(--color-border) bg-(--color-surface)">
              {(["anonymous", "members"] as const).map((access, i) => (
                <button
                  key={access}
                  onClick={() => void handleAccessChange(access)}
                  disabled={savingAccess}
                  aria-pressed={voteAccess === access}
                  className={`flex min-h-11 items-center justify-center px-3 text-sm font-semibold disabled:opacity-60 ${
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
              className={BUTTON_SECONDARY}
            >
              {votingOpen ? (savingOpenState ? "Closing…" : "Close voting") : savingOpenState ? "Reopening…" : "Reopen voting"}
            </button>
          </div>
        </div>
      )}

      {voteCode !== null ? (
        <TierBoard data={ownBallot ? ballotBoard(data, ownBallot.placements) : data} books={books} onChange={() => {}} structureEditable={false} />
      ) : !editing ? (
        <div className="flex flex-col gap-2">
          {data.tiers.length === 0 ? (
            <p className="text-sm text-(--color-text-dim)">No tiers yet — tap Edit to add one.</p>
          ) : (
            data.tiers.map((tier) => <TierRow key={tier.id} tier={tier} books={books} />)
          )}
          {resolvedPool.length > 0 && (
            <p className="mt-1 text-xs text-(--color-text-dim)">
              {resolvedPool.length} {itemNoun(subject, resolvedPool.length)} still unranked — tap Edit to place them.
            </p>
          )}
        </div>
      ) : (
        <TierBoard data={data} books={books} onChange={(next) => void commit(next)} structureEditable={editing} onAddBooks={subject ? undefined : () => setAddingBooks(true)} />
      )}

      {voteCode !== null && (
        // Extra bottom padding — TierBoard above pins its pool dock to the
        // true viewport bottom (see its own comment), which would otherwise
        // sit on top of whatever scrolls to the end of this results section.
        <div className="mt-6 pb-[13rem]">
          <h2 className="mb-2 text-sm font-bold">Results</h2>
          {votingBoard && ownerResults ? (
            <TierlistResultsView
              histogram={ownerResults.histogram}
              tierIds={votingBoard.tiers.map((t) => t.id)}
              tiers={votingBoard.tiers}
              pool={votingBoard.pool}
              books={books}
              ballotCount={ownerResults.ballotCount}
            />
          ) : (
            <p className="text-sm text-(--color-text-dim)">Loading results…</p>
          )}
        </div>
      )}

      {addingBooks && (
        <AddBooksSheet
          books={books.filter((b) => {
            const workId = workIdOf(b);
            return workId !== undefined && !data.pool.includes(workId) && !data.tiers.some((t) => t.workIds.includes(workId));
          })}
          onAdd={addBooksToPool}
          onClose={() => setAddingBooks(false)}
        />
      )}
    </Page>
  );
}
