import { Link } from "react-router-dom";
import { BrandLockup } from "../BrandLockup";
import { container } from "./ui";

const anchors = [
  ["How it works", "/#how"],
  ["Sharing", "/#sharing"],
  ["Games", "/#games"],
] as const;

export function LandingNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-(--color-border) bg-(--color-bg)">
      <div className={`${container} flex h-16 items-center justify-between gap-4`}>
        <Link to="/" aria-label="Atmyshelf home" className="flex min-h-11 items-center">
          <BrandLockup />
        </Link>
        <nav aria-label="Sections" className="hidden items-center gap-8 text-sm text-(--color-text-dim) lg:flex">
          {anchors.map(([label, href]) => (
            <a key={href} href={href} className="transition-colors hover:text-(--color-text)">
              {label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-1 sm:gap-2">
          <Link to="/login" className="flex min-h-11 items-center px-3 text-sm font-semibold transition-colors hover:text-(--color-text-dim)">
            Sign in
          </Link>
          <Link
            to="/login?mode=signup"
            className="flex min-h-11 items-center rounded-lg border border-(--color-border) bg-(--color-surface) px-4 text-sm font-semibold transition-colors hover:bg-(--color-surface-hover)"
          >
            Create account
          </Link>
        </div>
      </div>
    </header>
  );
}
