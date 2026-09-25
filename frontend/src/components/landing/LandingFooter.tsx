import { Link } from "react-router-dom";

export function LandingFooter() {
  return (
    <footer className="border-t border-(--color-border)">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-4 py-10 text-sm text-(--color-text-dim) sm:flex-row sm:justify-between">
        <div className="flex items-center gap-3">
          <img src="/icon-512.png" alt="" className="h-6 w-6 rounded-md" />
          <span>Your reading life, in one place.</span>
        </div>
        <div className="flex items-center gap-5 font-semibold">
          <Link to="/login" className="transition-colors hover:text-(--color-text)">
            Sign in
          </Link>
          <Link to="/login?mode=signup" className="transition-colors hover:text-(--color-text)">
            Create account
          </Link>
        </div>
      </div>
    </footer>
  );
}
