// "My tournaments" — list + a "+" tile. Same list/detail split as
// MuralsListPage.tsx → MuralEditorPage.tsx: this page only creates and
// lists; seeding happens on ArenaSeedPage.tsx once a tournament exists.

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createTournament, renameTournament } from "../api/arena";
import { GearIcon, PlusIcon, TOOLBAR_CONTROL_CLASS, ToolbarRow } from "../components/Toolbar";
import { useMyTournaments } from "../hooks/useMyTournaments";

// Defaults for a tournament created from the "+" tile. Both were the
// create form's own defaults before that form went away — 16 books is a
// bracket most libraries can actually fill, and a day per round suits a
// tournament people vote in over time rather than in one sitting.
const DEFAULT_NAME = "Untitled tournament";
const DEFAULT_BRACKET_SIZE = 16;
const DEFAULT_ROUND_HOURS = 24;

export function ArenaListPage() {
  const { tournaments, isLoading, refetch } = useMyTournaments();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
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

  async function handleCreate() {
    if (creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      // No settings dialog: the "+" tile creates on click, like a new
      // mural. The two things that genuinely can't change later
      // (bracketSize lays out the slots and duels; roundDurationMinutes
      // is stamped onto live duel deadlines) take their previous form
      // defaults, and getting them wrong costs a delete and one more
      // click — nothing has been seeded yet at this point, which is
      // exactly why this is a safe moment to default them.
      const created = await createTournament({
        name: DEFAULT_NAME,
        bracketSize: DEFAULT_BRACKET_SIZE,
        roundDurationMinutes: DEFAULT_ROUND_HOURS * 60
      });
      // Straight to seeding, same as a new mural opens itself: an empty
      // bracket sitting in a list isn't useful, and the seed page is
      // where the name can be edited too.
      navigate(`/dashboard/arena/${created.id}/seed`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Couldn't create that tournament.");
    } finally {
      setCreating(false);
    }
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
          onClick={() => void handleCreate()}
          disabled={creating}
          className="flex min-h-14 items-center justify-center gap-2 rounded-xl border-2 border-dashed border-(--color-border) p-4 text-(--color-text-dim) transition-colors hover:border-(--color-accent) hover:text-(--color-accent) disabled:opacity-60"
        >
          <PlusIcon />
          <span className="text-sm font-semibold">{creating ? "Creating…" : "New tournament"}</span>
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
              <p className="mt-1 text-sm text-(--color-text-dim)">
                {t.bracketSize}-book bracket · {t.status}
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
                <p className="text-sm text-(--color-text-dim)">
                  {t.bracketSize}-book bracket · {t.status}
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
