import { Navigate, useNavigate, useParams } from "react-router-dom";
import { bookKey } from "@scripta/shared";
import { BookScreen } from "../components/book/BookScreen";
import { EmptyState } from "../components/EmptyState";
import { BackLink } from "../components/work/BackLink";
import { useLibrary } from "../hooks/useLibrary";

const backTo = "/dashboard/library";

export function BookKeyPage() {
  const { key = "" } = useParams<{ key: string }>();
  const navigate = useNavigate();
  const library = useLibrary();
  const workId = library.data?.works?.[key];
  const book = library.data?.data.books.find((b) => bookKey(b) === key) ?? null;
  const hasHistory = (window.history.state?.idx ?? 0) > 0;
  const onBack = hasHistory ? () => navigate(-1) : null;
  if (workId) return <Navigate to={`/work/${workId}`} replace />;
  if (book) return <BookScreen page={null} book={book} signedIn editionId={null} onSelectEdition={() => {}} onAdd={() => {}} onShare={null} onBack={onBack} backTo={backTo} />;
  const back = <BackLink backTo={backTo} onBack={onBack} />;
  if (library.isFetching) return <main className="mx-auto max-w-5xl px-5 py-8">{back}<p className="text-sm text-(--color-text-dim)">Loading…</p></main>;
  if (library.isError) {
    return (
      <main className="mx-auto max-w-5xl px-5 py-8">
        {back}
        <EmptyState
          title="Couldn't load your library."
          action={<button type="button" onClick={() => void library.refetch()} className="rounded-lg border border-(--color-border) px-3 py-1.5 text-sm hover:border-(--color-accent)">Retry</button>}
        />
      </main>
    );
  }
  return <main className="mx-auto max-w-5xl px-5 py-8">{back}<EmptyState title="Book not found" /></main>;
}
