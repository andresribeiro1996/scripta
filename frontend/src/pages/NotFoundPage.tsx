import { Link } from "react-router-dom";
import { BUTTON_PRIMARY } from "../components/page/buttonClasses";

export function NotFoundPage({ framed = false }: { framed?: boolean }) {
  return (
    <div className={`flex ${framed ? "min-h-[calc(100dvh-var(--app-top))]" : "min-h-dvh"} flex-col items-center justify-center gap-3 px-5 text-center`}>
      <h1 className="text-xl font-bold">This page doesn't exist.</h1>
      <p className="text-sm text-(--color-text-dim)">The link may be old or mistyped.</p>
      <Link to="/dashboard" className={BUTTON_PRIMARY}>
        Go to your library
      </Link>
    </div>
  );
}
