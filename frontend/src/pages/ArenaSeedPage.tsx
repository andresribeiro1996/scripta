// The seeding step for one tournament: SeedSlotGrid for picking books,
// then "Start" once every slot is filled. Redirects away if the current
// session isn't this tournament's owner, or if it's already started
// (seeding is a one-time step).

import { useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { randomFillTournament, renameTournament, setTournamentSlots, startTournament, type SeedBook } from "../api/arena";
import { useAuth } from "../auth/AuthContext";
import { SeedSlotGrid } from "../components/arena/SeedSlotGrid";
import { useArena } from "../hooks/useArena";
import { useLibrary } from "../hooks/useLibrary";
import { toSeedBook } from "../lib/arenaSeed";

export function ArenaSeedPage() {
  const { id } = useParams<{ id: string }>();
  const { session } = useAuth();
  const navigate = useNavigate();
  const { tournament, isLoading, refetch } = useArena(id!);
  const { data: library } = useLibrary();
  const [slots, setSlots] = useState<Array<SeedBook | null>>([]);
  const [starting, setStarting] = useState(false);
  const [randomFilling, setRandomFilling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  // A tournament is now created without a name ("Untitled tournament",
  // see ArenaListPage's "+" tile), so this page has to be able to give
  // it one — it's where you land straight after creating. Name is the
  // only editable field: bracket size lays out the slots below and
  // round length is stamped onto duel deadlines once started, so
  // neither can change (see api/arena.ts's renameTournament).
  async function handleRename() {
    const name = nameDraft.trim();
    setEditingName(false);
    if (!tournament || !name || name === tournament.name) return;
    try {
      await renameTournament(tournament.id, name);
      await refetch();
    } catch {
      setActionError("Couldn't save that name.");
    }
  }

  useEffect(() => {
    if (!tournament) return;
    // Seed local slot state from whatever's already saved (e.g. reopening
    // this page after a partial manual seed, or right after a server-side
    // random fill).
    const bySlotIndex = new Map(tournament.slots.map((s) => [s.slotIndex, s]));
    setSlots(Array.from({ length: tournament.bracketSize }, (_, i) => bySlotIndex.get(i) ?? null));
  }, [tournament]);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl px-5 py-8">
        <p className="text-sm text-(--color-text-dim)">Loading…</p>
      </div>
    );
  }
  if (!tournament) return <Navigate to="/dashboard/arena" replace />;
  if (tournament.ownerUserId !== session?.user.id) return <Navigate to="/dashboard/arena" replace />;
  if (tournament.status !== "seeding") return <Navigate to={`/arena/${tournament.id}`} replace />;

  const filledCount = slots.filter(Boolean).length;
  const canStart = filledCount === tournament.bracketSize;

  async function handleStart() {
    setStarting(true);
    setActionError(null);
    try {
      const filled = slots.filter((s): s is SeedBook => s !== null);
      await setTournamentSlots(
        tournament!.id,
        filled.map((book, i) => ({ slotIndex: i, book }))
      );
      await startTournament(tournament!.id);
      navigate(`/arena/${tournament!.id}`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't start the tournament.");
    } finally {
      setStarting(false);
    }
  }

  async function handleSaveProgress() {
    setActionError(null);
    try {
      await setTournamentSlots(
        tournament!.id,
        slots.filter((s): s is SeedBook => s !== null).map((book, i) => ({ slotIndex: i, book }))
      );
      await refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't save your progress.");
    }
  }

  async function handleRandomFill() {
    setRandomFilling(true);
    setActionError(null);
    try {
      const books = ((library?.data as { books?: Array<Record<string, unknown>> } | undefined)?.books ?? []) as Array<Record<string, unknown>>;
      const pool = await Promise.all(books.map((book) => toSeedBook(book)));
      await randomFillTournament(tournament!.id, pool);
      await refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't random-fill the bracket.");
    } finally {
      setRandomFilling(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
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
          placeholder="Name this tournament…"
          aria-label="Tournament name"
          className="mb-6 w-full max-w-md rounded-lg border border-(--color-border) bg-(--color-surface) px-2 py-1 text-lg font-bold"
        />
      ) : (
        <button
          onClick={() => {
            setNameDraft(tournament.name);
            setEditingName(true);
          }}
          title="Rename this tournament"
          className="mb-6 block max-w-full truncate text-left text-lg font-bold transition-colors hover:text-(--color-accent)"
        >
          Seed &quot;{tournament.name}&quot;
        </button>
      )}
      {actionError && <p className="mb-4 text-sm text-(--color-danger)">{actionError}</p>}

      <SeedSlotGrid
        bracketSize={tournament.bracketSize}
        slots={slots}
        onChange={setSlots}
        onRandomFill={() => void handleRandomFill()}
      />
      {randomFilling && <p className="mt-2 text-sm text-(--color-text-dim)">Filling…</p>}

      <div className="mt-6 flex items-center justify-between">
        <button onClick={() => void handleSaveProgress()} className="rounded-lg border border-(--color-border) px-3 py-1.5 text-sm">
          Save progress
        </button>
        <button
          onClick={() => void handleStart()}
          disabled={!canStart || starting}
          className="rounded-lg bg-(--color-accent) px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {starting ? "Starting…" : "Start tournament"}
        </button>
      </div>
    </div>
  );
}
