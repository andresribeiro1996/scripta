// "My tournaments" — list + a "+" tile. Same list/detail split as
// MuralsListPage.tsx → MuralEditorPage.tsx: this page only creates and
// lists; seeding happens on ArenaSeedPage.tsx once a tournament exists.

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { renameTournament } from "../api/arena";
import { TournamentStatusBadge } from "../components/arena/TournamentStatusBadge";
import { GearIcon, PlusIcon, TOOLBAR_CONTROL_CLASS, ToolbarRow } from "../components/Toolbar";
import { useMyTournaments } from "../hooks/useMyTournaments";

export function ArenaListPage() {
  const { tournaments, isLoading, refetch } = useMyTournaments();
  const navigate = useNavigate();
  const [createError, setCreateError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");

  // A tournament is created as "Untitled tournament" (see the "+" tile),
  // and the seed page — the only other place a name could be edited —
  // stops being reachable the moment the tournament starts. Without this
  // an active or finished tournament would be stuck with its placeholder
  // forever, which is exactly the gap the rename endpoint exists to
  // close. Allowed at any status for that reason.
  async function handleRename(t: { id: string; name: string }) {
    const name = nameDraft.trim();
    setRenamingId(null);
    if (!name || name === t.name) return;
    try {
      await renameTournament(t.id, name);
      await refetch();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Couldn't save that name.");
    }
  }

  const visibleTournaments = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return tournaments;
    return tournaments.filter((t) => t.name.toLowerCase().includes(needle));
  }, [tournaments, search]);

  // Opens an UNSAVED tournament rather than POSTing one. Creating on
  // click left an "Untitled tournament" behind on every idle tap, and
  // silently fixed its bracket size at 16 — which cannot be changed
  // afterwards. The seed page now creates it on the first real change,
  // and offers the size picker until then.
  function handleCreate() {
    navigate("/dashboard/arena/new/seed");
  }

  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      {/* Desktop-only title, like the other list pages — the bottom tab
          bar already says where you are, and the search row below is
          what a phone actually needs at the top. */}
      <h2 className="mb-6 hidden text-lg font-bold sm:block">Arena</h2>
      <p className="mb-4 text-sm text-(--color-text-dim)">
        Bracket tournaments from your library —{" "}
        <a href="/arena" className="text-(--color-accent) underline">
          browse public tournaments
        </a>
        .
      </p>

      {tournaments.length > 0 && (
        <ToolbarRow>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search"
            aria-label="Search tournaments by name"
            className={`${TOOLBAR_CONTROL_CLASS} w-full sm:max-w-xs`}
          />
        </ToolbarRow>
      )}

      {createError && <p className="mb-4 text-sm text-(--color-danger)">{createError}</p>}

      {isLoading && <p className="text-sm text-(--color-text-dim)">Loading…</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {/* Always first, always present — deliberately outside the map
            so creating never disappears when the list is empty, the same
            way the mural grid's "+" tile works. Creates on click with
            defaults and goes straight to seeding; the name is editable
            there. */}
        <button
          onClick={handleCreate}
          className="flex min-h-14 items-center justify-center gap-2 rounded-xl border-2 border-dashed border-(--color-border) p-4 text-(--color-text-dim) transition-colors hover:border-(--color-accent) hover:text-(--color-accent) disabled:opacity-60"
        >
          <PlusIcon />
          <span className="text-sm font-semibold">New tournament</span>
        </button>

        {visibleTournaments.map((t) =>
          renamingId === t.id ? (
            // Renaming replaces the card's own contents rather than
            // opening a dialog — the field lands exactly where the name
            // it's replacing was, so there's no jump to a modal and back.
            <div key={t.id} className="rounded-xl border border-(--color-accent) bg-(--color-surface) p-4">
              <input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={() => void handleRename(t)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleRename(t);
                  if (e.key === "Escape") setRenamingId(null);
                }}
                aria-label="Tournament name"
                className="w-full rounded-lg border border-(--color-border) bg-(--color-surface) px-2 py-1 font-semibold"
              />
              <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-(--color-text-dim)">
                {t.bracketSize}-book bracket
                <TournamentStatusBadge status={t.status} round={t.currentRound} />
              </p>
            </div>
          ) : (
            <div
              key={t.id}
              className="relative rounded-xl border border-(--color-border) bg-(--color-surface) hover:border-(--color-accent)"
            >
              {/* The card is still one big link; the gear sits on top of
                  it rather than inside it, because a <button> nested in
                  an <a> is invalid HTML and taps on it would follow the
                  link. pr-12 keeps a long name from running under it. */}
              <a
                href={t.status === "seeding" ? `/dashboard/arena/${t.id}/seed` : `/arena/${t.id}`}
                className="block p-4 pr-12"
              >
                <h3 className="font-semibold">{t.name}</h3>
                <p className="flex flex-wrap items-center gap-1.5 text-sm text-(--color-text-dim)">
                  {t.bracketSize}-book bracket
                  <TournamentStatusBadge status={t.status} round={t.currentRound} />
                </p>
              </a>
              <button
                onClick={() => {
                  setNameDraft(t.name);
                  setRenamingId(t.id);
                }}
                aria-label={`Rename ${t.name}`}
                title="Rename"
                className="absolute top-3 right-3 flex h-9 w-9 items-center justify-center rounded-lg text-(--color-text-dim) hover:bg-(--color-surface-hover) hover:text-(--color-text)"
              >
                <GearIcon />
              </button>
            </div>
          )
        )}
      </div>

      {tournaments.length > 0 && visibleTournaments.length === 0 && (
        <p className="mt-4 text-sm text-(--color-text-dim)">Nothing matches “{search.trim()}”.</p>
      )}

    </div>
  );
}
