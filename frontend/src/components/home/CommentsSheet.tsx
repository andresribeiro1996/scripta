import { useEffect, useId, useState } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { relativeTime } from "@scripta/shared/community";
import { ApiError } from "../../api/client";
import { addActivityComment, deleteActivityComment, fetchActivityComments } from "../../api/community";
import { ENGAGEMENT_KEY } from "../../hooks/useFeedActions";
import { AuthorAvatar } from "../CommunityAuthorAvatar";
import { useConfirm } from "../ConfirmDialog";
import { Sheet } from "../Sheet";
import { Skeleton } from "../Skeleton";
import { useToast } from "../Toaster";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD_CLASS } from "../page/buttonClasses";

const RETRY = "inline-flex min-h-11 items-center font-semibold text-(--color-accent)";

export function CommentsSheet({ id, title, onClose }: { id: string; title: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const fieldId = useId();
  const [draft, setDraft] = useState("");
  const key = ["community", "comments", id];
  const query = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => fetchActivityComments(id, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 30_000,
    retry: 1
  });
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = query;
  useEffect(() => {
    if (items.length === 0 && hasNextPage && !isFetchingNextPage && !isFetchNextPageError) void fetchNextPage();
  }, [items.length, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);

  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: key }), queryClient.invalidateQueries({ queryKey: ENGAGEMENT_KEY })]);
  const onError = (error: unknown) => {
    if (error instanceof ApiError && error.status === 429) toast({ kind: "error", message: "You're commenting too fast — wait a moment and try again." });
  };
  const send = useMutation({
    mutationFn: () => addActivityComment(id, draft.trim()),
    onSuccess: async () => {
      setDraft("");
      await refresh();
    },
    onError
  });
  const remove = useMutation({ mutationFn: deleteActivityComment, onSuccess: refresh, onError });
  const failed = [send, remove].find((mutation) => mutation.isError && !(mutation.error instanceof ApiError && mutation.error.status === 429));

  async function askDelete(commentId: string) {
    if (await confirm({ title: "Delete your comment?", body: "This can't be undone." })) remove.mutate(commentId);
  }

  return (
    <Sheet
      title="Comments"
      onClose={onClose}
      footer={
        <button type="button" className={BUTTON_PRIMARY} disabled={!draft.trim() || send.isPending} onClick={() => send.mutate()}>
          Post
        </button>
      }
    >
      <p className="px-2 pb-2 text-sm break-words text-(--color-text-dim)">{title}</p>
      {query.isPending ? (
        <div className="space-y-3 px-2 py-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : query.isError && items.length === 0 ? (
        <div className="px-2 py-2">
          <p role="alert" className="text-sm text-(--color-danger)">Couldn't load comments.</p>
          <button type="button" className={RETRY} onClick={() => void query.refetch()}>Retry</button>
        </div>
      ) : items.length === 0 && !hasNextPage ? (
        <p className="px-2 py-4 text-sm text-(--color-text-dim)">Be the first to comment.</p>
      ) : (
        <ul className="divide-y divide-(--color-border)">
          {items.map((comment) => (
            <li key={comment.id} className="flex items-start gap-3 px-2 py-3">
              <AuthorAvatar author={comment.author} size={32} />
              <div className="min-w-0 flex-1">
                <p className="text-sm break-words text-(--color-text-dim)">{comment.author.username} · {relativeTime(comment.createdAt)}</p>
                <p className="break-words whitespace-pre-wrap">{comment.text}</p>
              </div>
              {comment.own ? (
                <button type="button" className={`${BUTTON_SECONDARY} shrink-0`} disabled={remove.isPending} onClick={() => void askDelete(comment.id)}>Delete</button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {isFetchNextPageError && !isFetchingNextPage ? (
        <div className="px-2">
          <p role="alert" className="text-sm text-(--color-danger)">Couldn't load more comments.</p>
          <button type="button" className={RETRY} onClick={() => void fetchNextPage()}>Retry</button>
        </div>
      ) : hasNextPage && items.length > 0 ? (
        <button type="button" className={`${BUTTON_SECONDARY} mx-2 mt-2 w-[calc(100%-1rem)]`} disabled={isFetchingNextPage} onClick={() => void fetchNextPage()}>
          {isFetchingNextPage ? "Loading…" : "Load more"}
        </button>
      ) : null}
      <div className="flex flex-col gap-1.5 px-2 pt-3 pb-2">
        <label htmlFor={fieldId} className="text-sm font-semibold">Comment</label>
        <textarea id={fieldId} rows={3} maxLength={1500} placeholder="Write a comment…" value={draft} disabled={send.isPending} onChange={(event) => setDraft(event.target.value)} className={`${FIELD_CLASS} w-full resize-y`} />
        {failed ? <p role="alert" className="text-sm text-(--color-danger)">{failed === send ? "Couldn't post your comment." : "Couldn't delete your comment."}</p> : null}
      </div>
    </Sheet>
  );
}
