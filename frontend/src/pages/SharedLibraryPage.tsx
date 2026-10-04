import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { fetchSharedLibrary } from "../api/sharedLibrary";
import { PageContainer } from "../components/PageContainer";
import { PublicLibraryGrid } from "../components/PublicLibraryGrid";
import { resolveLibraryStyle } from "../lib/libraryStyle";

function InfoScreen({ message }: { message: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-5 text-center">
      <p className="text-(--color-text-dim)">{message}</p>
    </div>
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
    <PageContainer maxWidth={style.contentMaxWidth}>
      <header className="mb-6">
        <h1 className="text-lg font-bold">{data.data.name || "Library"}</h1>
      </header>
      <PublicLibraryGrid library={data.data} />
    </PageContainer>
  );
}
