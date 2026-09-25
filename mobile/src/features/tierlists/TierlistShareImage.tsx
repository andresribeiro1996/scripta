import { useEffect, useState } from "react";
import { AGGREGATION_MODES, type AggregationMode, type HistogramCell, type TierlistData } from "@scripta/shared";
import { Text, View } from "react-native";
import { radii, spacing, typography, useTheme } from "../../ui";
import { keyOf, TierCover, type TierBook } from "./TierBoard";
import { tierlistShareRows } from "./tierlistShareData";

export function TierlistShareImage({ title, data, books, community, histogram, ballotCount, mode = "average", onReadyChange }: {
  title: string;
  data: TierlistData;
  books: TierBook[];
  community?: boolean;
  histogram?: HistogramCell[];
  ballotCount?: number;
  mode?: AggregationMode;
  onReadyChange?: (ready: boolean) => void;
}) {
  const { colors } = useTheme();
  const [loaded, setLoaded] = useState<Set<string>>(() => new Set());
  const byKey = new Map(books.map((book) => [keyOf(book), book]));
  const { tiers: rows, extra } = tierlistShareRows(data, community ? histogram : undefined, mode);
  const expected = new Set([...rows.flatMap((row) => row.bookKeys), ...extra].filter((key) => byKey.has(key)));
  useEffect(() => { onReadyChange?.([...expected].every((key) => loaded.has(key))); }, [loaded, onReadyChange, [...expected].join("|")]);
  const cover = (key: string) => byKey.has(key) ? <TierCover key={key} book={byKey.get(key)!} style={{ width: 42, height: 63 }} onLoadEnd={() => setLoaded((current) => current.has(key) ? current : new Set(current).add(key))} /> : <View key={key} style={{ width: 42, height: 63, justifyContent: "center", backgroundColor: colors.accentSoft, padding: 2 }}><Text style={{ color: colors.textDim, fontSize: 8, textAlign: "center" }}>Book unavailable</Text></View>;

  return <View style={{ width: "100%", padding: spacing.lg, gap: spacing.md, backgroundColor: colors.background }}>
    <View style={{ gap: spacing.xs }}>
      <Text style={[typography.title, { color: colors.text }]}>{title}</Text>
      <Text style={[typography.caption, { color: colors.textDim }]}>{community ? `Community ranking · ${ballotCount ?? 0} ${(ballotCount ?? 0) === 1 ? "vote" : "votes"} · ${AGGREGATION_MODES.find((item) => item.mode === mode)?.label ?? "Average"} · ${new Date().toLocaleDateString()}` : "My ranking"}</Text>
    </View>
    <View style={{ borderRadius: radii.md, overflow: "hidden" }}>
      {rows.map((tier) => <View key={tier.id} style={{ flexDirection: "row", minHeight: 71, backgroundColor: colors.surface }}>
        <View style={{ width: 45, backgroundColor: tier.color, alignItems: "center", justifyContent: "center", padding: 2 }}><Text numberOfLines={3} style={[typography.caption, { color: "#fff", fontWeight: "700", textAlign: "center" }]}>{tier.label}</Text></View>
        <View style={{ flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 3, padding: 4 }}>{tier.bookKeys.map(cover)}</View>
      </View>)}
    </View>
    {extra.length ? <View style={{ gap: spacing.xs }}>
      <Text style={[typography.caption, { color: colors.textDim }]}>{community ? "No votes" : "Unranked"} · {extra.length}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 3 }}>{extra.map(cover)}</View>
    </View> : null}
    <View style={{ borderTopWidth: 1, borderColor: colors.border, paddingTop: spacing.md }}>
      <Text style={[typography.caption, { color: colors.textDim, textAlign: "right" }]}>Created with: <Text style={{ color: colors.text, fontWeight: "600" }}>Atmyshelf</Text></Text>
    </View>
  </View>;
}
