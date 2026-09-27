import { useEffect, useRef, useState } from "react";
import { BOOKS, coverSrc, type BookSlug } from "./books";

const CHAT = [
  { who: "Maya", text: "Piranesi, obviously.", vote: "a", color: "#c9482f" },
  { who: "Leo", text: "Hail Mary. No contest.", vote: "b", color: "#4a7fc9" },
  { who: "Ines", text: "Voted. Gilead better make the final.", vote: "a", color: "#5c9e5c" },
  { who: "Sam", text: "How is Stoner not in this?", vote: "a", color: "#d98a3d" },
] as const;

const LATE = [
  { id: "A", vote: "a", color: "#8a6bb8" },
  { id: "J", vote: "b", color: "#b08a2e" },
  { id: "K", vote: "a", color: "#3f8f8a" },
] as const;

const MOSAIC: BookSlug[] = ["piranesi", "hail-mary", "circe", "gilead"];

const popAnim = "motion-safe:[animation:scripta-arena-pop_320ms_cubic-bezier(0.32,0.72,0,1)_both]";

export function VoteShowcase() {
  const [share, setShare] = useState(5);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => () => clearInterval(timer.current), []);

  function replay() {
    clearInterval(timer.current);
    setShare(0);
    timer.current = setInterval(() => {
      setShare((s) => {
        const next = s + 1;
        if (next >= 5) clearInterval(timer.current);
        return next;
      });
    }, 900);
  }

  const chat = CHAT.slice(0, Math.min(share, 4));
  const heard = chat
    .map((m): { id: string; vote: string; color: string } => ({ id: m.who[0], vote: m.vote, color: m.color }))
    .concat(share >= 5 ? LATE : []);
  const va = heard.filter((v) => v.vote === "a").length;
  const total = heard.length;

  function tallyRow(slug: BookSlug, count: number, color: string) {
    const pct = total ? Math.round((count / total) * 100) : 0;
    return {
      slug,
      title: BOOKS[slug].title,
      color,
      width: pct,
      pct: total ? `${pct}%` : "–",
      votes: `${count} ${count === 1 ? "vote" : "votes"}`,
    };
  }

  const tally = [tallyRow("piranesi", va, "var(--color-accent)"), tallyRow("hail-mary", total - va, "var(--color-text-dim)")];
  const voterLine = total ? `${total} ${total === 1 ? "friend has" : "friends have"} voted` : "Waiting for votes";
  const replayLabel = share < 5 ? "Votes coming in…" : "Watch it again";

  const replayButtonCls =
    "flex min-h-11 items-center justify-center rounded-lg border border-(--color-border) bg-(--color-surface) px-4 text-sm font-semibold text-(--color-text) transition-colors hover:bg-(--color-surface-hover)";

  return (
    <div className="mt-4 rounded-2xl border border-(--color-border) bg-(--color-bg) p-4 lg:mt-8 lg:grid lg:grid-cols-2 lg:gap-8 lg:p-8 xl:grid-cols-[320px_1fr_1fr]">
      <div className="flex flex-col lg:col-span-2 xl:col-span-1">
        <h3 className="font-display text-[26px] leading-tight lg:text-[2rem]">
          Send it.
          <br className="hidden xl:block" /> Let them argue.
        </h3>
        <p className="mt-2.5 text-[15px] leading-relaxed text-(--color-text-dim) lg:mt-3.5 lg:text-base lg:leading-[1.65]">
          Every tournament and tier list gets its own link. Friends open it in any browser and vote without signing up, and the results fill in as they do.
        </p>
        <button type="button" onClick={replay} className={`${replayButtonCls} mt-4 hidden w-fit lg:flex xl:mt-auto`}>
          {replayLabel}
        </button>
      </div>

      <div className="mt-4 flex flex-col gap-2 rounded-xl border border-(--color-border) bg-(--color-surface) p-3.5 lg:mt-0 lg:gap-2.5 lg:p-5">
        <div className="max-w-[230px] self-end rounded-[16px_16px_4px_16px] bg-(--color-accent) px-3.5 py-2.5 text-sm leading-snug text-(--color-on-accent) lg:max-w-[250px]">
          Settle this for me. Book of the year?
        </div>
        <div className="box-border flex w-[230px] items-center gap-3 self-end rounded-xl border border-(--color-border) bg-(--color-bg) p-2.5 lg:w-[250px]">
          <div className="grid shrink-0 grid-cols-2 gap-0.5">
            {MOSAIC.map((slug) => (
              <img key={slug} src={coverSrc(slug)} alt="" className="block h-[39px] w-[26px] rounded-sm object-cover" />
            ))}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold">Book of the year</div>
            <div className="mt-0.5 text-xs text-(--color-text-dim)">Tournament · 8 books</div>
            <div className="mt-1.5 text-xs font-semibold text-(--color-accent)">Vote on Atmyshelf</div>
          </div>
        </div>
        {CHAT.map((m, i) => (
          <div key={m.who} className={`max-w-[260px] self-start ${i < chat.length ? popAnim : "invisible"}`}>
            <div className="ml-1 text-[11px] font-semibold text-(--color-text-dim)">{m.who}</div>
            <div className="mt-0.5 rounded-[16px_16px_16px_4px] border border-(--color-border) bg-(--color-bg) px-[13px] py-[9px] text-sm leading-snug">
              {m.text}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-col rounded-xl border border-(--color-border) bg-(--color-surface) p-3.5 lg:mt-0 lg:p-5">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">Semifinal 1</span>
          <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-(--color-accent-soft) px-2.5 text-xs font-semibold text-(--color-accent)">
            <span className="h-1.5 w-1.5 rounded-full bg-(--color-accent) motion-safe:animate-pulse" />
            Live
          </span>
        </div>
        {tally.map((row) => (
          <div key={row.slug} className="mt-3.5 flex items-center gap-3 lg:mt-4">
            <img src={coverSrc(row.slug)} alt="" className="block h-[60px] w-10 shrink-0 rounded-[3px] object-cover" />
            <div className="min-w-0 flex-grow">
              <div className="flex justify-between text-sm">
                <span className="font-semibold">{row.title}</span>
                <span className="font-semibold">{row.pct}</span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-(--color-border)">
                <div className="h-2 rounded-full transition-[width] duration-300 ease-out" style={{ background: row.color, width: `${row.width}%` }} />
              </div>
              <div className="mt-1 text-xs text-(--color-text-dim)">{row.votes}</div>
            </div>
          </div>
        ))}
        <div className="mt-3.5 flex items-center gap-2.5 lg:mt-4">
          <div className="flex h-7">
            {heard.map((v, i) => (
              <span
                key={`${v.id}-${i}`}
                className={`box-border -mr-1.5 flex h-7 w-7 items-center justify-center rounded-full border-2 border-(--color-surface) text-[11px] font-bold text-white ${popAnim}`}
                style={{ background: v.color }}
              >
                {v.id}
              </span>
            ))}
          </div>
          <span className="ml-1.5 text-xs text-(--color-text-dim)">{voterLine}</span>
        </div>
        <div className="mt-auto border-t border-(--color-border) pt-3.5 lg:pt-[18px]">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="font-semibold">Where friends put Circe</span>
            <span className="text-xs text-(--color-text-dim)">
              <span className="hidden lg:inline">Tier list · </span>9 votes
            </span>
          </div>
          <div className="mt-2.5 flex h-3 gap-0.5 overflow-hidden rounded-full">
            <span className="w-[22%]" style={{ background: "#c9482f" }} />
            <span className="w-[56%]" style={{ background: "#d98a3d" }} />
            <span className="w-[22%]" style={{ background: "#c9a53d" }} />
          </div>
          <div className="mt-2 flex gap-4 text-xs text-(--color-text-dim)">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm" style={{ background: "#c9482f" }} />S · 2
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm" style={{ background: "#d98a3d" }} />A · 5
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm" style={{ background: "#c9a53d" }} />B · 2
            </span>
          </div>
        </div>
        <button type="button" onClick={replay} className={`${replayButtonCls} mt-3.5 lg:hidden`}>
          {replayLabel}
        </button>
      </div>
    </div>
  );
}
