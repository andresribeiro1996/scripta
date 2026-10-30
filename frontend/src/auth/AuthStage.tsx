import type { ReactNode } from "react";
import { LandingNav } from "../components/landing/LandingNav";
import { LandingFooter } from "../components/landing/LandingFooter";
import { publicPageBackground, publicPageClass } from "../components/landing/ui";

export function AuthStage({ children }: { children: ReactNode }) {
  return (
    <div className={`${publicPageClass} [accent-color:var(--color-text)]`}>
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10" style={publicPageBackground} />
      <LandingNav />
      <main className="mx-auto w-full max-w-[400px] flex-1 px-6 py-8">{children}</main>
      <LandingFooter />
    </div>
  );
}

export function AuthCard({ children }: { children: ReactNode }) {
  return <div>{children}</div>;
}

export function AuthHeading({ title, subtitle }: { title: string; subtitle?: ReactNode }) {
  return (
    <div className="mb-7 text-center">
      <h1 className="font-sans text-3xl leading-tight font-extralight tracking-[-0.015em] text-(--color-text)/85">{title}</h1>
      {subtitle && <p className="mt-3 text-sm leading-relaxed text-(--color-text-dim)">{subtitle}</p>}
    </div>
  );
}

const fieldBase = "min-h-13 w-full rounded-xl border bg-(--color-surface)/60 px-4 py-3 text-base text-(--color-text) placeholder:text-(--color-text-dim) focus:outline-none! motion-safe:transition-[border-color,box-shadow,background-color] motion-safe:duration-300 disabled:opacity-55";
export const authFieldClass = `${fieldBase} border-(--color-border) focus:border-(--color-text)/65 focus:bg-(--color-surface)/90 focus:shadow-[0_0_28px_-8px_color-mix(in_srgb,var(--color-text)_25%,transparent)]`;
export const authFieldErrorClass = `${fieldBase} border-(--color-danger) focus:shadow-[0_0_24px_-8px_color-mix(in_srgb,var(--color-danger)_30%,transparent)]`;
export const authLabelClass = "mb-2 block text-sm font-normal text-(--color-text-dim)";
export const authHintClass = "mt-2 text-xs leading-relaxed text-(--color-text-dim)";
export const authLinkClass =
  "font-normal text-(--color-text) underline decoration-(--color-text)/35 underline-offset-4 transition-opacity hover:opacity-75";
export const authSubmitClass =
  "flex min-h-13 w-full items-center justify-center rounded-full bg-(--color-text) px-4 text-sm font-medium text-(--color-bg) shadow-[0_0_28px_-8px_color-mix(in_srgb,var(--color-text)_15%,transparent)] motion-safe:transition-opacity hover:opacity-85 disabled:opacity-55";
export const authSecondaryClass =
  "flex min-h-13 w-full items-center justify-center gap-2.5 rounded-full border border-(--color-border) bg-(--color-surface)/40 px-4 text-sm font-medium text-(--color-text) motion-safe:transition-colors hover:bg-(--color-surface)/90 disabled:opacity-55";

export function AuthFieldError({ id, message }: { id: string; message: string | null | undefined }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1.5 text-xs text-(--color-danger)">
      {message}
    </p>
  );
}

export function AuthServerError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="mb-5 rounded-lg bg-(--color-danger-soft) px-3 py-2.5 text-sm" role="alert">
      {message}
    </div>
  );
}
