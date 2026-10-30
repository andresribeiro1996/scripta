const BOX = "inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-sm font-semibold disabled:opacity-50";
const CHIP = "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold";

export const BUTTON_PRIMARY = `${BOX} bg-(--color-accent) text-(--color-on-accent) hover:opacity-90`;
export const BUTTON_SECONDARY = `${BOX} border border-(--color-border) bg-(--color-surface) text-(--color-text) hover:bg-(--color-surface-hover)`;
export const BUTTON_DANGER = `${BOX} bg-(--color-danger) text-(--color-on-danger) hover:opacity-90`;
export const BUTTON_DANGER_OUTLINE = `${BOX} border border-(--color-danger) bg-transparent text-(--color-danger) hover:bg-(--color-danger-soft)`;

export const FIELD_CLASS =
  "min-h-11 rounded-lg border border-(--color-border) bg-(--color-surface) px-3 text-base text-(--color-text) placeholder:text-(--color-text-dim) focus:border-(--color-accent) aria-invalid:border-(--color-danger) disabled:opacity-55";

export function chipClass(selected: boolean): string {
  const state = selected
    ? "border-(--color-text) bg-(--color-text) text-(--color-bg)"
    : "border-(--color-border) bg-(--color-surface) text-(--color-text) hover:bg-(--color-surface-hover)";
  return `${CHIP} ${state}`;
}
