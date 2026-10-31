import { Link } from "react-router-dom";
import { EmptyState } from "../components/EmptyState";
import { BUTTON_PRIMARY } from "../components/page/buttonClasses";

export function NotFoundPage({ framed = false }: { framed?: boolean }) {
  return (
    <div className={`flex ${framed ? "min-h-[calc(100dvh-var(--app-top))]" : "min-h-dvh"} flex-col items-center justify-center gap-3 px-5 text-center`}>
      <h1 className="sr-only">Page not found</h1>
      <div className="w-full max-w-md">
        <EmptyState
          title="This page doesn't exist."
          body="The link may be old or mistyped."
          action={
            <Link to="/dashboard" className={BUTTON_PRIMARY}>
              Go to your library
            </Link>
          }
        />
      </div>
    </div>
  );
}
