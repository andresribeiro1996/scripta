import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Button, EmptyState, ErrorState, Skeleton, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
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
  return <View style={[styles.screen, { backgroundColor: colors.background }]}>
    <View style={styles.header}><Button label="Back" variant="secondary" onPress={() => router.back()} /><View style={styles.grow}><Text accessibilityRole="header" {...dynamicType} style={[typography.heading, styles.strong, { color: colors.text }]}>BookArena</Text><Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>Vote in public brackets and tier lists.</Text></View></View>
    {pending ? <Skeleton height={180} /> : failed ? <ErrorState body="The public arena couldn't be loaded." actionLabel="Retry" onAction={() => { void tournaments.refetch(); void tierlists.refetch(); }} /> : <FlatList data={items} keyExtractor={(item) => item.key} contentContainerStyle={styles.list} ListEmptyComponent={<EmptyState title="Nothing public yet" body="Check back later for new votes." />} renderItem={({ item }) => <Pressable accessibilityRole="link" onPress={() => router.push(item.target as never)} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}><Text {...dynamicType} style={[typography.caption, styles.strong, { color: colors.accent }]}>{item.kind === "tournament" ? "Tournament" : "Tier list"}</Text><Text numberOfLines={1} {...dynamicType} style={[typography.title, styles.strong, { color: colors.text }]}>{item.name}</Text><Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{item.detail}</Text></Pressable>} />}
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: spacing.lg, paddingTop: spacing.huge, gap: spacing.lg },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  grow: { flex: 1 },
  strong: { fontWeight: "700" },
  list: { gap: spacing.sm, paddingBottom: spacing.huge },
  card: { borderWidth: 1, borderRadius: radii.lg, padding: spacing.md, gap: spacing.xs },
});
