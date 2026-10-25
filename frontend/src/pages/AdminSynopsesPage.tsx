import { useQuery, useQueryClient } from "@tanstack/react-query";
import { withoutSynopsis, type SynopsisDecision, type SynopsisReview } from "@scripta/shared";
import { fetchIsAdmin, fetchSynopsisReview, reviewSynopsis } from "../api/books";
import { SynopsisReviewList } from "../components/SynopsisReviewList";
import type { ReactNode } from "react";
import { EmptyState } from "../components/EmptyState";
import { InfoIcon } from "../components/NavIcons";
import { Page } from "../components/page/Page";
import { area } from "../lib/areas";
import { NotFoundPage } from "./NotFoundPage";

export function AdminSynopsesPage() {
  const client = useQueryClient();
  const { data: isAdmin, isPending } = useQuery({ queryKey: ["books-admin"], queryFn: fetchIsAdmin, staleTime: Infinity });
  const review = useQuery({ queryKey: ["synopsis-review"], queryFn: fetchSynopsisReview, enabled: isAdmin === true });
  if (isPending) return null;
  if (!isAdmin) return <NotFoundPage />;
  const decide = async (hash: string, decision: SynopsisDecision) => {
    await reviewSynopsis(hash, decision);
    client.setQueryData<SynopsisReview>(["synopsis-review"], (current) => (current ? withoutSynopsis(current, hash) : current));
  };
  let body: ReactNode = null;
  if (review.data?.total === 0) body = <EmptyState icon={InfoIcon} title="Nothing to review." body="New items show up here as they come in." />;
  else if (review.data) body = <SynopsisReviewList review={review.data} onDecide={decide} />;
  else if (review.isError) body = <p role="alert" className="mt-4 text-sm text-(--color-danger)">The review list didn't load.</p>;
  return (
    <Page title="Admin" subtitle="Synopsis review" tabs={area("admin").tabs}>
      {body}
    </Page>
  );
}
