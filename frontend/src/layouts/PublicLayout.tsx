import { Link, Outlet, useLocation } from "react-router-dom";
import { BrandLockup } from "../components/BrandLockup";
import { DEFAULT_LIBRARY_STYLE } from "../lib/libraryStyle";

const linkClass = "inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-(--color-accent) hover:underline";

export function PublicLayout({ signedIn }: { signedIn: boolean }) {
  const location = useLocation();
  return (
    <div className="min-h-screen bg-(--color-bg) text-(--color-text)">
      <div className="border-b border-(--color-border)">
        <div className="mx-auto flex items-center justify-between gap-3 px-4 py-1 sm:px-5 lg:px-8" style={{ maxWidth: `${DEFAULT_LIBRARY_STYLE.contentMaxWidth}px` }}>
          <Link to="/" aria-label="Atmyshelf home" className="inline-flex min-h-11 items-center"><BrandLockup /></Link>
          {signedIn ? <Link to="/dashboard" className={linkClass}>Open my library</Link> : <Link to="/login" state={{ from: location }} className={linkClass}>Log in</Link>}
        </div>
      </div>
      <main><Outlet /></main>
    </div>
  );
}
