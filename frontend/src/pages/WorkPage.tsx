import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { bookKey, type BookScreenModel } from "@scripta/shared";
import { useAuth } from "../auth/AuthContext";
import { AddBookSheet } from "../components/AddBookSheet";
import { EmptyState } from "../components/EmptyState";
import { useToast } from "../components/Toaster";
import { Page } from "../components/page/Page";
import { BookScreen } from "../components/book/BookScreen";
import { useLibrary } from "../hooks/useLibrary";
import { useWork } from "../hooks/useWork";
import { backTo } from "../lib/areas";

export function WorkPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { session } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { page, isLoading, isNotFound, refetch } = useWork(id);
  const libraryQuery = useLibrary({ enabled: Boolean(session) });
  const [adding, setAdding] = useState<BookScreenModel["addBook"]>(null);
  const [editionId, setEditionId] = useState<string | null>(null);

  useEffect(() => {
    if (page && id && page.work.id !== id) navigate(`/work/${page.work.id}`, { replace: true });
  }, [page, id, navigate]);

  const back = session ? backTo("book") : undefined;
  const mineKey = page?.mine?.bookKey;
  const book = mineKey ? libraryQuery.data?.data.books.find((b) => bookKey(b) === mineKey) ?? null : null;

  if (isLoading || (mineKey && !book && libraryQuery.isFetching)) return <Page title="Book" back={back}><p className="text-sm text-(--color-text-dim)">Loading…</p></Page>;
  if (!page && isNotFound) return <Page title="Book" back={back}><p className="text-sm text-(--color-text-dim)">No book with that id.</p></Page>;
  if (!page) {
    return (
      <Page title="Book" back={back}>
        <EmptyState
          title="Couldn't load this book."
          action={<button type="button" onClick={() => void refetch()} className="rounded-lg border border-(--color-border) px-3 py-1.5 text-sm hover:border-(--color-accent)">Retry</button>}
        />
      </Page>
    );
  }

  if (mineKey && !book && libraryQuery.isError) {
    return (
      <Page title={page.work.title} back={back}>
        <EmptyState
          title="Couldn't load your library."
          action={<button type="button" onClick={() => void libraryQuery.refetch()} className="rounded-lg border border-(--color-border) px-3 py-1.5 text-sm hover:border-(--color-accent)">Retry</button>}
        />
      </Page>
    );
  }

  const url = `${window.location.origin}/work/${page.work.id}`;
  const share = async () => {
    try {
      if (typeof navigator.share === "function") await navigator.share({ title: page.work.title, url });
      else if (navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        toast({ message: "Link copied." });
      } else toast({ kind: "error", message: "Couldn't copy the link." });
    } catch (reason) {
      if (!(reason instanceof DOMException)) throw reason;
      if (reason.name !== "AbortError") toast({ kind: "error", message: "Couldn't share the link." });
    }
  };

  return (
    <>
      <BookScreen
        page={page}
        book={book}
        signedIn={Boolean(session)}
        editionId={editionId}
        onSelectEdition={setEditionId}
        onAdd={setAdding}
        onShare={() => void share()}
        frame={(title, actions, body) => <Page title={title} back={back} actions={actions}>{body}</Page>}
      />
      {adding ? <AddBookSheet book={adding} onClose={() => {
        setAdding(null);
        void refetch();
        void queryClient.invalidateQueries({ queryKey: ["library"] });
      }} /> : null}
    </>
  );
}
