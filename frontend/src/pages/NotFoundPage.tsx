import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { EmptyState } from "../components/EmptyState";
import { BUTTON_PRIMARY } from "../components/page/buttonClasses";

export function NotFoundPage() {
  const signedIn = Boolean(useAuth().session?.user.username);
  return (
    <div className="flex min-h-[calc(100dvh-var(--app-top))] flex-col items-center justify-center gap-3 px-5 text-center">
      <h1 className="sr-only">Page not found</h1>
      <div className="w-full max-w-md">
        <EmptyState
          title="This page doesn't exist."
          body="The link may be old or mistyped."
          action={
            <Link to={signedIn ? "/dashboard" : "/"} className={BUTTON_PRIMARY}>
              {signedIn ? "Go to your library" : "Back to Scripta"}
            </Link>
          }
        />
      </div>
    </div>
  );
}
