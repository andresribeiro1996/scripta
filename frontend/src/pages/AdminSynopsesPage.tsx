import { useQuery, useQueryClient } from "@tanstack/react-query";
import { withoutSynopsis, type SynopsisDecision, type SynopsisReview } from "@scripta/shared";
import { fetchIsAdmin, fetchSynopsisReview, reviewSynopsis } from "../api/books";
import { SynopsisReviewList } from "../components/SynopsisReviewList";
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
  return (
    <div className="mx-auto max-w-3xl px-5 py-6">
      <h1 className="text-xl font-bold">Synopsis review</h1>
      {review.data ? <SynopsisReviewList review={review.data} onDecide={decide} /> : review.isError ? <p role="alert" className="mt-4 text-sm text-(--color-danger)">The review list didn't load.</p> : null}
    </div>
  );
}
