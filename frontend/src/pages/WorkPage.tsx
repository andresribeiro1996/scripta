import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { AddBookSheet } from "../components/AddBookSheet";
import { EmptyState } from "../components/EmptyState";
import { useToast } from "../components/Toaster";
import { WorkPageView } from "../components/work/WorkPageView";
import { useWork } from "../hooks/useWork";

export function WorkPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { session } = useAuth();
  const toast = useToast();
  const { page, isLoading, error, isNotFound, refetch } = useWork(id);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (page && id && page.work.id !== id) navigate(`/work/${page.work.id}`, { replace: true });
  }, [page, id, navigate]);

  if (isLoading) return <main className="mx-auto max-w-5xl px-5 py-8"><p className="text-sm text-(--color-text-dim)">Loading…</p></main>;
  if (isNotFound) return <main className="mx-auto max-w-5xl px-5 py-8"><p className="text-sm text-(--color-text-dim)">No book with that id.</p></main>;
  if (error || !page) {
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
  const share = () => {
    if (typeof navigator.share === "function") void navigator.share({ title: page.work.title, url });
    else void navigator.clipboard.writeText(url).then(() => toast({ message: "Link copied." }));
  };
  const firstEdition = page.work.editions.find((edition) => edition.isbn) ?? page.work.editions[0];

  return (
    <>
      <WorkPageView page={page} signedIn={Boolean(session)} onAdd={() => setAdding(true)} onShare={share} />
      {adding ? <AddBookSheet book={{ title: page.work.title, author: page.work.author, isbn: firstEdition?.isbn ?? null, coverUrl: page.work.coverUrl }} onClose={() => setAdding(false)} /> : null}
    </>
  );
}
