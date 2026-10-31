import type { ReactNode } from "react";
import { LandingNav } from "../components/landing/LandingNav";
import { LandingFooter } from "../components/landing/LandingFooter";
import { publicPageBackground, publicPageClass } from "../components/landing/ui";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD_CLASS } from "../components/page/buttonClasses";

export function AuthStage({ children }: { children: ReactNode }) {
  return (
    <div className={`${publicPageClass} [color-scheme:light_dark] max-sm:bg-(--color-surface)!`}>
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 max-sm:hidden" style={publicPageBackground} />
      <LandingNav />
      <main className="mx-auto w-full max-w-[448px] flex-1 px-6 py-8">{children}</main>
      <LandingFooter />
    </div>
  );
}

export function AuthCard({ children }: { children: ReactNode }) {
  return <div className="sm:rounded-xl sm:border sm:border-(--color-border) sm:bg-(--color-surface) sm:p-8">{children}</div>;
}

export function AuthHeading({ title, subtitle }: { title: string; subtitle?: ReactNode }) {
  return (
    <div className="mb-6 text-center">
      <h1 className="font-display text-3xl leading-tight">{title}</h1>
      {subtitle && <p className="mt-2 text-sm text-(--color-text-dim)">{subtitle}</p>}
    </div>
  );
}

export const authFieldClass = `${FIELD_CLASS} w-full bg-(--color-bg)!`;
export const authLabelClass = "mb-1.5 block text-sm font-semibold";
export const authHintClass = "mt-1.5 text-xs text-(--color-text-dim)";
export const authLinkClass = "text-(--color-text) underline decoration-(--color-accent) decoration-2 underline-offset-4 hover:decoration-4";
export const authSubmitClass = `${BUTTON_PRIMARY} w-full`;
export const authSecondaryClass = `${BUTTON_SECONDARY} w-full gap-2.5`;

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
