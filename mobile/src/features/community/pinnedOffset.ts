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

export function syncedOffset(activeY: number, ownY: number, heroHeight: number): number {
  "worklet";
  return activeY < heroHeight ? activeY : Math.max(ownY, heroHeight);
}

export function dragX(startX: number, dx: number, count: number, width: number): number {
  "worklet";
  const x = startX - dx;
  const last = (count - 1) * width;
  if (x < 0) return rubberBand(x, true);
  if (x > last) return last + rubberBand(x - last, true);
  return x;
}

const SETTLE_MIN = 150;
const SETTLE_MAX = 300;

export function settleDuration(distance: number, velocity: number): number {
  "worklet";
  const speed = Math.abs(velocity);
  return speed ? Math.min(Math.max((3 * distance * 1000) / speed, SETTLE_MIN), SETTLE_MAX) : SETTLE_MAX;
}
