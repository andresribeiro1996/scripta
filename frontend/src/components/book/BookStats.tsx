import { Link } from "react-router-dom";
import type { BookStatsModel } from "@scripta/shared";

const sectionHeading = "mb-3 text-lg font-bold";
const dim = "text-sm text-(--color-text-dim)";

export function StatsTiles({ tiles, to }: { tiles: BookStatsModel["tiles"]; to: string }) {
  if (tiles.length === 0) return null;
  return (
    <Link to={to} className="mt-3 flex flex-wrap gap-2 rounded-xl text-center hover:opacity-90">
      <span className="sr-only">Book stats: </span>
      {tiles.map((tile) => (
        <span key={tile.key} className="min-w-0 grow basis-[4.5rem] rounded-xl border border-(--color-border) bg-(--color-surface) px-2 py-2">
          <span className="block truncate text-xl font-bold">{tile.value}</span>
          <span className="line-clamp-2 block text-xs text-(--color-text-dim)">{tile.caption}</span>
        </span>
      ))}
    </Link>
  );
}

export function StatsSections({ model }: { model: BookStatsModel }) {
  const { ratings, tierBar, tiersEmpty, tournamentRun, tournamentsEmpty } = model;
  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className={sectionHeading}>Ratings</h2>
        {ratings.openLibrary ? <p className={`${dim} mb-3`}>{ratings.openLibrary}</p> : null}
        {ratings.community ? (
          <>
            <p className="text-2xl font-bold">{ratings.community.feeling}</p>
            <p className={dim}>{ratings.community.summary}</p>
            <div className="mt-3 flex h-24 items-end gap-2">
              {ratings.community.columns.map((column) => (
                <span key={column.label} aria-label={`${column.label}: ${column.count}`} className={`min-h-[2px] flex-1 rounded-t ${column.top ? "bg-(--color-accent)" : "bg-(--color-border)"}`} style={{ height: `${Math.round(column.fraction * 100)}%` }} />
              ))}
            </div>
            <div className="mt-1 flex gap-2 text-center text-xs text-(--color-text-dim)">
              {ratings.community.columns.map((column) => (
                <span key={column.label} className="flex-1">{column.label}</span>
              ))}
            </div>
          </>
        ) : null}
        {ratings.empty ? <p className={dim}>{ratings.empty}</p> : null}
      </section>
      <section>
        <h2 className={sectionHeading}>Tier lists</h2>
        {tierBar ? (
          <>
            <p className="text-2xl font-bold">{tierBar.band}</p>
            <div className="relative mt-3 h-2 rounded-full bg-(--color-border)">
              <span className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-(--color-accent)" style={{ left: `${Math.round(tierBar.marker * 100)}%` }} />
            </div>
            <div className="mt-1 flex justify-between text-xs text-(--color-text-dim)">
              <span>Top</span>
              <span>Bottom</span>
            </div>
            <p className={`${dim} mt-2`}>{tierBar.summary}</p>
          </>
        ) : (
          <p className={dim}>{tiersEmpty}</p>
        )}
      </section>
      <section>
        <h2 className={sectionHeading}>Tournaments</h2>
        {tournamentRun ? (
          <>
            {tournamentRun.path.length > 0 ? (
              <ol className="flex flex-wrap items-center gap-1.5 text-sm">
                {tournamentRun.path.map((step) => (
                  <li key={step.label} className="flex items-center gap-1.5">
                    <span className={`rounded-full border px-2.5 py-0.5 ${step.reached ? "border-(--color-accent) bg-(--color-accent-soft) font-semibold text-(--color-accent)" : "border-(--color-border) text-(--color-text-dim)"}`}>{step.label}</span>
                    <span aria-hidden="true" className="text-(--color-text-dim)">→</span>
                  </li>
                ))}
                <li>
                  <span className={`rounded-full border px-2.5 py-0.5 ${tournamentRun.champion ? "border-(--color-accent) bg-(--color-accent-soft)" : "border-(--color-border) opacity-50"}`}>🏆</span>
                </li>
              </ol>
            ) : null}
            <p className={`${dim} mt-2`}>{tournamentRun.summary}</p>
          </>
        ) : (
          <p className={dim}>{tournamentsEmpty}</p>
        )}
      </section>
    </div>
  );
}
