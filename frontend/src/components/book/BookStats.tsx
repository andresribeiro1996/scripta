import { Link } from "react-router-dom";
import type { BookStatsModel } from "@scripta/shared";

const sectionHeading = "mb-3 text-lg font-bold";
const dim = "text-sm text-(--color-text-dim)";

export function StatsStrip({ cells, to }: { cells: BookStatsModel["strip"]; to: string }) {
  if (cells.length === 0) return null;
  return (
    <Link to={to} className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] gap-2 rounded-xl border border-(--color-border) bg-(--color-surface) p-3 text-left hover:border-(--color-accent)">
      <span className="sr-only">Book stats: </span>
      {cells.map((cell) => (
        <span key={cell.key} className="min-w-0">
          <span className="block truncate text-sm font-semibold">{cell.value}</span>
          <span className="block truncate text-xs text-(--color-text-dim)">{cell.label}</span>
        </span>
      ))}
    </Link>
  );
}

export function StatsSections({ model }: { model: BookStatsModel }) {
  const { ratings, tiers, tiersEmpty, tournaments, tournamentsEmpty } = model;
  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className={sectionHeading}>Ratings</h2>
        {ratings.openLibrary ? <p className={`${dim} mb-3`}>{ratings.openLibrary}</p> : null}
        {ratings.community ? (
          <>
            <p className="text-2xl font-bold">{ratings.community.feeling}</p>
            <p className={`${dim} mb-3`}>{ratings.community.summary}</p>
            <ul className="flex flex-col gap-2">
              {ratings.community.bars.map((bar) => (
                <li key={bar.label} className="flex items-center gap-3 text-sm">
                  <span className="w-24 shrink-0">{bar.label}</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-(--color-border)">
                    <span className="block h-full bg-(--color-accent)" style={{ width: `${Math.round(bar.fraction * 100)}%` }} />
                  </span>
                  <span className="w-8 shrink-0 text-right text-(--color-text-dim)">{bar.count}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {ratings.empty ? <p className={dim}>{ratings.empty}</p> : null}
      </section>
      <section>
        <h2 className={sectionHeading}>Tier lists</h2>
        {tiers ? (
          <div className="flex items-center gap-4">
            <span className="text-3xl font-bold">{tiers.letter}</span>
            <p className={dim}>{tiers.summary}</p>
          </div>
        ) : (
          <p className={dim}>{tiersEmpty}</p>
        )}
      </section>
      <section>
        <h2 className={sectionHeading}>Tournaments</h2>
        {tournaments ? (
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {tournaments.map((cell) => (
              <div key={cell.label} className="rounded-xl border border-(--color-border) bg-(--color-surface) p-3">
                <dt className="text-xs text-(--color-text-dim)">{cell.label}</dt>
                <dd className="text-lg font-semibold">{cell.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className={dim}>{tournamentsEmpty}</p>
        )}
      </section>
    </div>
  );
}
