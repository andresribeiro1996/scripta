import { useEffect, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { bookStatsModel } from "@scripta/shared";
import { useAuth } from "../auth/AuthContext";
import { EmptyState } from "../components/EmptyState";
import { StatsSections } from "../components/book/BookStats";
import { BackLink } from "../components/work/BackLink";
import { useWork } from "../hooks/useWork";
import { useWorkStats } from "../hooks/useWorkStats";

const shell = "mx-auto max-w-3xl px-5 py-8";

export function WorkStatsView({ id, back }: { id: string | undefined; back: ReactNode }) {
  const navigate = useNavigate();
  const work = useWork(id);
  const stats = useWorkStats(work.page?.work.id === id ? id : undefined);

  useEffect(() => {
    if (work.page && id && work.page.work.id !== id) navigate(`/work/${work.page.work.id}/stats`, { replace: true });
  }, [work.page, id, navigate]);

  const retry = (onRetry: () => void) => (
    <EmptyState
      title="Couldn't load these stats."
      action={<button type="button" onClick={onRetry} className="rounded-lg border border-(--color-border) px-3 py-1.5 text-sm hover:border-(--color-accent)">Retry</button>}
    />
  );

  if (!work.page && work.isNotFound) return <main className={shell}>{back}<p className="text-sm text-(--color-text-dim)">No book with that id.</p></main>;
  if (!work.page && !work.isLoading) return <main className={shell}>{back}{retry(() => void work.refetch())}</main>;
  if (!work.page || work.page.work.id !== id || stats.isPending) return <main className={shell}>{back}<p className="text-sm text-(--color-text-dim)">Loading…</p></main>;
  if (stats.isError && !stats.data) return <main className={shell}>{back}{retry(() => void stats.refetch())}</main>;

  return (
    <main className={shell}>
      {back}
      <h1 className="mb-6 text-2xl font-bold">{work.page.work.title}</h1>
      <StatsSections model={bookStatsModel(stats.data ?? null, work.page.work.rating)} />
    </main>
  );
}

export function WorkStatsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { session } = useAuth();
  const hasHistory = (window.history.state?.idx ?? 0) > 0;
  const back = <BackLink backTo={id ? `/work/${id}` : session ? "/dashboard" : "/"} onBack={hasHistory ? () => navigate(-1) : null} />;
  return <WorkStatsView id={id} back={back} />;
}
