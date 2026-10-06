import { Link } from "react-router-dom";
import { container } from "./ui";

export function LandingFooter() {
  return (
    <footer>
      <div className={`${container} flex flex-wrap items-center justify-between gap-x-6 text-xs text-(--color-text-dim)`}>
        <p>© {new Date().getFullYear()} Atmyshelf</p>
        <nav aria-label="Footer" className="flex gap-6">
          <Link to="/privacy" className="flex min-h-11 items-center transition-colors hover:text-(--color-text)">
            Privacy
          </Link>
        </nav>
      </div>
    </footer>
  );
}
