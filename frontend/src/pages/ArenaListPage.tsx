// "My tournaments" — list + create form. Same list/detail split as
// MuralsListPage.tsx → MuralEditorPage.tsx: this page only creates and
// lists; seeding happens on ArenaSeedPage.tsx once a tournament exists.

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createTournament } from "../api/arena";
import { useMyTournaments } from "../hooks/useMyTournaments";

const BRACKET_SIZES = [4, 8, 16, 32, 64];

export function ArenaListPage() {
  const { tournaments, isLoading, refetch } = useMyTournaments();
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [bracketSize, setBracketSize] = useState(16);
  const [roundHours, setRoundHours] = useState(24);
  const [creating, setCreating] = useState(false);

  async function handleCreate() {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const tournament = await createTournament({ name: name.trim(), bracketSize, roundDurationMinutes: roundHours * 60 });
      await refetch();
      navigate(`/dashboard/arena/${tournament.id}/seed`);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      <h2 className="mb-6 text-lg font-bold">Arena</h2>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-(--color-text-dim)">
          Bracket tournaments from your library —{" "}
          <a href="/arena" className="text-(--color-accent) underline">
            browse public tournaments
          </a>
          .
        </p>
        <button onClick={() => setShowCreate(true)} className="rounded-lg bg-(--color-accent) px-3 py-1.5 text-sm font-medium text-white">
          New tournament
        </button>
      </div>

      {isLoading && <p className="text-sm text-(--color-text-dim)">Loading…</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
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

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowCreate(false)}>
          <div
            className="w-full max-w-sm rounded-xl border border-(--color-border) bg-(--color-surface) p-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-4 text-sm font-semibold">New tournament</h3>

            <label className="mb-3 block text-sm">
              Name
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-1.5 text-sm"
              />
            </label>

            <label className="mb-3 block text-sm">
              Bracket size
              <select
                value={bracketSize}
                onChange={(e) => setBracketSize(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-1.5 text-sm"
              >
                {BRACKET_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size} books
                  </option>
                ))}
              </select>
            </label>

            <label className="mb-4 block text-sm">
              Round length (hours)
              <input
                type="number"
                min={1}
                value={roundHours}
                onChange={(e) => setRoundHours(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-1.5 text-sm"
              />
            </label>

            <div className="flex justify-end gap-2">
              <button onClick={() => setShowCreate(false)} className="rounded-lg px-3 py-1.5 text-sm text-(--color-text-dim)">
                Cancel
              </button>
              <button
                onClick={() => void handleCreate()}
                disabled={creating || !name.trim()}
                className="rounded-lg bg-(--color-accent) px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {creating ? "Creating…" : "Create & seed"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
