import { BottomSheet, RNHostView } from "@expo/ui";
import { FlatList, View, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useInfiniteQuery } from "@tanstack/react-query";
import { EmptyState, ErrorState, SheetHeader, Skeleton, Toast, spacing, useTheme } from "../../ui";
import { useAuth } from "../../core/auth";
import { openProfile } from "../community/AuthorAvatar";
import { fetchSavedContent } from "../community/api";
import { FeedRow, useSkipEmptyPages } from "./FeedRow";
import { digestRoute } from "./feedRowModel";
import { SAVED_QUERY_KEY, type HomeActions } from "./useHomeActions";

export function SavedContentSheet({ actions, onClose }: { actions: HomeActions; onClose: () => void }) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const query = useInfiniteQuery({ queryKey: [...SAVED_QUERY_KEY, user?.id], queryFn: ({ pageParam }) => fetchSavedContent(pageParam), initialPageParam: undefined as string | undefined, getNextPageParam: (last) => last.nextCursor ?? undefined });
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  useSkipEmptyPages(query, items.length);
  return <BottomSheet isPresented onDismiss={onClose} snapPoints={["full"]} containerColor={colors.background} contentPadding={0}>
    <RNHostView><View style={{ width: Math.min(width, 560), alignSelf: "center", flexGrow: 1, height: 0, paddingBottom: Math.max(insets.bottom, spacing.lg) }}>
      <View style={{ paddingHorizontal: spacing.lg }}><SheetHeader title="Saved for later" onClose={onClose} /></View>
      {actions.error ? <Toast visible message={actions.error} tone="error" /> : null}
      <FlatList style={{ flex: 1 }} contentContainerStyle={{ paddingTop: spacing.sm, paddingBottom: spacing.md }} data={items} keyExtractor={(item) => `${item.kind}:${item.id}`} renderItem={({ item }) => <FeedRow item={item} actions={actions} isSaved onOpen={() => { onClose(); router.push(digestRoute(item) as never); }} onOpenProfile={(username) => { onClose(); openProfile(username); }} />} ListEmptyComponent={query.isPending ? <Skeleton height={80} /> : query.isError ? <ErrorState body="Couldn't load saved items." actionLabel="Retry" onAction={() => void query.refetch()} /> : query.hasNextPage ? null : <EmptyState title="Nothing saved yet" body="Bookmark a game or mural to find it here." />} ListFooterComponent={query.isFetchingNextPage ? <Skeleton height={48} /> : query.isFetchNextPageError ? <ErrorState body="Couldn't load more saved items." actionLabel="Retry" onAction={() => void query.fetchNextPage()} /> : null} onEndReached={() => { if (query.hasNextPage && !query.isFetchingNextPage && !query.isFetchNextPageError) void query.fetchNextPage(); }} />
    </View></RNHostView>
  </BottomSheet>;
}
