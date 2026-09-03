// "My tournaments" — list + a "+" tile. Same list/detail split as
// MuralsListPage.tsx → MuralEditorPage.tsx: this page only creates and
// lists; seeding happens on ArenaSeedPage.tsx once a tournament exists.

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createTournament } from "../api/arena";
import { PlusIcon } from "../components/Toolbar";
import { useMyTournaments } from "../hooks/useMyTournaments";

// Defaults for a tournament created from the "+" tile. Both were the
// create form's own defaults before that form went away — 16 books is a
// bracket most libraries can actually fill, and a day per round suits a
// tournament people vote in over time rather than in one sitting.
const DEFAULT_NAME = "Untitled tournament";
const DEFAULT_BRACKET_SIZE = 16;
const DEFAULT_ROUND_HOURS = 24;

export function ArenaListPage() {
  const { tournaments, isLoading } = useMyTournaments();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

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
      <h2 className="mb-6 text-lg font-bold">Arena</h2>
      <p className="mb-4 text-sm text-(--color-text-dim)">
        Bracket tournaments from your library —{" "}
        <a href="/arena" className="text-(--color-accent) underline">
          browse public tournaments
        </a>
        .
      </p>

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

        {tournaments.map((t) => (
          <a
            key={t.id}
            href={t.status === "seeding" ? `/dashboard/arena/${t.id}/seed` : `/arena/${t.id}`}
            className="rounded-xl border border-(--color-border) bg-(--color-surface) p-4 hover:border-(--color-accent)"
          >
            <h3 className="font-semibold">{t.name}</h3>
            <p className="text-sm text-(--color-text-dim)">
              {t.bracketSize}-book bracket · {t.status}
            </p>
          </a>
        ))}
      </div>

    </div>
  );
}
