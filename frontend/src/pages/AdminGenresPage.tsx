import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { withoutWork, type GenreReview, type GenreReviewAction } from "@scripta/shared";
import { fetchGenreReview, fetchIsAdmin, reviewGenre } from "../api/books";
import { GenreReviewList } from "../components/GenreReviewList";
import type { ReactNode } from "react";
import { EmptyState } from "../components/EmptyState";
import { InfoIcon } from "../components/NavIcons";
import { Page } from "../components/page/Page";
import { area } from "../lib/areas";
import { NotFoundPage } from "./NotFoundPage";

export async function decideGenre(client: QueryClient, workId: string, action: GenreReviewAction): Promise<void> {
  await reviewGenre(workId, action);
  client.setQueryData<GenreReview>(["genre-review"], (current) => (current ? withoutWork(current, workId) : current));
}

export function AdminGenresPage() {
  const client = useQueryClient();
  const { data: isAdmin, isPending } = useQuery({ queryKey: ["books-admin"], queryFn: fetchIsAdmin, staleTime: Infinity });
  const review = useQuery({ queryKey: ["genre-review"], queryFn: fetchGenreReview, enabled: isAdmin === true });
  if (isPending) return null;
  if (!isAdmin) return <NotFoundPage />;
  let body: ReactNode = null;
  if (review.data?.total === 0) body = <EmptyState icon={InfoIcon} title="Nothing to review." body="New items show up here as they come in." />;
  else if (review.data) body = <GenreReviewList review={review.data} onDecide={(workId, action) => decideGenre(client, workId, action)} />;
  else if (review.isError) body = <p role="alert" className="mt-4 text-sm text-(--color-danger)">The review list didn't load.</p>;
  return (
    <Page title="Admin" subtitle="Genre review" tabs={area("admin").tabs}>
      {body}
    </Page>
  );
}
