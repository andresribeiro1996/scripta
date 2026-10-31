// The seeding step for one tournament: SeedSlotGrid for picking books,
// then "Start" once every slot is filled. Redirects away if the current
// session isn't this tournament's owner, or if it's already started
// (seeding is a one-time step).

import { booksByWork } from "@scripta/shared";
import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import {
  createTournament,
  randomFillTournament,
  renameTournament,
  setTournamentSlots,
  startTournament,
  type SeedBook
} from "../api/arena";
import { useAuth } from "../auth/AuthContext";
import { SeedSlotGrid } from "../components/arena/SeedSlotGrid";
import { Page } from "../components/page/Page";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, TITLE_FIELD_CLASS } from "../components/page/buttonClasses";
import { useConfirm } from "../components/ConfirmDialog";
import { OptionSheet } from "../components/Sheet";
import { backTo } from "../lib/areas";
import { useArena } from "../hooks/useArena";
import { useLibrary } from "../hooks/useLibrary";
import { createSeededTournament, hasTournamentName, slotPayload, toSeedBook, UNTITLED_TOURNAMENT } from "../lib/arenaSeed";
import { useWorkBooks } from "../hooks/useWorkBooks";

/** Bracket sizes offered for a draft. Powers of two only — the service
 *  rejects anything else, and every round has to halve cleanly down to
 *  one final. */
const BRACKET_SIZES = [4, 8, 16, 32, 64];
const DEFAULT_BRACKET_SIZE = 16;
const DEFAULT_ROUND_HOURS = 24;

