import { BottomSheet, RNHostView } from "@expo/ui";
import { useState } from "react";
import { FlatList, KeyboardAvoidingView, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Text } from "../../ui/Text";
import { Button, EmptyState, ErrorState, IconButton, Input, SheetHeader, Skeleton, dynamicType, minimumTouchTarget, spacing, typography, useTheme } from "../../ui";
import { AuthorAvatar } from "../community/AuthorAvatar";
import { useAuth } from "../../core/auth";
import { addActivityComment, deleteActivityComment, fetchActivityComments } from "../community/api";
import { useSkipEmptyPages } from "./FeedRow";
import { relativeTime } from "@scripta/shared/community";
import { ENGAGEMENT_QUERY_KEY } from "./useHomeActions";

export function CommentsSheet({ id, title, onClose }: { id: string; title: string; onClose: () => void }) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const key = ["community", "comments", user?.id, id];
  const [draft, setDraft] = useState("");
  const query = useInfiniteQuery({ queryKey: key, queryFn: ({ pageParam }) => fetchActivityComments(id, pageParam), initialPageParam: undefined as string | undefined, getNextPageParam: (last) => last.nextCursor ?? undefined });
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  useSkipEmptyPages(query, items.length);
  const refresh = async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: key }), queryClient.invalidateQueries({ queryKey: ENGAGEMENT_QUERY_KEY })]); };
  const send = useMutation({ mutationFn: () => addActivityComment(id, draft.trim()), onSuccess: async () => { setDraft(""); await refresh(); } });
  const remove = useMutation({ mutationFn: deleteActivityComment, onSuccess: refresh });
  const error = send.error ?? remove.error;
  return <BottomSheet isPresented onDismiss={onClose} snapPoints={["full"]} containerColor={colors.surface} contentPadding={0} shouldDismissOnBackPress={!send.isPending} shouldDismissOnClickOutside={!send.isPending}>
    <RNHostView><KeyboardAvoidingView behavior={process.env.EXPO_OS === "ios" ? "padding" : "height"} style={{ width: Math.min(width, 560), alignSelf: "center", flexGrow: 1, height: 0, paddingHorizontal: spacing.lg, paddingBottom: Math.max(insets.bottom, spacing.lg) }}>
      <SheetHeader title="Comments" onClose={onClose} />
      <Text {...dynamicType} style={[typography.caption, { color: colors.textDim, paddingBottom: spacing.md }]}>{title}</Text>
      <FlatList style={styles.list} data={items} keyExtractor={(item) => item.id} keyboardShouldPersistTaps="handled" renderItem={({ item }) => <View style={[styles.comment, { borderBottomColor: colors.border }]}>
        <AuthorAvatar username={item.author.username} avatarUrl={item.author.avatarUrl} />
        <View style={styles.copy}><Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{item.author.username} · {relativeTime(item.createdAt)}</Text><Text selectable {...dynamicType} style={[typography.body, { color: colors.text }]}>{item.text}</Text></View>
        {item.own ? <IconButton name="delete" accessibilityLabel="Delete your comment" disabled={remove.isPending} onPress={() => remove.mutate(item.id)} /> : null}
      </View>} ListEmptyComponent={query.isPending ? <Skeleton height={80} /> : query.isError ? <ErrorState body="Couldn't load comments." actionLabel="Retry" onAction={() => void query.refetch()} /> : query.hasNextPage ? undefined : <EmptyState title="Start the conversation" body="Be the first to comment." />} ListFooterComponent={query.isFetchingNextPage ? <Skeleton height={48} /> : query.isFetchNextPageError ? <ErrorState body="Couldn't load more comments." actionLabel="Retry" onAction={() => void query.fetchNextPage()} /> : undefined} onEndReached={() => { if (query.hasNextPage && !query.isFetchingNextPage && !query.isFetchNextPageError) void query.fetchNextPage(); }} />
      {error ? <Text accessibilityRole="alert" style={{ color: colors.danger }}>{error instanceof Error ? error.message : "Couldn't save your comment."}</Text> : null}
      <View style={styles.composer}><Input accessibilityLabel="Your comment" placeholder="Write a comment…" multiline numberOfLines={3} style={{ minHeight: minimumTouchTarget + 2, maxHeight: 120 }} maxLength={1500} value={draft} editable={!send.isPending} onChangeText={setDraft} /><Button label="Post comment" loading={send.isPending} disabled={!draft.trim() || send.isPending} onPress={() => send.mutate()} /></View>
    </KeyboardAvoidingView></RNHostView>
  </BottomSheet>;
}

const styles = StyleSheet.create({ list: { flex: 1 }, comment: { flexDirection: "row", gap: spacing.sm, paddingVertical: spacing.md, borderBottomWidth: 1 }, copy: { flex: 1, gap: spacing.xs }, composer: { gap: spacing.sm, paddingTop: spacing.sm } });
