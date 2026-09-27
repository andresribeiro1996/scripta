import { useRef, useState } from "react";

const TIERS = [
  { id: "S", color: "#c9482f" },
  { id: "A", color: "#d98a3d" },
  { id: "B", color: "#c9a53d" },
  { id: "C", color: "#5c9e5c" },
  { id: "D", color: "#4a7fc9" },
];

const RING_RADIUS = 92;
const CATCH_RADIUS = 76;
const LONG_PRESS_MS = 220;

const pool = ["circe", "hail-mary", "piranesi", "sapiens", "achilles"];

const defaultPlaced: Record<string, string[]> = {
  S: ["normal-people"],
  A: ["gilead"],
  B: [],
  C: [],
  D: [],
};

const targetPosition = (index: number) => {
  const angle = (-90 + index * 72) * (Math.PI / 180);
  return { x: Math.cos(angle) * RING_RADIUS, y: Math.sin(angle) * RING_RADIUS };
};

function buzz(ms: number) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(ms);
}

export function TierSortDemo() {
  const stageRef = useRef<HTMLDivElement>(null);
  const armTimer = useRef<ReturnType<typeof setTimeout>>(null);
  const [placed, setPlaced] = useState<Record<string, string[]>>(defaultPlaced);
  const [poolIndex, setPoolIndex] = useState(0);
  const [armed, setArmed] = useState(false);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [hoverTier, setHoverTier] = useState<string | null>(null);
  const [dropCount, setDropCount] = useState(0);
  const dragging = armed && drag !== null;
  const done = poolIndex >= pool.length;

  function locate(e: React.PointerEvent) {
    const rect = stageRef.current!.getBoundingClientRect();
    return { x: e.clientX - (rect.left + rect.width / 2), y: e.clientY - (rect.top + rect.height / 2) };
  }

  function onPointerDown(e: React.PointerEvent) {
    if (done) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    armTimer.current = setTimeout(() => {
      setArmed(true);
      buzz(10);
    }, LONG_PRESS_MS);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!armed) return;
    const pos = locate(e);
    setDrag(pos);
    let nearest: string | null = null;
    let best = CATCH_RADIUS;
    for (const tier of TIERS) {
      const { x, y } = targetPosition(TIERS.indexOf(tier));
      const dist = Math.hypot(pos.x - x, pos.y - y);
      if (dist < best) {
        best = dist;
        nearest = tier.id;
      }
    }
    if (nearest !== hoverTier && nearest) buzz(5);
    setHoverTier(nearest);
  }

  function onPointerUp() {
    if (armTimer.current) clearTimeout(armTimer.current);
    if (dragging && hoverTier) {
      const src = pool[poolIndex];
      setPlaced((prev) => ({ ...prev, [hoverTier]: [...prev[hoverTier], src] }));
      setPoolIndex((i) => i + 1);
      setDropCount((n) => n + 1);
      buzz(20);
    }
    setArmed(false);
    setDrag(null);
    setHoverTier(null);
  }

  function reset() {
    setPlaced(defaultPlaced);
    setPoolIndex(0);
    setDropCount(0);
  }

  return (
    <div className="grid items-center gap-8 rounded-xl border border-(--color-border) bg-(--color-surface) p-5 sm:p-8 md:grid-cols-2 md:gap-12">
      <div>
        <div
          ref={stageRef}
          aria-label="Interactive tier sort demo — press and hold the book, then drag it into a tier ring"
          className="relative mx-auto h-[300px] w-[300px] rounded-2xl border border-(--color-border) bg-(--color-bg)"
        >
          <span aria-hidden className="absolute left-1/2 top-1/2 h-36 w-36 -translate-x-1/2 -translate-y-1/2 rounded-full border border-(--color-border)" />
          {TIERS.map((tier, index) => {
            const { x, y } = targetPosition(index);
            const hot = hoverTier === tier.id;
            return (
              <span
                key={tier.id}
                className={`absolute flex h-12 w-12 items-center justify-center rounded-full text-sm font-bold text-white transition-all duration-150 ${
                  armed ? "opacity-100" : "opacity-30"
                } ${hot ? "scale-[1.18]" : ""}`}
                style={{ left: `calc(50% + ${x}px - 24px)`, top: `calc(50% + ${y}px - 24px)`, backgroundColor: tier.color, boxShadow: hot ? `0 0 0 3px var(--color-bg), 0 0 0 5px ${tier.color}` : undefined }}
              >
                {tier.id}
              </span>
            );
          })}
          <img
            src={`/covers/${pool[poolIndex % pool.length]}.jpg`}
            alt=""
            draggable={false}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className={`absolute left-1/2 top-1/2 h-28 w-[76px] -translate-x-1/2 -translate-y-1/2 rounded-md object-cover shadow-[0_10px_24px_rgba(0,0,0,0.25)] ${dragging ? "z-10 cursor-grabbing" : done ? "cursor-default opacity-40" : "cursor-grab"}`}
            style={{
              touchAction: "none",
              transform: `translate(calc(-50% + ${drag?.x ?? 0}px), calc(-50% + ${drag?.y ?? 0}px)) rotate(${dragging ? 3 : 0}deg) scale(${armed ? 1.06 : 1})`,
              transition: dragging
                ? "none"
                : "transform 320ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 200ms",
            }}
          />
        </div>
        <p className="mt-4 flex min-h-11 items-center justify-center text-center text-sm text-(--color-text-dim)">
          {done ? (
            <button type="button" onClick={reset} className="rounded-lg border border-(--color-border) bg-(--color-surface) px-4 py-2.5 text-sm font-semibold text-(--color-text) transition-colors hover:bg-(--color-surface-hover)">
              Shelf ranked. Run it again
            </button>
          ) : (
            `Press and hold the book, then drag it to a tier. ${pool.length - poolIndex} left.`
          )}
        </p>
      </div>
      <div className="overflow-hidden rounded-xl border border-(--color-border)">
        {TIERS.map((tier) => (
          <div key={tier.id} className="flex items-center gap-3 border-b border-(--color-border) p-2 last:border-b-0">
            <span className="flex h-7 w-9 shrink-0 items-center justify-center rounded-md text-xs font-bold text-white" style={{ backgroundColor: tier.color }}>
              {tier.id}
            </span>
            <div className="flex flex-1 flex-wrap gap-1.5">
              {placed[tier.id].length === 0 && <span className="text-xs text-(--color-text-dim)">Drag books here</span>}
              {placed[tier.id].map((src, i) => (
                <img
                  key={`${src}-${i}`}
                  src={`/covers/${src}.jpg`}
                  alt=""
                  loading="lazy"
                  className={`${dropCount > 0 && i === placed[tier.id].length - 1 && src === pool[poolIndex - 1] ? "tier-drop " : ""}h-12 w-8 rounded object-cover`}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
