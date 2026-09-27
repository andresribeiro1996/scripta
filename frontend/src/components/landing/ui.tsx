import type { ReactNode } from "react";

export const container = "mx-auto max-w-6xl px-4 sm:px-6";

export const primaryButton =
  "flex min-h-12 items-center justify-center rounded-lg bg-(--color-accent) px-6 text-base font-semibold text-(--color-on-accent) transition-opacity hover:opacity-90";

export const secondaryButton =
  "flex min-h-11 items-center justify-center rounded-lg border border-(--color-border) bg-(--color-surface) px-4 text-sm font-semibold transition-colors hover:bg-(--color-surface-hover)";

export const textLink =
  "flex min-h-11 items-center justify-center font-semibold text-(--color-text) underline decoration-(--color-accent) decoration-2 underline-offset-4 transition-[text-decoration-thickness] hover:decoration-4";

export function SectionIntro({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="max-w-2xl">
      <h2 className="font-display text-3xl leading-tight text-balance sm:text-[2.5rem]">{title}</h2>
      {children && <p className="mt-4 text-pretty text-lg leading-relaxed text-(--color-text-dim)">{children}</p>}
    </div>
  );
}
