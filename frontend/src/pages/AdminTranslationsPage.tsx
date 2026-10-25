import { useQuery, useQueryClient } from "@tanstack/react-query";
import { withoutTranslation, type TranslationReview, type TranslationReviewAction } from "@scripta/shared";
import { fetchIsAdmin, fetchTranslationReview, reviewTranslation } from "../api/books";
import { TranslationReviewList } from "../components/TranslationReviewList";
import { EmptyState } from "../components/EmptyState";
import { Page } from "../components/page/Page";
import { area } from "../lib/areas";
import { NotFoundPage } from "./NotFoundPage";

export function AdminTranslationsPage() {
  const client = useQueryClient();
  const { data: isAdmin, isPending } = useQuery({ queryKey: ["books-admin"], queryFn: fetchIsAdmin, staleTime: Infinity });
  const review = useQuery({ queryKey: ["translation-review"], queryFn: fetchTranslationReview, enabled: isAdmin === true });
  if (isPending) return null;
  if (!isAdmin) return <NotFoundPage />;
  const decide = async (workId: string, action: TranslationReviewAction) => {
    await reviewTranslation(workId, action);
    client.setQueryData<TranslationReview>(["translation-review"], (current) => (current ? withoutTranslation(current, workId) : current));
  };
  return (
    <Page title="Admin" subtitle="Translation review" tabs={area("admin").tabs}>
      {review.data ? review.data.items.length === 0 ? <EmptyState title="Nothing to review." /> : <TranslationReviewList review={review.data} onDecide={decide} /> : review.isError ? <p role="alert" className="mt-4 text-sm text-(--color-danger)">The review list didn't load.</p> : null}
    </Page>
  );
}
