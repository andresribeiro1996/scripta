import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { fetchSharedLibrary } from "../api/sharedLibrary";
import { Page } from "../components/page/Page";
import { PublicLibraryGrid } from "../components/PublicLibraryGrid";
import { resolveLibraryStyle } from "../lib/libraryStyle";

function InfoScreen({ message }: { message: string }) {
  return (
    <Page title="Library">
      <p className="text-sm text-(--color-text-dim)">{message}</p>
    </Page>
  );
}

export function SharedLibraryPage() {
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
    return <InfoScreen message="This link is invalid or no longer active." />;
  }
  if (isLoading || !data) {
    return <InfoScreen message="Loading…" />;
  }

  return (
    <Page title={data.data.name || "Library"} maxWidth={style.contentMaxWidth}>
      <PublicLibraryGrid library={data.data} />
    </Page>
  );
}
