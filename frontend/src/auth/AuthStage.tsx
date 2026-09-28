import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { BrandLockup } from "../components/BrandLockup";

export function AuthStage({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center bg-(--color-surface) px-4 py-8 text-(--color-text) sm:justify-center sm:bg-(--color-bg) sm:py-16">
      <Link to="/" aria-label="Atmyshelf home" className="mb-8 flex min-h-11 items-center sm:mb-10">
        <BrandLockup />
      </Link>
      <main className="w-full max-w-[400px]">{children}</main>
      <Link to="/privacy" className="mt-6 flex min-h-11 items-center text-xs text-(--color-text-dim) transition-colors hover:text-(--color-text)">
        Privacy
      </Link>
    </div>
  );
}

export function AuthCard({ children }: { children: ReactNode }) {
  return <div className="sm:rounded-xl sm:border sm:border-(--color-border) sm:bg-(--color-surface) sm:p-8">{children}</div>;
}

export function AuthHeading({ title, subtitle }: { title: string; subtitle?: ReactNode }) {
  return (
    <div className="mb-7">
      <h1 className="font-display text-3xl leading-tight">{title}</h1>
      {subtitle && <p className="mt-2 text-sm leading-relaxed text-(--color-text-dim)">{subtitle}</p>}
    </div>
  );
}

const fieldBase = "min-h-11 w-full rounded-lg border bg-(--color-bg) px-3 py-2.5 text-base text-(--color-text)";
export const authFieldClass = `${fieldBase} border-(--color-border)`;
export const authFieldErrorClass = `${fieldBase} border-(--color-danger)`;
export const authLabelClass = "mb-1.5 block text-sm font-semibold";
export const authHintClass = "mt-1.5 text-xs text-(--color-text-dim)";
export const authLinkClass =
  "font-semibold text-(--color-text) underline decoration-(--color-accent) underline-offset-4 hover:decoration-2";
export const authSubmitClass =
  "flex min-h-11 w-full items-center justify-center rounded-lg bg-(--color-accent) px-4 text-sm font-semibold text-(--color-on-accent) transition-opacity hover:opacity-90 disabled:opacity-55";
export const authSecondaryClass =
  "flex min-h-11 w-full items-center justify-center gap-2.5 rounded-lg border border-(--color-border) bg-(--color-surface) px-4 text-sm font-semibold text-(--color-text) transition-colors hover:bg-(--color-surface-hover) disabled:opacity-55";

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
