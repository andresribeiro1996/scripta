export function pinnedOffset(scrollY: number, heroHeight: number): number | null {
  "worklet";
  return scrollY > heroHeight ? heroHeight : null;
}

const SWIPE_DISTANCE = 64;
const SWIPE_VELOCITY = 600;

export function swipeTarget<T>(tabs: readonly T[], value: T, translationX: number, velocityX: number): T | null {
  "worklet";
  const index = tabs.indexOf(value);
  if (index < 0) return null;
  const direction = Math.abs(translationX) >= SWIPE_DISTANCE ? Math.sign(translationX) : Math.abs(velocityX) >= SWIPE_VELOCITY ? Math.sign(velocityX) : 0;
  return direction ? tabs[index - direction] ?? null : null;
}

export function rubberBand(dx: number, atEdge: boolean): number {
  "worklet";
  return atEdge ? dx / 3 : dx;
}
