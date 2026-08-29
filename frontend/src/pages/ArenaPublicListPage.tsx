// Public directory of every tournament — the "also listed" half of
// "tournaments are public: a shareable link, and also listed" (see the
// design spec). No auth, no PageContainer's dashboard chrome (this route
// lives outside DashboardLayout entirely) — just a minimal standalone page.

import { usePublicTournaments } from "../hooks/usePublicTournaments";

export function ArenaPublicListPage() {
  const { tournaments, isLoading } = usePublicTournaments();

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-1 text-xl font-bold">BookArena</h1>
      <p className="mb-6 text-sm text-(--color-text-dim)">Vote in book bracket tournaments — no account needed.</p>

      {isLoading && <p className="text-sm text-(--color-text-dim)">Loading…</p>}
      {!isLoading && tournaments.length === 0 && <p className="text-sm text-(--color-text-dim)">No tournaments yet.</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {tournaments.map((t) => (
          <a key={t.id} href={`/arena/${t.id}`} className="rounded-xl border border-(--color-border) bg-(--color-surface) p-4 hover:border-(--color-accent)">
            <h3 className="font-semibold">{t.name}</h3>
            <p className="text-sm text-(--color-text-dim)">
              {t.bracketSize}-book bracket · {t.status === "completed" ? "Completed" : `Round ${t.currentRound}`}
            </p>
          </a>
        ))}
      </div>
    </div>
  );
}
