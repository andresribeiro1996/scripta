import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { savedContentRef, saveFailureMessage, toRecommendation, type DigestItem } from "@scripta/shared";
import { feedRowModel, feedShareTarget, hasActivityThread, type ActivityEngagement } from "@scripta/shared/community";
import { fetchActivityEngagement, fetchSavedState, likeActivity, saveContent } from "../api/community";
import { addBookToLibrary } from "../api/library";
import { useToast } from "../components/Toaster";

export const ENGAGEMENT_KEY = ["community", "engagement"] as const;
export const SAVED_STATE_KEY = ["community", "saved", "state"] as const;
export const SAVED_LIST_KEY = ["community", "saved", "list"] as const;

export type ReadingItem = Extract<DigestItem, { kind: "reading" }>;

export interface FeedActions {
  engagement: Record<string, ActivityEngagement>;
  saved: Set<string>;
  savedReady: boolean;
  busy: { like: boolean; save: boolean; want: boolean };
  like(item: DigestItem): void;
  save(item: DigestItem, saved: boolean): void;
  wantToRead(item: ReadingItem): void;
  share(item: DigestItem): void;
}

function batches<T>(values: T[]): T[][] {
  return Array.from({ length: Math.ceil(values.length / 50) }, (_, index) => values.slice(index * 50, (index + 1) * 50));
}

export function useFeedActions(items: DigestItem[]): FeedActions {
  const queryClient = useQueryClient();
  const toast = useToast();
  const ids = [...new Set(items.filter((item) => hasActivityThread(item)).map((item) => item.id))];
  const refs = items.flatMap((item) => {
    const ref = savedContentRef(item);
    return ref ? [ref] : [];
  });
  const engagementQueries = useQueries({
    queries: batches(ids).map((chunk) => ({ queryKey: [...ENGAGEMENT_KEY, chunk], queryFn: () => fetchActivityEngagement(chunk), staleTime: 30_000, retry: 1 }))
  });
  const savedQueries = useQueries({
    queries: batches(refs).map((chunk) => ({ queryKey: [...SAVED_STATE_KEY, chunk], queryFn: () => fetchSavedState(chunk), staleTime: 30_000, retry: 1 }))
  });
  const engagement: Record<string, ActivityEngagement> = Object.assign({}, ...engagementQueries.map((query) => query.data ?? {}));
  const saved = new Set(savedQueries.flatMap((query) => query.data ?? []));

  const fail = (generic: string) => (error: unknown) => toast({ kind: "error", message: saveFailureMessage(error, generic) });

  const like = useMutation({
    mutationFn: ({ id, liked }: { id: string; liked: boolean }) => likeActivity(id, liked),
    onSuccess: (answer, { id }) => {
      queryClient.setQueriesData<Record<string, ActivityEngagement>>({ queryKey: ENGAGEMENT_KEY }, (data) => (data?.[id] ? { ...data, [id]: answer } : data));
    },
    onError: fail("Couldn't update your like.")
  });

  const save = useMutation({
    mutationFn: ({ item, saved: next }: { item: DigestItem; saved: boolean }) => {
      const ref = savedContentRef(item);
      if (!ref) throw new Error("This item cannot be saved for later.");
      return saveContent(ref, next);
    },
    onSuccess: () => Promise.all([queryClient.invalidateQueries({ queryKey: SAVED_STATE_KEY }), queryClient.invalidateQueries({ queryKey: SAVED_LIST_KEY })]),
    onError: fail("Couldn't update your saved items.")
  });

  const want = useMutation({
    mutationFn: (item: ReadingItem) => addBookToLibrary({ ...toRecommendation(item.book, 0), preserveExisting: true }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["library"] }),
    onError: fail("Couldn't add the book to your library.")
  });

  async function share(item: DigestItem) {
    const path = feedShareTarget(item);
    if (!path) return;
    const url = `${window.location.origin}${path}`;
    const title = feedRowModel(item).title || "Atmyshelf";
    try {
      if (typeof navigator.share === "function") await navigator.share({ title, url });
      else if (navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        toast({ message: "Link copied." });
      } else toast({ kind: "error", message: "Couldn't copy the link." });
    } catch (reason) {
      if (!(reason instanceof DOMException)) throw reason;
      if (reason.name !== "AbortError") toast({ kind: "error", message: "Couldn't share the link." });
    }
  }

  return {
    engagement,
    saved,
    savedReady: savedQueries.every((query) => query.isSuccess),
    busy: { like: like.isPending, save: save.isPending, want: want.isPending },
    like: (item) => like.mutate({ id: item.id, liked: !engagement[item.id]?.liked }),
    save: (item, next) => save.mutate({ item, saved: next }),
    wantToRead: (item) => want.mutate(item),
    share: (item) => void share(item)
  };
}
