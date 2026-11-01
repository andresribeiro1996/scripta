import { Navigate, useParams } from "react-router-dom";
import { bookKey } from "@scripta/shared";
import { BookScreen } from "../components/book/BookScreen";
import { EmptyState } from "../components/EmptyState";
import { Page } from "../components/page/Page";
import { useLibrary } from "../hooks/useLibrary";
import { backTo } from "../lib/areas";
import { useT } from "../i18n";

export function BookKeyPage() {
  const t = useT();
  const { key = "" } = useParams<{ key: string }>();
  const library = useLibrary();
  const workId = library.data?.works?.[key];
  const book = library.data?.data.books.find((b) => bookKey(b) === key) ?? null;
  const back = backTo("book");
  if (workId) return <Navigate to={`/work/${workId}`} replace />;
  if (book) {
    return (
      <BookScreen
        page={null}
        book={book}
        signedIn
        editionId={null}
        onSelectEdition={() => {}}
        onAdd={() => {}}
        onShare={null}
        frame={(body) => <Page title={null} back={back}>{body}</Page>}
      />
    );
  }
  if (library.isFetching) return <Page title={t("book.pageTitle")} back={back}><p className="text-sm text-(--color-text-dim)">{t("library.loadingEllipsis")}</p></Page>;
  if (library.isError) {
    return (
      <Page title={t("book.pageTitle")} back={back}>
        <EmptyState
          title={t("library.libraryLoadFailedOwn")}
          action={<button type="button" onClick={() => void library.refetch()} className="rounded-lg border border-(--color-border) px-3 py-1.5 text-sm hover:border-(--color-accent)">{t("library.retry")}</button>}
        />
      </Page>
    );
  }
  return <Page title={t("book.pageTitle")} back={back}><EmptyState title={t("book.bookNotFound")} /></Page>;
}
