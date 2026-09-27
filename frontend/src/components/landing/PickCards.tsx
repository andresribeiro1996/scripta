import { useState } from "react";
import { textLink } from "./ui";
import { BOOKS, coverSrc, type BookSlug } from "./books";

const PAIRS: [BookSlug, BookSlug][] = [
  ["left-hand", "pachinko"],
  ["secret-history", "sweetgrass"],
  ["atonement", "left-hand"],
];

const FAV_PAIR: [BookSlug, string][] = [
  ["stoner", "This one"],
  ["piranesi", "Still Piranesi"],
];

function choiceStyle(picked: number | null, i: number) {
  return {
    opacity: picked !== null && picked !== i ? 0.4 : 1,
    boxShadow: picked === i ? "0 0 0 2px var(--color-accent)" : "none",
    chipBorder: picked === i ? "var(--color-accent)" : "var(--color-border)",
    chipBg: picked === i ? "var(--color-accent-soft)" : "var(--color-surface)",
  };
}

const coverCls =
  "block h-21 w-14 rounded object-cover transition-opacity duration-200 lg:h-[90px] lg:w-[60px] lg:rounded-[5px]";
const pickBtnCls =
  "flex flex-col items-center gap-1.5 border-0 bg-transparent p-0 transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] motion-safe:hover:-translate-y-1 lg:gap-2";
const chipCls = "inline-flex h-6 items-center whitespace-nowrap rounded-full border px-2 text-[11px] font-semibold lg:px-2.5 lg:text-[11.5px]";

export function PickCards() {
  const [pairIdx, setPairIdx] = useState(0);
  const [nextPick, setNextPick] = useState<number | null>(null);
  const [favPick, setFavPick] = useState<number | null>(null);

  const pair = PAIRS[pairIdx];

  function anotherPair() {
    setPairIdx((i) => (i + 1) % PAIRS.length);
    setNextPick(null);
  }

  const favResult =
    favPick === 0 ? "Stoner is your new favourite." : favPick === 1 ? "Piranesi holds its place." : "You just finished Stoner. Does it beat Piranesi?";

  return (
    <div className="mt-4 grid gap-4 lg:mt-8 lg:grid-cols-2 lg:gap-8">
      <div className="flex items-center gap-4 rounded-2xl border border-(--color-border) bg-(--color-bg) p-4 lg:gap-6 lg:px-6 lg:py-5">
        <div className="flex shrink-0 gap-2.5 lg:gap-3">
          {pair.map((slug, i) => {
            const c = choiceStyle(nextPick, i);
            return (
              <button key={slug} type="button" onClick={() => setNextPick(i)} aria-label={`Read ${BOOKS[slug].title} next`} className={pickBtnCls}>
                <img src={coverSrc(slug)} alt="" style={{ opacity: c.opacity, boxShadow: c.boxShadow }} className={coverCls} />
                <span style={{ borderColor: c.chipBorder, background: c.chipBg }} className={chipCls}>
                  {nextPick === i ? "Reading" : "This one"}
                </span>
              </button>
            );
          })}
        </div>
        <div className="min-w-0">
          <div className="text-base font-semibold">Can’t choose?</div>
          <p className="mt-1.5 text-[13px] leading-relaxed text-(--color-text-dim) lg:hidden">Pick one of two from Up next; it becomes what you’re reading.</p>
          <p className="mt-1.5 hidden text-sm leading-relaxed text-(--color-text-dim) lg:block">
            Two books from Up next, side by side. Pick one and it becomes what you’re reading.
          </p>
          <button type="button" onClick={anotherPair} className={`${textLink} mt-1 w-fit text-[13px]`}>
            Another pair
          </button>
        </div>
      </div>

      <div className="flex items-center gap-4 rounded-2xl border border-(--color-border) bg-(--color-bg) p-4 lg:gap-6 lg:px-6 lg:py-5">
        <div className="flex shrink-0 gap-2.5 lg:gap-3">
          {FAV_PAIR.map(([slug, label], i) => {
            const c = choiceStyle(favPick, i);
            return (
              <button
                key={slug}
                type="button"
                onClick={() => setFavPick(i)}
                aria-label={i === 0 ? "Stoner beats Piranesi" : "Piranesi stays your favourite"}
                className={pickBtnCls}
              >
                <img src={coverSrc(slug)} alt="" style={{ opacity: c.opacity, boxShadow: c.boxShadow }} className={coverCls} />
                <span style={{ borderColor: c.chipBorder, background: c.chipBg }} className={chipCls}>
                  {label}
                </span>
              </button>
            );
          })}
        </div>
        <div className="min-w-0">
          <div className="text-base font-semibold">Against your favourite</div>
          <p className="mt-1.5 text-sm leading-relaxed text-(--color-text-dim) hidden lg:block">Each book you finish gets one shot at your all-time favourite.</p>
          <p className="mt-1 text-[13px] leading-normal text-(--color-text-dim) lg:mt-2 lg:font-semibold lg:text-(--color-text)">{favResult}</p>
        </div>
      </div>
    </div>
  );
}
