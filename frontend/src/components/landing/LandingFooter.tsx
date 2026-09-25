import { Link } from "react-router-dom";

export function LandingFooter() {
  return (
    <footer className="border-t border-(--color-border)">
      <div className="mx-auto max-w-6xl px-4 py-12">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <img src="/icon-512.png" alt="" className="h-9 w-9 rounded-lg" />
            <div>
              <p className="text-sm font-bold">Scripta</p>
              <p className="text-xs text-(--color-text-dim)">Your reading life, in one place.</p>
            </div>
          </div>
          <div className="flex items-center gap-6 text-sm font-semibold">
            <Link to="/login" className="transition-colors hover:text-(--color-text-dim)">
              Sign in
            </Link>
            <Link to="/login?mode=signup" className="transition-colors hover:text-(--color-text-dim)">
              Create account
            </Link>
          </div>
        </div>
        <p className="mt-10 border-t border-(--color-border) pt-6 text-[11px] font-semibold uppercase tracking-[0.18em] text-(--color-text-dim)">
          Atmyshelf.com · set in Playfair Display
        </p>
      </div>
    </footer>
  );
}
