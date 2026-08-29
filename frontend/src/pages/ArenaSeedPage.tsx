// The seeding step for one tournament: SeedSlotGrid for picking books,
// then "Start" once every slot is filled. Redirects away if the current
// session isn't this tournament's owner, or if it's already started
// (seeding is a one-time step).

import { useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { randomFillTournament, setTournamentSlots, startTournament, type SeedBook } from "../api/arena";
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
      <h2 className="mb-6 text-lg font-bold">Seed &quot;{tournament.name}&quot;</h2>
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
