// "My tournaments" — list + a "+" tile. Same list/detail split as
// MuralsListPage.tsx → MuralEditorPage.tsx: this page only creates and
// lists; seeding happens on ArenaSeedPage.tsx once a tournament exists.

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { TournamentStatusBadge } from "../components/arena/TournamentStatusBadge";
import { PlusIcon, TOOLBAR_CONTROL_CLASS, ToolbarRow } from "../components/Toolbar";
import { useMyTournaments } from "../hooks/useMyTournaments";

export function ArenaListPage() {
  const { tournaments, isLoading } = useMyTournaments();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");

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

      {isLoading && <p className="text-sm text-(--color-text-dim)">Loading…</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {/* Always first, always present — deliberately outside the map
            so creating never disappears when the list is empty, the same
            way the mural grid's "+" tile works. Opens an unsaved
            tournament on the seed page, where the name and bracket size
            are editable until the first real change saves it. */}
        <button
          onClick={handleCreate}
          className="flex min-h-14 items-center justify-center gap-2 rounded-xl border-2 border-dashed border-(--color-border) p-4 text-(--color-text-dim) transition-colors hover:border-(--color-accent) hover:text-(--color-accent) disabled:opacity-60"
        >
          <PlusIcon />
          <span className="text-sm font-semibold">New tournament</span>
        </button>

        {visibleTournaments.map((t) => (
          <a
            key={t.id}
            href={t.status === "seeding" ? `/dashboard/arena/${t.id}/seed` : `/arena/${t.id}`}
            className="block rounded-xl border border-(--color-border) bg-(--color-surface) p-4 hover:border-(--color-accent)"
          >
            <h3 className="font-semibold">{t.name}</h3>
            <p className="flex flex-wrap items-center gap-1.5 text-sm text-(--color-text-dim)">
              {t.bracketSize}-book bracket
              <TournamentStatusBadge status={t.status} round={t.currentRound} />
            </p>
          </a>
        ))}
      </div>

      {tournaments.length > 0 && visibleTournaments.length === 0 && (
        <p className="mt-4 text-sm text-(--color-text-dim)">Nothing matches “{search.trim()}”.</p>
      )}

    </div>
  );
}
