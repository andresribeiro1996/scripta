import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { EmptyState } from "../components/EmptyState";
import { BUTTON_PRIMARY } from "../components/page/buttonClasses";
import { useT } from "../i18n";

export function NotFoundPage() {
  const t = useT();
  const signedIn = Boolean(useAuth().session?.user.username);
  return (
    <div className="flex min-h-[calc(100dvh-var(--app-top))] flex-col items-center justify-center gap-3 px-5 text-center">
      <h1 className="sr-only">{t("shell.pageNotFound")}</h1>
      <div className="w-full max-w-md">
        <EmptyState
          title={t("shell.notFoundTitle")}
          body={t("shell.notFoundBody")}
          action={
            <Link to={signedIn ? "/dashboard" : "/"} className={BUTTON_PRIMARY}>
              {signedIn ? t("shell.goToLibrary") : t("shell.backToScripta")}
            </Link>
          }
        />
      </div>
    </div>
  );
}
