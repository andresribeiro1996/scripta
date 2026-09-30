import type { ThemeId } from "@scripta/shared/themes";

export type Veil = { color: string; key: number };

export function shouldFadeTheme({ fade, reduced, from, to }: { fade: boolean; reduced: boolean; from: ThemeId; to: ThemeId }): boolean {
  return fade && !reduced && from !== to;
}

export function nextVeil(previous: Veil | null, color: string): Veil {
  return { color, key: (previous?.key ?? 0) + 1 };
}
