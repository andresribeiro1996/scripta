import { Link } from "react-router-dom";
import { BrandLockup } from "../BrandLockup";
import { container, secondaryButton } from "./ui";

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
        <div className="flex items-center gap-2">
          <a href="/#start" className={secondaryButton}>
            Get notified
          </a>
        </div>
      </div>
    </header>
  );
}
