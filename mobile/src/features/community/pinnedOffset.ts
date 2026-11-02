export function pinnedOffset(scrollY: number, heroHeight: number): number | null {
  return scrollY > heroHeight ? heroHeight : null;
}
