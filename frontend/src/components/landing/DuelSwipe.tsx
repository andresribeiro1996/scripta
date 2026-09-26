import { useRef, useState } from "react";

type Matchup = { a: string; b: string; aVotes: number; bVotes: number };

const initial: Matchup[] = [
  { a: "piranesi", b: "hail-mary", aVotes: 21, bVotes: 13 },
  { a: "circe", b: "sapiens", aVotes: 34, bVotes: 29 },
  { a: "achilles", b: "normal-people", aVotes: 9, bVotes: 11 },
  { a: "gilead", b: "circe", aVotes: 15, bVotes: 27 },
];

const COMMIT = 80;
const titles: Record<string, string> = {
  piranesi: "Piranesi",
  "hail-mary": "Project Hail Mary",
  circe: "Circe",
  sapiens: "Sapiens",
  achilles: "The Song of Achilles",
  "normal-people": "Normal People",
  gilead: "Gilead",
};

export function DuelSwipe() {
  const [matchups, setMatchups] = useState(initial);
  const [index, setIndex] = useState(0);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [exit, setExit] = useState<"up" | "down" | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(null);
  const match = matchups[index % matchups.length];
  const total = match.aVotes + match.bVotes;
  const aPct = Math.round((match.aVotes / total) * 100);
  const progress = drag ? Math.min(1, Math.abs(drag.y) / COMMIT) : 0;
  const intent = drag ? (drag.y < 0 ? "up" : "down") : null;
  const showPill = progress > 0.75;

  function vote(side: "a" | "b") {
    if (exit) return;
    setMatchups((prev) => {
      const next = [...prev];
      next[index % next.length] = { ...match, [`${side}Votes`]: match[`${side}Votes`] + 1 };
      return next;
    });
    setExit(side === "a" ? "up" : "down");
    timer.current = setTimeout(() => {
      setIndex((i) => i + 1);
      setExit(null);
      setDrag(null);
    }, 280);
  }

  function locate(e: React.PointerEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: e.clientX - (rect.left + rect.width / 2), y: e.clientY - (rect.top + rect.height / 2) };
  }

  function onPointerDown(e: React.PointerEvent) {
    if (exit) return;
    if (timer.current) clearTimeout(timer.current);
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag(locate(e));
  }

  function onPointerMove(e: React.PointerEvent) {
    if (drag) setDrag(locate(e));
  }

  function onPointerUp() {
    if (!drag) return;
    if (drag.y <= -COMMIT) vote("a");
    else if (drag.y >= COMMIT) vote("b");
    else setDrag(null);
  }

  const tint = intent === "up" ? "var(--color-success)" : intent === "down" ? "var(--color-danger)" : "transparent";
  const offset = exit === "up" ? -320 : exit === "down" ? 320 : (drag?.y ?? 0);
  const rotation = Math.max(-5, Math.min(5, (drag?.x ?? 0) * 0.08)) + (exit ? (exit === "up" ? -4 : 4) : 0);

  return (
    <div className="flex h-full flex-col rounded-xl border border-(--color-border) bg-(--color-surface) p-4">
      <p className="text-center text-xs font-semibold uppercase tracking-[0.14em] text-(--color-text-dim)">The duel — try it</p>
      <div className="relative mt-4 flex flex-1 items-center justify-center py-2">
        <div
          aria-hidden
          className="absolute h-full w-[86%] -translate-y-2 scale-[0.96] rounded-xl border border-(--color-border) bg-(--color-bg)"
        />
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          role="button"
          aria-label={`Duel: ${titles[match.a]} versus ${titles[match.b]}. Drag up to pick the first, down for the second.`}
          className="relative w-full cursor-grab touch-none select-none rounded-xl border-2 border-(--color-border) bg-(--color-surface) p-3 active:cursor-grabbing"
          style={{
            transform: `translateY(${offset}px) rotate(${rotation}deg)`,
            transition: drag && !exit ? "none" : "transform 260ms cubic-bezier(0.32, 0.72, 0, 1), opacity 260ms",
            opacity: exit ? 0 : 1,
          }}
        >
          <div className="flex items-stretch justify-center gap-2">
            {(["a", "b"] as const).map((side) => (
              <div key={side} className="flex flex-1 flex-col items-center gap-1.5 rounded-lg border-2 border-(--color-border) p-2.5">
                <img src={`/covers/${match[side]}.jpg`} alt="" draggable={false} className="h-24 w-16 rounded-md object-cover" />
                <span className="text-center text-[10px] font-semibold leading-tight text-(--color-text-dim)">{titles[match[side]]}</span>
              </div>
            ))}
          </div>
          <div
            className="pointer-events-none absolute inset-0 rounded-[10px]"
            style={{ backgroundColor: tint, opacity: progress * 0.25, transition: drag && !exit ? "none" : "opacity 200ms" }}
          />
          <span
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rounded-full bg-(--color-success) px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white"
            style={{ opacity: intent === "up" && showPill ? 1 : 0 }}
          >
            Wins
          </span>
          <span
            aria-hidden
            className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-(--color-danger) px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white"
            style={{ opacity: intent === "down" && showPill ? 1 : 0 }}
          >
            Loses
          </span>
        </div>
      </div>
      <div className="mt-4">
        <div className="h-2 rounded-full bg-(--color-border)">
          <div className="h-2 rounded-full bg-(--color-accent) transition-all duration-300" style={{ width: `${aPct}%` }} />
        </div>
        <p className="mt-1 text-right text-xs text-(--color-text-dim)">
          {aPct}% · {total} votes
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => vote("a")}
            className="rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2.5 text-sm font-semibold transition-colors hover:bg-(--color-surface-hover)"
          >
            ↑ {titles[match.a]}
          </button>
          <button
            type="button"
            onClick={() => vote("b")}
            className="rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2.5 text-sm font-semibold transition-colors hover:bg-(--color-surface-hover)"
          >
            ↓ {titles[match.b]}
          </button>
        </div>
        <p className="mt-3 text-center text-xs text-(--color-text-dim)">Drag the card up to crown it, down to cut it — or tap.</p>
      </div>
    </div>
  );
}
