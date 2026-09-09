import { useQuery } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Button, EmptyState, ErrorState, Screen, Skeleton, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { fetchPublicTierlists } from "../tierlists/api";
import { fetchPublicTournaments } from "./api";

type PublicItem = { key: string; name: string; detail: string; kind: "tournament" | "tierlist"; target: string };

export function ArenaPublicListScreen() {
  const { colors } = useTheme();
  const tournaments = useQuery({ queryKey: ["arena", "public"], queryFn: fetchPublicTournaments, retry: false });
  const tierlists = useQuery({ queryKey: ["tierlists", "public"], queryFn: fetchPublicTierlists, retry: false });
  const items: PublicItem[] = [...(tournaments.data ?? []).map((item) => ({ key: `a:${item.id}`, name: item.name, detail: `${item.bracketSize} books · ${item.status}`, kind: "tournament" as const, target: `/arena/${item.id}` })), ...(tierlists.data ?? []).map((item) => ({ key: `t:${item.voteCode}`, name: item.name, detail: `${item.poolSize} books · ${item.ballotCount} ballots${item.votingOpen ? "" : " · closed"}`, kind: "tierlist" as const, target: `/vote/${item.voteCode}` }))];
  const pending = tournaments.isPending || tierlists.isPending;
  const failed = tournaments.isError || tierlists.isError;
  return <Screen bottom top={false} style={styles.screen}>
    <Stack.Screen options={{ headerShown: true, title: "BookArena" }} />
    <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>Vote in public brackets and tier lists.</Text>
    {pending ? <Skeleton height={180} /> : failed ? <ErrorState body="The public arena couldn't be loaded." actionLabel="Retry" onAction={() => { void tournaments.refetch(); void tierlists.refetch(); }} /> : <FlatList data={items} keyExtractor={(item) => item.key} contentContainerStyle={styles.list} ListEmptyComponent={<EmptyState title="Nothing public yet" body="Check back later for new votes." />} renderItem={({ item }) => <Pressable accessibilityLabel={`Open ${item.name}`} accessibilityRole="link" onPress={() => router.push(item.target as never)} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}><Text {...dynamicType} style={[typography.caption, styles.strong, { color: colors.accent }]}>{item.kind === "tournament" ? "Tournament" : "Tier list"}</Text><Text numberOfLines={1} {...dynamicType} style={[typography.title, styles.strong, { color: colors.text }]}>{item.name}</Text><Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{item.detail}</Text></Pressable>} />}
  </Screen>;
}

const styles = StyleSheet.create({
  screen: { padding: spacing.lg, gap: spacing.lg },
  grow: { flex: 1 },
  strong: { fontWeight: "700" },
  list: { gap: spacing.sm, paddingBottom: spacing.huge },
  card: { borderWidth: 1, borderRadius: radii.lg, padding: spacing.md, gap: spacing.xs },
});
