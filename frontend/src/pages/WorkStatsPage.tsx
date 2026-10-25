import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { bookStatsModel } from "@scripta/shared";
import { EmptyState } from "../components/EmptyState";
import { StatsSections } from "../components/book/BookStats";
import { Page } from "../components/page/Page";
import { useWork } from "../hooks/useWork";
import { useWorkStats } from "../hooks/useWorkStats";

export function WorkStatsView({ id }: { id: string | undefined }) {
  const navigate = useNavigate();
  const back = id ? { to: `/work/${id}`, label: "Book" } : undefined;
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

  if (!work.page && work.isNotFound) return <Page title="Stats" back={back}><p className="text-sm text-(--color-text-dim)">No book with that id.</p></Page>;
  if (!work.page && !work.isLoading) return <Page title="Stats" back={back}>{retry(() => void work.refetch())}</Page>;
  if (!work.page || work.page.work.id !== id || stats.isPending) return <Page title="Stats" back={back}><p className="text-sm text-(--color-text-dim)">Loading…</p></Page>;
  if (stats.isError && !stats.data) return <Page title={work.page.work.title} back={back}>{retry(() => void stats.refetch())}</Page>;

  return (
    <Page title={work.page.work.title} back={back}>
      <StatsSections model={bookStatsModel(stats.data ?? null, work.page.work.rating)} />
    </Page>
  );
}

export function WorkStatsPage() {
  const { id } = useParams<{ id: string }>();
  return <WorkStatsView id={id} />;
}