export function ArenaSeedPage() {
  const { id } = useParams<{ id: string }>();
  const { session } = useAuth();
  const navigate = useNavigate();
  const confirm = useConfirm();
  // `/dashboard/arena/new/seed` is an UNSAVED tournament. Clicking "New
  // tournament" used to POST one immediately, so an idle tap left an
  // "Untitled tournament" behind — and worse, silently fixed its bracket
  // size at 16, which cannot be changed afterwards. Nothing is created
  // now until the first real change (a name, a seeded book, a random
  // fill), and because nothing exists yet, the size is still a live
  // choice right up to that moment.
  // "new" is a safe sentinel rather than a separate route: tournament
  // ids are UUIDs (randomUUID in the arena service), so none can be
  // called "new". The existing `:id/seed` route matches it unchanged.
  const isDraft = id === "new";
  const { tournament, isLoading, refetch, refresh } = useArena(isDraft ? "" : id!);
  const { data: library } = useLibrary();
  const workBooks = useWorkBooks(library);
  const [slots, setSlots] = useState<Array<SeedBook | null>>([]);
  const [starting, setStarting] = useState(false);
  const [randomFilling, setRandomFilling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [draftName, setDraftName] = useState(UNTITLED_TOURNAMENT);
  const [draftBracketSize, setDraftBracketSize] = useState(DEFAULT_BRACKET_SIZE);
  const [pickingSize, setPickingSize] = useState(false);
  // A ref, not state: two quick actions on a draft must not each see
  // "no tournament yet" and POST their own.
  const creatingRef = useRef(false);

  /** The tournament to act on, creating it first if this is still a
   *  draft. Every action below goes through this, so there is exactly
   *  one place a draft becomes real. */
  async function materialize(name = draftName): Promise<{ id: string; bracketSize: number } | null> {
    if (tournament) return tournament;
    if (!isDraft || creatingRef.current) return null;
    creatingRef.current = true;
    try {
      const { tournament: created, slotsError } = await createSeededTournament(
        { createTournament, setTournamentSlots },
        { name: name.trim() || UNTITLED_TOURNAMENT, bracketSize: draftBracketSize, roundDurationMinutes: DEFAULT_ROUND_HOURS * 60 },
        slots
      );
      // `replace` so Back skips the draft URL rather than opening a
      // second empty draft.
      navigate(`/dashboard/arena/${created.id}/seed`, { replace: true });
      if (slotsError) throw new Error("The tournament was created, but your picks didn't save. Pick them again and save.");
      return created;
    } finally {
      creatingRef.current = false;
    }
  }

  // A tournament is now created without a name ("Untitled tournament",
  // see ArenaListPage's "+" tile), so this page has to be able to give
  // it one — it's where you land straight after creating. Name is the
  // only editable field: bracket size lays out the slots below and
  // round length is stamped onto duel deadlines once started, so
  // neither can change (see api/arena.ts's renameTournament).
  async function handleRename() {
    const name = nameDraft.trim();
    setEditingName(false);
    if (!name) return;
    setActionError(null);
    if (isDraft) {
      // Naming a draft IS its first real change, so it creates the
      // tournament with that name rather than making an "Untitled" one
      // and immediately renaming it.
      setDraftName(name);
      try {
        await materialize(name);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Couldn't create that tournament.");
      }
      return;
    }
    if (!tournament || name === tournament.name) return;
    try {
      await renameTournament(tournament.id, name);
      await refetch();
    } catch {
      setActionError("Couldn't save that name.");
    }
  }

  useEffect(() => {
    if (!tournament) {
      // A draft's grid comes from the size picker, and resets when it
      // changes — a 32-slot layout must not keep books seeded into
      // positions that no longer exist at 16.
      if (isDraft) setSlots(Array.from({ length: draftBracketSize }, () => null));
      return;
    }
    // Seed local slot state from whatever's already saved (e.g. reopening
    // this page after a partial manual seed, or right after a server-side
    // random fill).
    const bySlotIndex = new Map(tournament.slots.map((s) => [s.slotIndex, s]));
    setSlots(Array.from({ length: tournament.bracketSize }, (_, i) => bySlotIndex.get(i) ?? null));
  }, [tournament, isDraft, draftBracketSize]);

  if (isLoading) {
    return (
      <Page title="Seed tournament" back={backTo("tournament")}>
        <p className="text-sm text-(--color-text-dim)">Loading…</p>
      </Page>
    );
  }
  if (!tournament && !isDraft) return <Navigate to="/dashboard/arena" replace />;
  if (tournament && tournament.ownerUserId !== session?.user.id) return <Navigate to="/dashboard/arena" replace />;
  if (tournament && tournament.status !== "seeding") return <Navigate to={`/arena/${tournament.id}`} replace />;

  const bracketSize = tournament?.bracketSize ?? draftBracketSize;
  const name = tournament?.name ?? draftName;
  const filledCount = slots.filter(Boolean).length;
  const canStart = filledCount === bracketSize;

  function requireName() {
    if (hasTournamentName(name)) return true;
    setActionError("Name this tournament first.");
    setNameDraft("");
    setEditingName(true);
    return false;
  }

  async function handleStart() {
    if (!requireName()) return;
    const confirmed = await confirm({
      title: `Start "${name}"?`,
      body: `The ${bracketSize}-book bracket is fixed once the tournament starts.`,
      confirmLabel: "Start tournament",
      danger: false
    });
    if (!confirmed) return;
    setStarting(true);
    setActionError(null);
    try {
      const target = await materialize();
      if (!target) return;
      await setTournamentSlots(target.id, slotPayload(slots));
      await startTournament(target.id);
      navigate(`/arena/${target.id}`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't start the tournament.");
    } finally {
      setStarting(false);
    }
  }

  async function handleSaveProgress() {
    if (isDraft && !requireName()) return;
    setActionError(null);
    try {
      // Saving seeded books is a real change, so this is where a draft
      // becomes a tournament.
      const target = await materialize();
      if (!target) return;
      await setTournamentSlots(target.id, slotPayload(slots));
      await refresh(target.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't save your progress.");
    }
  }

  async function handleRandomFill() {
    if (isDraft && !requireName()) return;
    setRandomFilling(true);
    setActionError(null);
    try {
      const pool = (await Promise.all([...booksByWork(workBooks).values()].map((book) => toSeedBook(book)))).filter((seed): seed is SeedBook => seed !== null);
      const target = await materialize();
      if (!target) return;
      await randomFillTournament(target.id, pool);
      await refresh(target.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't random-fill the bracket.");
    } finally {
      setRandomFilling(false);
    }
  }

  return (
    <Page
      back={backTo("tournament")}
      subtitle={`${bracketSize}-book bracket`}
      title={editingName ? (
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
          className={TITLE_FIELD_CLASS}
        />
      ) : (
        <button
          onClick={() => {
            setNameDraft(name);
            setEditingName(true);
          }}
          title="Rename this tournament"
          className="flex min-h-11 min-w-0 max-w-full items-center text-left transition-colors hover:text-(--color-accent)"
        >
          <span className="min-w-0 break-words">{name}</span>
        </button>
      )}
      actions={<>
        <button onClick={() => void handleSaveProgress()} className={BUTTON_SECONDARY}>
          Save progress
        </button>
        <button
          onClick={() => void handleStart()}
          disabled={!canStart || starting}
          className={BUTTON_PRIMARY}
        >
          {starting ? "Starting…" : "Start tournament"}
        </button>
      </>}
    >
      {actionError && <p className="mb-4 text-sm text-(--color-danger)">{actionError}</p>}

      <SeedSlotGrid
        bracketSize={bracketSize}
        slots={slots}
        onChange={setSlots}
        onRandomFill={() => void handleRandomFill()}
        // Draft only. Bracket size lays out the slots and duels and
        // there is no endpoint to change it afterwards, so the one
        // moment it can be chosen is before the tournament exists —
        // which is exactly when this control is rendered. The caveat
        // lives in the accessible name rather than as visible text,
        // since the row already carries three things.
        sizeControl={
          isDraft ? (
            // A button opening our own OptionSheet, not a <select>. The
            // native control took its font from the OS — mobile browsers
            // force ~16px on form controls to stop tap-zoom, so it sat
            // noticeably larger than the row around it — and drew its own
            // arrow wherever it liked, which never lined up with the
            // box's padding. It also opened the OS picker, the only
            // place left in the app that did: every other choice
            // (filter, sort, folder, actions, rounds) is a bottom sheet.
            <button
              onClick={() => setPickingSize(true)}
              aria-label={`Bracket size, ${draftBracketSize} books — fixed once the tournament starts`}
              className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg border border-(--color-border) bg-(--color-surface) px-2.5 text-xs hover:bg-(--color-surface-hover)"
            >
              {draftBracketSize} books
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-(--color-text-dim)">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          ) : undefined
        }
      />
      {randomFilling && <p className="mt-2 text-sm text-(--color-text-dim)">Filling…</p>}

      {pickingSize && (
        <OptionSheet
          title="Bracket size"
          // OptionSheet keys on strings; sizes are numbers, so they're
          // converted on the way in and back on the way out.
          options={BRACKET_SIZES.map((size) => ({ value: String(size), label: `${size} books` }))}
          value={String(draftBracketSize)}
          onSelect={(v) => setDraftBracketSize(Number(v))}
          onClose={() => setPickingSize(false)}
        />
      )}
    </Page>
  );
}
