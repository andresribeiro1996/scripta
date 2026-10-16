import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { withoutWork, type GenreReview, type GenreReviewAction } from "@scripta/shared";
import { fetchGenreReview, fetchIsAdmin, reviewGenre } from "../api/books";
import { GenreReviewList } from "../components/GenreReviewList";
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
  return (
    <div className="mx-auto max-w-3xl px-5 py-6">
      <h1 className="text-xl font-bold">Genre review</h1>
      {review.data ? <GenreReviewList review={review.data} onDecide={(workId, action) => decideGenre(client, workId, action)} /> : review.isError ? <p role="alert" className="mt-4 text-sm text-(--color-danger)">The review list didn't load.</p> : null}
    </div>
  );
}
