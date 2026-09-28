import { useState } from "react";
import { BOOKS, coverSrc, type BookSlug } from "./books";

const TIERS = [
  { id: "S", color: "#c9482f" },
  { id: "A", color: "#d98a3d" },
  { id: "B", color: "#c9a53d" },
  { id: "C", color: "#5c9e5c" },
  { id: "D", color: "#4a7fc9" },
] as const;

const START: Record<string, BookSlug[]> = {
  S: ["gilead", "stoner"],
  A: ["piranesi"],
  B: ["normal-people"],
  C: [],
  D: [],
};

const POOL: BookSlug[] = ["circe", "hail-mary", "remains", "sapiens", "the-road"];

export function TierListDemo() {
  const [tiers, setTiers] = useState(START);
  const [tierIdx, setTierIdx] = useState(0);
  const [lastDrop, setLastDrop] = useState<BookSlug | null>(null);
  const [voting, setVoting] = useState(false);

  const tierPlaying = tierIdx < POOL.length;
  const pool = POOL.slice(tierIdx);

  function place(tierId: string) {
    if (!tierPlaying) return;
    const slug = POOL[tierIdx];
    setTiers((prev) => ({ ...prev, [tierId]: [...prev[tierId], slug] }));
    setTierIdx((i) => i + 1);
    setLastDrop(slug);
  }

  function resetTiers() {
    setTiers(START);
    setTierIdx(0);
    setLastDrop(null);
    setVoting(false);
  }

  return (
    <div className="flex flex-col rounded-2xl border border-(--color-border) bg-(--color-bg) p-4 lg:p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="text-base font-semibold">Tier list</span>
          {voting && (
            <span className="inline-flex h-6 items-center rounded-full border border-(--color-info) bg-(--color-info-soft) px-2.5 text-xs font-semibold text-(--color-info)">
              Voting open
            </span>
          )}
        </div>
        <span className="hidden text-[13px] text-(--color-text-dim) lg:inline">Made from your library</span>
      </div>

      <div className="mt-5 overflow-hidden rounded-lg">
        {TIERS.map((tier) => {
          const books = tiers[tier.id];
          const label = tierPlaying ? `Rank ${BOOKS[POOL[tierIdx]].title} in ${tier.id}` : `Tier ${tier.id}`;
          return (
            <button
              key={tier.id}
              type="button"
              disabled={!tierPlaying}
              aria-label={label}
              onClick={() => place(tier.id)}
              className="flex h-21 w-full items-center bg-(--color-surface) text-left transition-colors enabled:cursor-pointer enabled:hover:bg-(--color-surface-hover) disabled:cursor-default lg:h-28 focus-visible:-outline-offset-3"
            >
              <span
                className="flex h-full w-[42px] shrink-0 items-center justify-center text-xs font-bold text-white lg:w-12 lg:text-sm"
                style={{ background: tier.color }}
              >
                {tier.id}
              </span>
              <div className="flex h-full min-w-0 flex-1 gap-0.5 overflow-hidden">
                {books.map((slug, i) => (
                  <img
                    key={`${slug}-${i}`}
                    src={coverSrc(slug)}
                    alt={BOOKS[slug].title}
                    className={`h-full w-14 shrink-0 rounded-sm object-cover lg:w-[75px] ${
                      slug === lastDrop ? "motion-safe:[animation:scripta-arena-drop_380ms_cubic-bezier(0.34,1.56,0.64,1)_both]" : ""
                    }`}
                  />
                ))}
                {books.length === 0 && <span className="self-center px-2 text-xs text-(--color-text-dim) lg:px-2.5 lg:text-[13px]">–</span>}
              </div>
            </button>
          );
        })}
      </div>

      {tierPlaying && (
        <>
          <div className="mt-2 flex justify-between text-xs text-(--color-text-dim) lg:mt-2.5">
            <span className="font-bold">Pool · {pool.length}</span>
            <span>Tap a row to rank the first book.</span>
          </div>
          <div className="mt-1 flex h-21 gap-0.5 overflow-x-auto lg:mt-1.5 lg:h-28">
            {pool.map((slug, i) => (
              <img
                key={slug}
                src={coverSrc(slug)}
                alt={BOOKS[slug].title}
                className="h-full w-14 shrink-0 rounded-sm object-cover lg:w-[75px]"
                style={{ border: i === 0 ? "2px solid var(--color-accent)" : "0" }}
              />
            ))}
          </div>
        </>
      )}

      {!tierPlaying && !voting && (
        <div className="mt-4 rounded-xl border border-(--color-border) bg-(--color-surface) p-4 lg:flex lg:h-[118px] lg:items-center lg:gap-5 lg:px-6 lg:py-5">
          <div className="min-w-0 lg:flex-grow">
            <div className="text-[15px] font-semibold leading-tight lg:font-display lg:text-2xl lg:font-normal">Shelf ranked.</div>
            <p className="mt-1 text-[13px] leading-normal text-(--color-text-dim) lg:text-sm">Open voting to see how everyone else would rank it.</p>
          </div>
          <div className="mt-3 flex shrink-0 items-center gap-3 lg:mt-0 lg:gap-2">
            <button
              type="button"
              onClick={() => setVoting(true)}
              className="order-1 flex min-h-11 items-center rounded-lg border border-(--color-border) bg-(--color-surface) px-4 text-sm font-semibold text-(--color-text) transition-colors hover:bg-(--color-surface-hover) lg:order-2"
            >
              Open voting
            </button>
            <button type="button" onClick={resetTiers} className="order-2 flex min-h-11 items-center px-1 text-[13px] text-(--color-text-dim) lg:order-1">
              Start over
            </button>
          </div>
        </div>
      )}

      {voting && (
        <div className="mt-4 rounded-xl border border-(--color-border) bg-(--color-surface) p-4 lg:flex lg:h-[118px] lg:items-center lg:gap-5 lg:px-6 lg:py-5">
          <div className="min-w-0 lg:flex-grow">
            <div className="text-[15px] font-semibold leading-tight lg:font-display lg:text-2xl lg:font-normal">Voting is open.</div>
            <p className="mt-1 text-[13px] leading-normal text-(--color-text-dim) lg:text-sm">
              Anyone you send it to can rank it too. They see the results once they’ve voted.
            </p>
          </div>
          <button type="button" onClick={resetTiers} className="mt-1 flex min-h-11 items-center px-1 text-[13px] text-(--color-text-dim) lg:mt-0 lg:shrink-0">
            Start over
          </button>
        </div>
      )}
    </div>
  );
}
