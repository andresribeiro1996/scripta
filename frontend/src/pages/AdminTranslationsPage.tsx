import { useQuery, useQueryClient } from "@tanstack/react-query";
import { withoutTranslation, type TranslationReview, type TranslationReviewAction } from "@scripta/shared";
import { fetchIsAdmin, fetchTranslationReview, reviewTranslation } from "../api/books";
import { TranslationReviewList } from "../components/TranslationReviewList";
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
    <div className="mx-auto max-w-3xl px-5 py-6">
      <h1 className="text-xl font-bold">Translation review</h1>
      {review.data ? <TranslationReviewList review={review.data} onDecide={decide} /> : review.isError ? <p role="alert" className="mt-4 text-sm text-(--color-danger)">The review list didn't load.</p> : null}
    </div>
  );
}
