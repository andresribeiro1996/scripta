import { Link } from "react-router-dom";
import { BUTTON_PRIMARY } from "../components/page/buttonClasses";

export function NotFoundPage() {
  return (
    <div className="flex min-h-[calc(100dvh-var(--app-top))] flex-col items-center justify-center gap-3 px-5 text-center">
      <h1 className="text-xl font-bold">This page doesn't exist.</h1>
      <p className="text-sm text-(--color-text-dim)">The link may be old or mistyped.</p>
      <Link to="/dashboard" className={BUTTON_PRIMARY}>
        Go to your library
      </Link>
    </div>
  );
}
