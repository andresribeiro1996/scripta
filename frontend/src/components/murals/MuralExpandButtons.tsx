import type { MuralBlock } from "@scripta/shared";
import type { RefObject } from "react";

export function MuralExpandButtons({ block, canvas, scale = 1, busy, compact, bottomEdge, onToggle }: {
  block: MuralBlock;
  canvas: RefObject<HTMLDivElement | null>;
  scale?: number;
  busy?: boolean;
  compact?: boolean;
  bottomEdge?: () => number;
  onToggle?: (id: string, axis: "w" | "h", bottom: number, top: number) => void;
}) {
  function toggle(axis: "w" | "h") {
    const element = canvas.current;
    if (!element) return;
    let bottom = Math.min(window.innerHeight, bottomEdge?.() ?? Infinity);
    let top = 0;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      if (/auto|scroll|hidden/.test(getComputedStyle(parent).overflowY)) { const rect = parent.getBoundingClientRect(); bottom = Math.min(bottom, rect.bottom); top = Math.max(top, rect.top); }
    }
    const canvasTop = element.getBoundingClientRect().top;
    onToggle?.(block.id, axis, Math.floor(((bottom - canvasTop) / scale - 10) / 38), Math.max(0, Math.ceil(((top - canvasTop) / scale - 10) / 38)));
  }
  return <>
    {(["w", "h"] as const).map((axis) => {
      const active = Boolean(block.expandedFrom?.[axis]);
      const label = active ? axis === "w" ? "Restore width" : "Restore height" : axis === "w" ? "Expand horizontally" : "Expand vertically";
      return <button key={axis} type="button" title={label} aria-label={label} aria-pressed={active} disabled={busy} onClick={(event) => { event.stopPropagation(); toggle(axis); }} className={`flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-lg px-2 text-sm font-semibold disabled:opacity-40 ${active ? "bg-(--color-accent-soft) text-(--color-accent)" : "bg-(--color-surface) text-(--color-text) hover:bg-(--color-surface-hover)"}`}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: axis === "h" ? "rotate(90deg)" : undefined }} aria-hidden="true"><path d="M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4" /></svg>
        {!compact ? axis === "w" ? "Width" : "Height" : null}
      </button>;
    })}
  </>;
}
