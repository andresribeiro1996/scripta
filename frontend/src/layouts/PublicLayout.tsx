import { Link, Outlet, useLocation } from "react-router-dom";
import { useT } from "../i18n";
import { BUTTON_SECONDARY } from "../components/page/buttonClasses";
import { TopBar } from "../components/page/TopBar";

export function PublicLayout({ signedIn }: { signedIn: boolean }) {
  const t = useT();
  const location = useLocation();
  return (
    <div className="min-h-screen bg-(--color-bg) text-(--color-text)">
      <TopBar
        areas={[]}
        activeId={null}
        brandTo="/"
        end={signedIn
          ? <Link to="/dashboard" className={BUTTON_SECONDARY}>{t("shell.openMyLibrary")}</Link>
          : <Link to="/login" state={{ from: location }} className={BUTTON_SECONDARY}>{t("shell.logIn")}</Link>}
      />
      <main id="content"><Outlet /></main>
    </div>
  );
}
