import { Share } from "react-native";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { savedContentRef, saveFailureMessage, toRecommendation, type DigestItem } from "@scripta/shared";
import { useAuth } from "../../core/auth";
import { fetchActivityEngagement, fetchSavedState, likeActivity, saveContent } from "../community/api";
import { addBookToLibrary } from "../library/api/client";
import { LIBRARY_QUERY_KEY, useLibrary } from "../library/hooks/useLibrary";
import { publicContentUrl } from "../sharing/links";
import { feedRowModel, feedShareTarget, hasActivityThread, type ActivityEngagement } from "@scripta/shared/community";
import { useLocale } from "../../i18n";

export const ENGAGEMENT_QUERY_KEY = ["community", "engagement"] as const;
export const SAVED_STATE_QUERY_KEY = ["community", "saved-state"] as const;
export const SAVED_QUERY_KEY = ["community", "saved"] as const;

function batches<T>(values: T[]) { return Array.from({ length: Math.ceil(values.length / 50) }, (_, index) => values.slice(index * 50, (index + 1) * 50)); }

export function useHomeActions(items: DigestItem[]) {
  const locale = useLocale();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const library = useLibrary();
  const ids = [...new Set(items.filter(hasActivityThread).map((item) => item.id))];
  const refs = items.flatMap((item) => { const ref = savedContentRef(item); return ref ? [ref] : []; });
  const engagementQueries = useQueries({ queries: batches(ids).map((ids) => ({ queryKey: [...ENGAGEMENT_QUERY_KEY, user?.id, ids], queryFn: () => fetchActivityEngagement(ids), enabled: Boolean(user) })) });
  const savedQueries = useQueries({ queries: batches(refs).map((refs) => ({ queryKey: [...SAVED_STATE_QUERY_KEY, user?.id, refs], queryFn: () => fetchSavedState(refs), enabled: Boolean(user) })) });
  const engagement: Record<string, ActivityEngagement> = Object.assign({}, ...engagementQueries.map((query) => query.data ?? {}));
  const savedKeys = new Set(savedQueries.flatMap((query) => query.data ?? []));
  const like = useMutation({
    mutationFn: ({ id, liked }: { id: string; liked: boolean }) => likeActivity(id, liked),
    onSuccess: (value, { id }) => {
      queryClient.setQueriesData<Record<string, ActivityEngagement>>({ queryKey: [...ENGAGEMENT_QUERY_KEY, user?.id] }, (data) => data?.[id] ? { ...data, [id]: value } : data);
    }
  });
  const save = useMutation({
    mutationFn: ({ item, saved }: { item: DigestItem; saved: boolean }) => {
      const ref = savedContentRef(item);
      if (!ref) throw new Error("This item cannot be saved for later.");
      return saveContent(ref, saved);
    },
    onSuccess: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: SAVED_STATE_QUERY_KEY }), queryClient.invalidateQueries({ queryKey: SAVED_QUERY_KEY })]); }
  });
  const want = useMutation({
    mutationFn: (item: Extract<DigestItem, { kind: "reading" }>) => addBookToLibrary({ ...toRecommendation(item.book, 0), preserveExisting: true }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEY }); }
  });
  const share = useMutation({ mutationFn: async (item: DigestItem) => {
    const path = feedShareTarget(item);
    if (!path) throw new Error("This game has no public share link.");
    const url = await publicContentUrl(path);
    const row = feedRowModel(item, locale);
    await Share.share({ message: url, title: row.title || "Atmyshelf" });
  } });
  function clearErrors() { if (like.isError) like.reset(); if (save.isError) save.reset(); if (want.isError) want.reset(); if (share.isError) share.reset(); }
  const error = like.error ?? save.error ?? want.error ?? share.error;
  return {
    library, engagement, savedKeys,
    savedReady: savedQueries.every((query) => query.isSuccess),
    error: error ? saveFailureMessage(error, "Couldn't complete that action.") : engagementQueries.some((query) => query.isError) ? "Couldn't load reactions. Pull to refresh." : savedQueries.some((query) => query.isError) ? "Couldn't load saved items. Pull to refresh." : null,
    liking: like.isPending, saving: save.isPending, wanting: want.isPending,
    toggleLike: (item: DigestItem) => { clearErrors(); like.mutate({ id: item.id, liked: !engagement[item.id]?.liked }); },
    toggleSaved: (item: DigestItem, saved: boolean) => { clearErrors(); save.mutate({ item, saved: !saved }); },
    wantToRead: (item: Extract<DigestItem, { kind: "reading" }>) => { clearErrors(); want.mutate(item); },
    share: (item: DigestItem) => { clearErrors(); share.mutate(item); }
  };
}

export type HomeActions = ReturnType<typeof useHomeActions>;
