import { useState } from "react";
import { aggregate, AGGREGATION_MODES, type AggregationMode, type HistogramCell } from "@scripta/shared";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { Button, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { keyOf, type TierBook } from "./TierBoard";

export function TierlistResults({ histogram, tiers, pool, books, ballotCount }: { histogram: HistogramCell[]; tiers: Array<{ id: string; label: string; color: string }>; pool: string[]; books: TierBook[]; ballotCount: number }) {
  const { colors } = useTheme();
  const [mode, setMode] = useState<AggregationMode>("average");
  const results = aggregate(histogram, tiers.map((tier) => tier.id), pool, mode);
  const byKey = new Map(books.map((book) => [keyOf(book), book]));
  return <View style={styles.root}>
    <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{ballotCount} {ballotCount === 1 ? "ballot" : "ballots"}</Text>
    <View style={styles.modes}>{AGGREGATION_MODES.map((item) => <Button key={item.mode} label={item.label} variant={mode === item.mode ? "primary" : "secondary"} onPress={() => setMode(item.mode)} />)}</View>
    <FlatList
      data={[...tiers, { id: "", label: "Nobody ranked these", color: colors.textDim }]}
      keyExtractor={(tier) => tier.id || "unranked"}
      contentContainerStyle={styles.rows}
      renderItem={({ item: tier }) => {
        const rows = results.filter((result) => tier.id ? result.tierId === tier.id : result.tierId === null);
        return <View style={[styles.row, { borderColor: colors.border }]}><View style={[styles.label, { backgroundColor: tier.color }]}><Text numberOfLines={2} {...dynamicType} style={[typography.body, styles.strong, { color: "#fff" }]}>{tier.label}</Text></View><FlatList horizontal data={rows} keyExtractor={(result) => result.bookKey} contentContainerStyle={styles.books} ListEmptyComponent={<Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>No books.</Text>} renderItem={({ item }) => { const book = byKey.get(item.bookKey); return <View style={styles.result}><Text numberOfLines={2} {...dynamicType} style={[typography.caption, styles.strong, { color: colors.text }]}>{String(book?.Title ?? book?.title ?? "Book")}</Text><Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{item.votes} votes · {Math.round((1 - item.spread) * 100)}% agree</Text></View>; }} /></View>;
      }}
    />
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, gap: spacing.md },
  modes: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  rows: { gap: spacing.sm },
  row: { minHeight: 88, borderWidth: 1, borderRadius: radii.md, flexDirection: "row", overflow: "hidden" },
  label: { width: 72, alignItems: "center", justifyContent: "center", padding: spacing.xs },
  books: { alignItems: "center", gap: spacing.sm, padding: spacing.sm },
  result: { width: 110 },
  strong: { fontWeight: "700" },
});
