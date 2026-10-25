import { Link } from "react-router-dom";
import type { BookStatsModel } from "@scripta/shared";

const sectionHeading = "mb-3 text-lg font-bold";
const dim = "text-sm text-(--color-text-dim)";

export function StatsTiles({ tiles, to }: { tiles: BookStatsModel["tiles"]; to: string }) {
  if (tiles.length === 0) return null;
  return (
    <Link to={to} className="flex min-h-11 flex-wrap content-center items-center justify-center gap-x-1.5 text-xs text-(--color-text-dim) hover:opacity-90 sm:justify-start">
      <span className="sr-only">Book stats: </span>
      {tiles.map((tile, index) => (
        <span key={tile.key} className="whitespace-nowrap">
          {`${tile.value} ${tile.caption}`}
          <span aria-hidden="true">{index < tiles.length - 1 ? " ·" : " ›"}</span>
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
            <div role="img" aria-label={`Ratings by feeling: ${ratings.community.columns.map((column) => `${column.label} ${column.count}`).join(", ")}`} className="mt-3 flex h-24 items-end gap-2">
              {ratings.community.columns.map((column) => (
                <span key={column.label} className={`min-h-[2px] flex-1 rounded-t ${column.top ? "bg-(--color-accent)" : "bg-(--color-text-dim)/75"}`} style={{ height: `${Math.round(column.fraction * 100)}%` }} />
              ))}
            </div>
            <div aria-hidden="true" className="mt-1 flex gap-2 text-center text-xs text-(--color-text-dim)">
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
            <div aria-hidden="true" className="mt-1 flex justify-between text-xs text-(--color-text-dim)">
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
                    <span className={`rounded-full border px-2.5 py-0.5 ${step.reached ? "border-(--color-accent) bg-(--color-accent-soft) font-semibold text-(--color-accent)" : "border-(--color-border) text-(--color-text-dim)"}`}>
                      {step.label}
                      <span className="sr-only"> {step.reached ? "(reached)" : "(not reached)"}</span>
                    </span>
                    <span aria-hidden="true" className="text-(--color-text-dim)">→</span>
                  </li>
                ))}
                <li>
                  <span className={`rounded-full border px-2.5 py-0.5 ${tournamentRun.champion ? "border-(--color-accent) bg-(--color-accent-soft)" : "border-(--color-border) opacity-50"}`}>
                    <span aria-hidden="true">🏆</span>
                    <span className="sr-only">{tournamentRun.champion ? "Won a title" : "No title"}</span>
                  </span>
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
