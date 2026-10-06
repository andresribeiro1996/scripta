import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { AddBookSheet } from "../components/AddBookSheet";
import { EmptyState } from "../components/EmptyState";
import { useToast } from "../components/Toaster";
import { WorkPageView } from "../components/work/WorkPageView";
import { useWork } from "../hooks/useWork";

export function WorkPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { session } = useAuth();
  const toast = useToast();
  const { page, isLoading, isNotFound, refetch } = useWork(id);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (page && id && page.work.id !== id) navigate(`/work/${page.work.id}`, { replace: true });
  }, [page, id, navigate]);

  if (isLoading) return <main className="mx-auto max-w-5xl px-5 py-8"><p className="text-sm text-(--color-text-dim)">Loading…</p></main>;
  if (!page && isNotFound) return <main className="mx-auto max-w-5xl px-5 py-8"><p className="text-sm text-(--color-text-dim)">No book with that id.</p></main>;
  if (!page) {
    return (
      <main className="mx-auto max-w-5xl px-5 py-8">
        <EmptyState
          title="Couldn't load this book."
          action={<button type="button" onClick={() => void refetch()} className="rounded-lg border border-(--color-border) px-3 py-1.5 text-sm hover:border-(--color-accent)">Retry</button>}
        />
      </main>
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
  const firstEdition = page.work.editions.find((edition) => edition.isbn) ?? page.work.editions[0];

  return (
    <>
      <WorkPageView page={page} signedIn={Boolean(session)} backTo={session ? "/dashboard" : "/"} onBack={location.key === "default" ? null : () => navigate(-1)} onAdd={() => setAdding(true)} onShare={() => void share()} />
      {adding ? <AddBookSheet book={{ title: page.work.title, author: page.work.author, isbn: firstEdition?.isbn ?? null, coverUrl: page.work.coverUrl }} onClose={() => {
        setAdding(false);
        void refetch();
      }} /> : null}
    </>
  );
}
