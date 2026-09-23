import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type TouchEvent } from "react";

const EDGE_ZONE_PX = 24;
const AXIS_LOCK_PX = 8;
const SETTLE_MS = 280;

function ownsHorizontalGesture(target: EventTarget | null, root: HTMLElement): boolean {
  for (let el = target instanceof Element ? target : null; el && el !== root; el = el.parentElement) {
    if (el.classList.contains("mural-overview-stage")) return true;
    const { overflowX } = getComputedStyle(el);
    if ((overflowX === "auto" || overflowX === "scroll") && el.scrollWidth > el.clientWidth) return true;
  }
  return false;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export function SwipeTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  children
}: {
  tabs: readonly { value: T; label: string; count?: number | null }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  children: (value: T) => ReactNode;
}) {
  const index = Math.max(0, tabs.findIndex((tab) => tab.value === value));
  const rootRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ x: number; y: number; width: number; axis: "x" | "y" | null } | null>(null);
  const settleTimer = useRef<number | undefined>(undefined);
  const [drag, setDrag] = useState({ dx: 0, width: 1 });
  const [phase, setPhase] = useState<"idle" | "drag" | "settle">("idle");

  useEffect(() => () => window.clearTimeout(settleTimer.current), []);

  function revealTop() {
    const anchor = anchorRef.current;
    if (anchor && anchor.getBoundingClientRect().top < 0) anchor.scrollIntoView({ block: "start" });
  }

  function settle(next: number) {
    setDrag({ dx: 0, width: 1 });
    if (next !== index) {
      onChange(tabs[next].value);
      revealTop();
    }
    if (prefersReducedMotion()) {
      setPhase("idle");
      return;
    }
    setPhase("settle");
    window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => setPhase("idle"), SETTLE_MS);
  }

  function select(next: number) {
    if (next === index) return;
    if (prefersReducedMotion()) return settle(next);
    setPhase("drag");
    requestAnimationFrame(() => requestAnimationFrame(() => settle(next)));
  }

  function onTouchStart(e: TouchEvent) {
    const touch = e.touches[0];
    const root = rootRef.current;
    if (!root || e.touches.length !== 1 || touch.clientX <= EDGE_ZONE_PX || ownsHorizontalGesture(e.target, root)) {
      gesture.current = null;
      return;
    }
    gesture.current = { x: touch.clientX, y: touch.clientY, width: root.clientWidth || 1, axis: null };
  }

  function onTouchMove(e: TouchEvent) {
    const g = gesture.current;
    if (!g) return;
    const touch = e.touches[0];
    const dx = touch.clientX - g.x;
    const dy = touch.clientY - g.y;
    if (!g.axis) {
      if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return;
      g.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? "x" : "y";
      if (g.axis === "x") {
        window.clearTimeout(settleTimer.current);
        setPhase("drag");
      }
    }
    if (g.axis !== "x") return;
    const atEdge = (index === 0 && dx > 0) || (index === tabs.length - 1 && dx < 0);
    setDrag({ dx: atEdge ? dx / 3 : dx, width: g.width });
  }

  function onTouchEnd() {
    const g = gesture.current;
    gesture.current = null;
    if (g?.axis !== "x") return;
    const threshold = Math.min(80, g.width * 0.2);
    const next = drag.dx < -threshold ? index + 1 : drag.dx > threshold ? index - 1 : index;
    settle(Math.min(tabs.length - 1, Math.max(0, next)));
  }

  const progress = index - (phase === "drag" ? drag.dx / drag.width : 0);
  const moving = phase !== "idle";

  return (
    <div>
      <div ref={anchorRef} />
      <div role="tablist" aria-label={label} className="sticky top-0 z-20 -mx-4 border-b border-(--color-border) bg-(--color-bg)/95 px-4 backdrop-blur sm:mx-0 sm:px-0">
        <div className="relative flex" style={{ "--tabs": tabs.length } as CSSProperties}>
          {tabs.map((tab, i) => (
            <button
              key={tab.value}
              role="tab"
              id={`tab-${tab.value}`}
              aria-selected={i === index}
              aria-controls={`panel-${tab.value}`}
              onClick={() => select(i)}
              className={`flex min-h-12 flex-1 items-center justify-center gap-1.5 text-sm font-semibold transition-colors sm:w-32 sm:flex-none ${
                i === index ? "text-(--color-text)" : "text-(--color-text-dim) hover:text-(--color-text)"
              }`}
            >
              {tab.label}
              {tab.count != null && <span className="text-xs font-medium tabular-nums text-(--color-text-dim)">{tab.count.toLocaleString()}</span>}
            </button>
          ))}
          <span
            aria-hidden
            className={`absolute bottom-0 left-0 h-0.5 w-[calc(100%/var(--tabs))] rounded-full bg-(--color-accent) sm:w-32 ${phase === "drag" ? "" : "transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"}`}
            style={{ transform: `translateX(${progress * 100}%)` }}
          />
        </div>
      </div>
      <div ref={rootRef} className="overflow-hidden touch-pan-y" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}>
        <div
          className={`flex items-start ${phase === "settle" ? "transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]" : ""}`}
          style={moving ? { transform: `translateX(calc(${-index * 100}% + ${phase === "drag" ? drag.dx : 0}px))` } : undefined}
        >
          {tabs.map((tab, i) => {
            const active = i === index;
            return (
              <div
                key={tab.value}
                role="tabpanel"
                id={`panel-${tab.value}`}
                aria-labelledby={`tab-${tab.value}`}
                inert={!active}
                className={`w-full shrink-0 pt-5 ${active ? "" : moving ? "max-h-svh overflow-hidden" : "hidden"}`}
              >
                {children(tab.value)}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

