import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-5 text-center">
      <h1 className="text-xl font-bold">This page doesn't exist.</h1>
      <p className="text-sm text-(--color-text-dim)">The link may be old or mistyped.</p>
      <Link
        to="/dashboard"
        className="rounded-lg bg-(--color-accent) px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90"
      >
        Go to your library
      </Link>
    </div>
  );
}
