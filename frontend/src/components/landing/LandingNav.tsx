import { Link } from "react-router-dom";

const anchors = [
  ["Features", "#features"],
  ["Murals", "#murals"],
  ["Arena", "#arena"],
  ["Get the app", "#app"],
] as const;

export function LandingNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-(--color-border) bg-(--color-bg)">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Link to="/" aria-label="Scripta home">
          <img src="/icon-512.png" alt="" className="h-8 w-8 rounded-lg" />
        </Link>
        <nav className="hidden items-center gap-6 text-sm font-semibold text-(--color-text-dim) sm:flex">
          {anchors.map(([label, href]) => (
            <a key={href} href={href} className="transition-colors hover:text-(--color-text)">
              {label}
            </a>
          ))}
        </nav>
        <Link
          to="/login"
          className="rounded-lg bg-(--color-accent) px-4 py-2 text-sm font-semibold text-(--color-on-accent) transition-opacity hover:opacity-90"
        >
          Sign in
        </Link>
      </div>
    </header>
  );
}
