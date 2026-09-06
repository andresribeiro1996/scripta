// Public directory of every tournament — the "also listed" half of
// "tournaments are public: a shareable link, and also listed" (see the
// design spec). No auth, no PageContainer's dashboard chrome (this route
// lives outside DashboardLayout entirely) — just a minimal standalone page.

import { Link } from "react-router-dom";
import { usePublicTierlists } from "../hooks/usePublicTierlists";
import { TournamentStatusBadge } from "../components/arena/TournamentStatusBadge";
import { EmptyState } from "../components/EmptyState";
import { ArenaIcon } from "../components/NavIcons";
import { SkeletonCardGrid } from "../components/Skeleton";
import { useDelayedShow } from "../hooks/useDelayedShow";
import { usePublicTournaments } from "../hooks/usePublicTournaments";
import { ChevronLeftIcon } from "../components/Toolbar";

export function ArenaPublicListPage() {
  const { tournaments, isLoading } = usePublicTournaments();
  const showSkeleton = useDelayedShow(isLoading);
  const { tierlists } = usePublicTierlists();

  return (
    <div className="mx-auto max-w-3xl p-6">
      <Link to="/dashboard" className="mb-2 inline-flex items-center gap-1 text-xs text-(--color-text-dim) hover:text-(--color-text)">
        <ChevronLeftIcon size={13} />
        Back to app
      </Link>
      <h1 className="mb-1 text-xl font-bold">BookArena</h1>
      <p className="mb-6 text-sm text-(--color-text-dim)">Vote in book bracket tournaments and tier lists — no account needed.</p>

      {showSkeleton && <SkeletonCardGrid count={3} label="Loading tournaments" tileClassName="min-h-[86px]" />}
      {!isLoading && tournaments.length === 0 && (
        <EmptyState
          icon={ArenaIcon}
          title="No tournaments yet."
          body="A tournament is a bracket where friends vote books head-to-head — check back soon."
        />
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {tournaments.map((t) => (
          <a key={t.id} href={`/arena/${t.id}`} className="rounded-xl border border-(--color-border) bg-(--color-surface) p-4 hover:border-(--color-accent)">
            <h3 className="font-semibold">{t.name}</h3>
            <p className="text-sm text-(--color-text-dim)">
              {t.bracketSize}-book bracket <TournamentStatusBadge status={t.status} round={t.currentRound} />
            </p>
          </a>
        ))}
      </div>

      {tierlists.length > 0 && (
        <>
          <h2 className="mt-8 mb-3 text-lg font-bold">Tier lists</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {tierlists.map((t) => (
              <a
                key={t.voteCode}
                href={`/vote/${t.voteCode}`}
                className="rounded-xl border border-(--color-border) bg-(--color-surface) p-4 hover:border-(--color-accent)"
              >
                <h3 className="font-semibold">{t.name}</h3>
                <p className="text-sm text-(--color-text-dim)">
                  {t.poolSize} books · {t.ballotCount} {t.ballotCount === 1 ? "vote" : "votes"}
                  {!t.votingOpen && " · closed"}
                </p>
              </a>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
