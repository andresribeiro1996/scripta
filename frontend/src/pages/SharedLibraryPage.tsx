import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { fetchSharedLibrary } from "../api/sharedLibrary";
import { Page } from "../components/page/Page";
import { PublicLibraryGrid } from "../components/PublicLibraryGrid";
import { resolveLibraryStyle } from "../lib/libraryStyle";
import { useT } from "../i18n";

function InfoScreen({ message }: { message: string }) {
  const t = useT();
  return (
    <Page width="wide" title={t("shell.areaLibrary")}>
      <p className="text-sm text-(--color-text-dim)">{message}</p>
    </Page>
  );
}

export function SharedLibraryPage() {
  const t = useT();
  const { token } = useParams<{ token: string }>();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["sharedLibrary", token],
    queryFn: () => fetchSharedLibrary(token!),
    enabled: Boolean(token),
    // Same reasoning as SharedMuralPage.tsx: a 404 here (unshared/never-
    // shared token) is expected steady-state, not worth retrying.
    retry: false
  });

  const style = resolveLibraryStyle(data?.data.style);

  if (!token || isError) {
    return <InfoScreen message={t("library.sharedInvalid")} />;
  }
  if (isLoading || !data) {
    return <InfoScreen message={t("library.loadingEllipsis")} />;
  }

  return (
    <Page width="wide" title={data.data.name || t("shell.areaLibrary")} maxWidth={style.contentMaxWidth}>
      <PublicLibraryGrid library={data.data} />
    </Page>
  );
}
