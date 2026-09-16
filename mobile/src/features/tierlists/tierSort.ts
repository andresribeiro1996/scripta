/** The angle a tier's target sits at, clockwise from straight up. */
export function angleFor(index: number, count: number) {
  return (index * Math.PI * 2) / count;
}

/** Which of `count` targets a drag points at, by the same angles angleFor
 *  places them at — so the target that lights up mid-drag is the one the
 *  release commits to. Carries the directive because it runs on the UI
 *  thread inside the pan gesture. */
export function sectorFor(dx: number, dy: number, count: number) {
  "worklet";
  const full = Math.PI * 2;
  const angle = (Math.atan2(dx, -dy) + full) % full;
  return Math.round(angle / (full / count)) % count;
}
