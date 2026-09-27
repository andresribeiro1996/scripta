import { useRef, useState } from "react";

const books = [
  { src: "piranesi", name: "Piranesi" },
  { src: "hail-mary", name: "Project Hail Mary" },
  { src: "circe", name: "Circe" },
  { src: "sapiens", name: "Sapiens" },
];

const COMMIT_PX = 100;
const VELOCITY_PX_S = 850;
const TRAVEL_PX = 30;
const PILL_PX = 75;

type SlotState = "pending" | "won" | "lost";

function MiniCover({ src, state }: { src: string; state: SlotState }) {
  return (
    <img
      src={`/covers/${src}.jpg`}
      alt=""
      loading="lazy"
      draggable={false}
      className={`h-12 w-8 rounded object-cover ${state === "won" ? "ring-2 ring-(--color-accent)" : state === "lost" ? "opacity-45" : ""}`}
    />
  );
}

function EmptySlot() {
  return <span className="h-12 w-8 rounded border border-dashed border-(--color-border)" />;
}

function BracketSlot({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-(--color-text-dim)">{label}</span>
      {children}
    </div>
  );
}

export function TournamentDemo() {
  const [winners, setWinners] = useState<(typeof books[number] | null)[]>([null, null, null]);
  const [votes, setVotes] = useState<Record<number, [number, number]>>({ 0: [21, 13], 1: [9, 15] });
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [exit, setExit] = useState<"up" | "down" | null>(null);
  const lastSample = useRef<{ y: number; t: number } | null>(null);
  const prevSample = useRef<{ y: number; t: number } | null>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout>>(null);

  const activeIndex = winners.findIndex((w) => w === null);
  const isFinal = activeIndex === 2;
  const champion = winners[2];
  const a = isFinal ? winners[0]! : activeIndex === 1 ? books[2] : books[0];
  const b = isFinal ? winners[1]! : activeIndex === 1 ? books[3] : books[1];
  const roundLabel = champion ? "Champion" : isFinal ? "Final" : `Semifinal ${activeIndex + 1} of 2`;
  const tally = votes[activeIndex === 2 ? 2 : activeIndex === 1 ? 1 : 0] ?? null;
  const stateIn = (round: number, book: (typeof books)[number]): SlotState =>
    winners[round] ? (winners[round] === book ? "won" : "lost") : "pending";

  function decide(winnerSide: "a" | "b") {
    if (exit || activeIndex === -1) return;
    const winner = isFinal ? (winnerSide === "a" ? winners[0]! : winners[1]!) : winnerSide === "a" ? books[activeIndex * 2] : books[activeIndex * 2 + 1];
    setVotes((prev) => {
      const key = isFinal ? 2 : activeIndex;
      const [va, vb] = prev[key] ?? [10, 10];
      return { ...prev, [key]: winnerSide === "a" ? [va + 1, vb] : [va, vb + 1] };
    });
    setWinners((prev) => {
      const next = [...prev];
      next[activeIndex] = winner;
      return next;
    });
    setExit(winnerSide === "a" ? "up" : "down");
    exitTimer.current = setTimeout(() => {
      setExit(null);
      setDrag(null);
    }, 300);
  }

  function reset() {
    if (exitTimer.current) clearTimeout(exitTimer.current);
    setWinners([null, null, null]);
    setVotes({});
    setExit(null);
    setDrag(null);
  }

  function locate(e: React.PointerEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: e.clientX - (rect.left + rect.width / 2), y: e.clientY - (rect.top + rect.height / 2) };
  }

  function onPointerDown(e: React.PointerEvent) {
    if (exit || activeIndex === -1) return;
    if (exitTimer.current) clearTimeout(exitTimer.current);
    e.currentTarget.setPointerCapture(e.pointerId);
    lastSample.current = { y: e.clientY, t: performance.now() };
    prevSample.current = null;
    setDrag(locate(e));
  }

  function onPointerMove(e: React.PointerEvent) {
    if (drag) {
      prevSample.current = lastSample.current;
      lastSample.current = { y: e.clientY, t: performance.now() };
      setDrag(locate(e));
    }
  }

  function onPointerUp() {
    if (!drag) return;
    const flick =
      prevSample.current && lastSample.current
        ? (Math.abs(lastSample.current.y - prevSample.current.y) / Math.max(1, lastSample.current.t - prevSample.current.t)) * 1000
        : 0;
    const travel = Math.abs(drag.y);
    if (drag.y <= -COMMIT_PX || (drag.y < 0 && flick > VELOCITY_PX_S && travel > TRAVEL_PX)) decide("a");
    else if (drag.y >= COMMIT_PX || (drag.y > 0 && flick > VELOCITY_PX_S && travel > TRAVEL_PX)) decide("b");
    else setDrag(null);
  }

  const progress = drag ? Math.min(1, Math.abs(drag.y) / COMMIT_PX) : 0;
  const intent = drag ? (drag.y < 0 ? "up" : "down") : null;
  const showPill = drag ? Math.abs(drag.y) > COMMIT_PX - PILL_PX : false;
  const tint = intent === "up" ? "var(--color-success)" : intent === "down" ? "var(--color-danger)" : "transparent";
  const offset = exit === "up" ? -340 : exit === "down" ? 340 : (drag?.y ?? 0);
  const rotation = progress * 5 * (intent === "up" ? -1 : 1) + (exit ? (exit === "up" ? -4 : 4) : 0);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="flex flex-col rounded-xl border border-(--color-border) bg-(--color-surface) p-5">
        <p className="text-sm font-semibold">Bracket</p>
        <div className="mt-5 flex flex-1 items-stretch">
          <div className="flex flex-1 flex-col justify-around gap-8">
            {[0, 1].map((round) => (
              <BracketSlot key={round} label={`Semifinal ${round + 1}`}>
                <div className="flex items-center gap-2 rounded-lg border border-(--color-border) bg-(--color-bg) px-2 py-1.5">
                  {books.slice(round * 2, round * 2 + 2).map((book) => (
                    <MiniCover key={book.src} src={book.src} state={stateIn(round, book)} />
                  ))}
                </div>
              </BracketSlot>
            ))}
          </div>
          <div className="relative mx-2 w-5 shrink-0">
            <span className="absolute left-0 top-1/4 h-px w-full bg-(--color-border)" />
            <span className="absolute left-0 top-3/4 h-px w-full bg-(--color-border)" />
            <span className="absolute left-0 top-1/4 h-1/2 w-px bg-(--color-border)" />
            <span className="absolute left-0 top-1/2 h-px w-full bg-(--color-border)" />
          </div>
          <div className="flex flex-1 flex-col justify-around gap-8">
            <BracketSlot label="Final">
              <div className="flex items-center gap-2 rounded-lg border border-(--color-border) bg-(--color-bg) px-2 py-1.5">
                {[winners[0], winners[1]].map((book, side) =>
                  book ? <MiniCover key={book.src} src={book.src} state={stateIn(2, book)} /> : <EmptySlot key={side} />
                )}
              </div>
            </BracketSlot>
            <BracketSlot label="Champion">
              <div className="flex items-center gap-2 rounded-lg border border-(--color-border) bg-(--color-bg) px-2 py-1.5">
                {champion ? (
                  <>
                    <MiniCover src={champion.src} state="won" />
                    <span className="text-xs font-semibold">{champion.name}</span>
                  </>
                ) : (
                  <EmptySlot />
                )}
              </div>
            </BracketSlot>
          </div>
        </div>
        {champion && (
          <button type="button" onClick={reset} className="mt-5 min-h-11 w-full rounded-lg border border-(--color-border) bg-(--color-surface) px-3 text-sm font-semibold transition-colors hover:bg-(--color-surface-hover)">
            Run it again
          </button>
        )}
      </div>

      <div className="flex flex-col rounded-xl border border-(--color-border) bg-(--color-surface) p-4">
        <p className="text-center text-sm font-semibold">{roundLabel}</p>
        <div className="relative mt-4 flex flex-1 items-center justify-center py-2">
          {champion ? (
            <div className="flex flex-col items-center gap-3 py-6">
              <img src={`/covers/${champion.src}.jpg`} alt="" className="h-40 w-28 rounded-md object-cover ring-2 ring-(--color-accent)" />
              <span className="rounded-full bg-(--color-success-soft) px-3 py-1 text-sm font-semibold text-(--color-success)">{champion.name} takes it</span>
            </div>
          ) : (
            <div className="relative w-full">
              <div aria-hidden className="absolute inset-x-4 -translate-y-2 scale-[0.96] rounded-xl border border-(--color-border) bg-(--color-bg)" style={{ height: "88%" }} />
              <div
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                role="button"
                aria-label={`Duel: ${a.name} versus ${b.name}. Drag up to pick the first, down for the second.`}
                className="relative w-full cursor-grab touch-none select-none rounded-xl border-2 border-(--color-border) bg-(--color-surface) p-3 active:cursor-grabbing"
                style={{
                  transform: `translateY(${offset}px) rotate(${rotation}deg)`,
                  transition: drag && !exit ? "none" : "transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 300ms",
                  opacity: exit ? 0 : 1,
                }}
              >
                <div className="flex items-stretch justify-center gap-2">
                  {([a, b] as const).map((book, side) => (
                    <div key={side} className="flex flex-1 flex-col items-center gap-1.5 rounded-lg border-2 border-(--color-border) p-2.5">
                      <img src={`/covers/${book.src}.jpg`} alt="" draggable={false} className="h-24 w-16 rounded-md object-cover" />
                      <span className="text-center text-xs font-semibold leading-tight text-(--color-text-dim)">{book.name}</span>
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
          )}
        </div>
        {!champion && (
          <div className="mt-4">
            {tally && (
              <>
                <div className="h-2 rounded-full bg-(--color-border)">
                  <div className="h-2 rounded-full bg-(--color-accent) transition-all duration-300" style={{ width: `${Math.round((tally[0] / (tally[0] + tally[1])) * 100)}%` }} />
                </div>
                <p className="mt-1 text-right text-xs text-(--color-text-dim)">
                  {Math.round((tally[0] / (tally[0] + tally[1])) * 100)}% · {tally[0] + tally[1]} votes
                </p>
              </>
            )}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => decide("a")} className="rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2.5 text-sm font-semibold transition-colors hover:bg-(--color-surface-hover)">
                ↑ {a.name}
              </button>
              <button type="button" onClick={() => decide("b")} className="rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2.5 text-sm font-semibold transition-colors hover:bg-(--color-surface-hover)">
                ↓ {b.name}
              </button>
            </div>
            <p className="mt-3 text-center text-xs text-(--color-text-dim)">Drag up to crown it, down to cut it — winners advance.</p>
          </div>
        )}
      </div>
    </div>
  );
}
