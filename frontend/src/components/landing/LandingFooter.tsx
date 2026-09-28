import { Link } from "react-router-dom";
import { BrandLockup } from "../BrandLockup";
import { container } from "./ui";

export function LandingFooter() {
  return (
    <footer className="border-t border-(--color-border)">
      <div className={`${container} py-10`}>
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <BrandLockup />
            <p className="mt-2 text-sm text-(--color-text-dim)">A personal library for everything you read.</p>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-6 text-sm font-semibold">
            <Link to="/privacy" className="flex min-h-11 items-center transition-colors hover:text-(--color-text-dim)">
              Privacy
            </Link>
          </nav>
        </div>
        <p className="mt-8 border-t border-(--color-border) pt-6 text-xs text-(--color-text-dim)">
          © {new Date().getFullYear()} Atmyshelf · Cover images from Open Library
        </p>
      </div>
    </footer>
  );
}
