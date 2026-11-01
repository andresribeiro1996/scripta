import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { savedContentRef, saveFailureMessage, toRecommendation, type DigestItem } from "@scripta/shared";
import { feedRowModel, feedShareTarget, hasActivityThread, type ActivityEngagement } from "@scripta/shared/community";
import { shareLink } from "../lib/shareLink";
import { fetchActivityEngagement, fetchSavedState, likeActivity, saveContent } from "../api/community";
import { addBookToLibrary } from "../api/library";
import { useToast } from "../components/Toaster";
import { getLocale, t, useLocale } from "../i18n";

export const ENGAGEMENT_KEY = ["community", "engagement"] as const;
export const SAVED_STATE_KEY = ["community", "saved", "state"] as const;
export const SAVED_LIST_KEY = ["community", "saved", "list"] as const;

export type ReadingItem = Extract<DigestItem, { kind: "reading" }>;

export interface FeedActions {
  engagement: Record<string, ActivityEngagement>;
  saved: Set<string>;
  savedReady: boolean;
  busy: { like: boolean; save: boolean };
  wanting: string | null;
  loadError: string | null;
  retryLoad(): void;
  like(item: DigestItem): void;
  save(item: DigestItem, saved: boolean): void;
  wantToRead(item: ReadingItem): void;
  share(item: DigestItem): void;
}

function batches<T>(values: T[]): T[][] {
  return Array.from({ length: Math.ceil(values.length / 50) }, (_, index) => values.slice(index * 50, (index + 1) * 50));
}

export function useFeedActions(items: DigestItem[], { trackSaved = true }: { trackSaved?: boolean } = {}): FeedActions {
  const locale = useLocale();
  const queryClient = useQueryClient();
  const toast = useToast();
  const ids = [...new Set(items.filter((item) => hasActivityThread(item)).map((item) => item.id))];
  const refs = trackSaved
    ? items.flatMap((item) => {
        const ref = savedContentRef(item);
        return ref ? [ref] : [];
      })
    : [];
  const engagementQueries = useQueries({
    queries: batches(ids).map((chunk) => ({ queryKey: [...ENGAGEMENT_KEY, chunk], queryFn: () => fetchActivityEngagement(chunk), staleTime: 30_000, retry: 1 }))
  });
  const savedQueries = useQueries({
    queries: batches(refs).map((chunk) => ({ queryKey: [...SAVED_STATE_KEY, chunk], queryFn: () => fetchSavedState(chunk), staleTime: 30_000, retry: 1 }))
  });
  const engagement: Record<string, ActivityEngagement> = Object.assign({}, ...engagementQueries.map((query) => query.data ?? {}));
  const saved = new Set(savedQueries.flatMap((query) => query.data ?? []));

  const fail = (key: "addBook.likeFailed" | "addBook.savedItemsFailed" | "addBook.feedAddFailed") => (error: unknown) =>
    toast({ kind: "error", message: saveFailureMessage(error, t(key), getLocale()) });

  const like = useMutation({
    mutationFn: ({ id, liked }: { id: string; liked: boolean }) => likeActivity(id, liked),
    onSuccess: (answer, { id }) => {
      queryClient.setQueriesData<Record<string, ActivityEngagement>>({ queryKey: ENGAGEMENT_KEY }, (data) => (data?.[id] ? { ...data, [id]: answer } : data));
    },
    onError: fail("addBook.likeFailed")
  });

  const save = useMutation({
    mutationFn: ({ item, saved: next }: { item: DigestItem; saved: boolean }) => {
      const ref = savedContentRef(item);
      if (!ref) throw new Error(t("addBook.itemNotSaveable"));
      return saveContent(ref, next);
    },
    onSuccess: () => Promise.all([queryClient.invalidateQueries({ queryKey: SAVED_STATE_KEY }), queryClient.invalidateQueries({ queryKey: SAVED_LIST_KEY })]),
    onError: fail("addBook.savedItemsFailed")
  });

  const want = useMutation({
    mutationFn: (item: ReadingItem) => addBookToLibrary({ ...toRecommendation(item.book, 0), preserveExisting: true }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["library"] }),
    onError: fail("addBook.feedAddFailed")
  });

  function share(item: DigestItem) {
    const path = feedShareTarget(item);
    if (!path) return;
    return shareLink(feedRowModel(item, locale).title || "Atmyshelf", `${window.location.origin}${path}`, toast);
  }

  const failedQueries = [...engagementQueries, ...savedQueries].filter((query) => query.isError);

  return {
    engagement,
    saved,
    savedReady: savedQueries.every((query) => query.isSuccess),
    busy: { like: like.isPending, save: save.isPending },
    wanting: want.isPending ? want.variables.id : null,
    loadError: engagementQueries.some((query) => query.isError) ? t("addBook.reactionsLoadFailed") : savedQueries.some((query) => query.isError) ? t("library.savedLoadFailed") : null,
    retryLoad: () => failedQueries.forEach((query) => void query.refetch()),
    like: (item) => like.mutate({ id: item.id, liked: !engagement[item.id]?.liked }),
    save: (item, next) => save.mutate({ item, saved: next }),
    wantToRead: (item) => want.mutate(item),
    share: (item) => void share(item)
  };
}
