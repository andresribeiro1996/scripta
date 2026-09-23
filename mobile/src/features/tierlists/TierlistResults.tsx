import { useEffect, useRef, useState } from "react";
import { aggregate, AGGREGATION_MODES, type AggregationMode, type HistogramCell } from "@scripta/shared";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Sheet, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { authorOf, keyOf, TierCover, titleOf, type TierBook } from "./TierBoard";

const descriptions: Record<AggregationMode, string> = {
  average: "Balances every vote into a tier.",
  plurality: "Uses the tier with the most votes.",
  median: "Uses the middle vote in tier order.",
};

export function TierlistResults({ histogram, tiers, pool, books, ballotCount, eligibleVoteCount, votingOpen, promoted, ownPlacements = [], active = true }: {
  histogram: HistogramCell[];
  tiers: Array<{ id: string; label: string; color: string }>;
  pool: string[];
  books: TierBook[];
  ballotCount: number;
  eligibleVoteCount?: number;
  votingOpen?: boolean;
  promoted?: boolean;
  ownPlacements?: Array<{ bookKey: string; tierId: string }>;
  active?: boolean;
}) {
  const { colors } = useTheme();
  const boardScroll = useRef<ScrollView>(null);
  const [mode, setMode] = useState<AggregationMode>("average");
  const [selected, setSelected] = useState<string | null>(null);
  const [showMine, setShowMine] = useState(false);
  const [explain, setExplain] = useState(false);
  const [explainProgress, setExplainProgress] = useState(false);
  const results = aggregate(histogram, tiers.map((tier) => tier.id), pool, mode);
  const byKey = new Map(books.map((book) => [keyOf(book), book]));
  const mine = new Map(ownPlacements.map(({ bookKey, tierId }) => [bookKey, tierId]));
  const votedBooks = results.filter((result) => result.votes > 0).length;
  const unrankedBooks = results.filter((result) => result.tierId === null);
  const detail = results.find((result) => result.bookKey === selected);
  const detailBook = detail ? byKey.get(detail.bookKey) : undefined;
  const detailTier = tiers.find((tier) => tier.id === detail?.tierId);
  const myTier = tiers.find((tier) => tier.id === (selected ? mine.get(selected) : undefined));
  const counts = tiers.map((tier) => histogram.filter((cell) => cell.bookKey === selected && cell.tierId === tier.id).reduce((sum, cell) => sum + cell.votes, 0));
  const topCount = Math.max(...counts, 0);
  const tied = topCount > 0 && counts.filter((count) => count === topCount).length > 1;
  useEffect(() => { if (active) boardScroll.current?.scrollTo({ y: 0, animated: false }); }, [active]);

  function renderBooks(rows: typeof results) {
    return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.books}>
      {rows.length ? rows.map((result) => {
        const book = byKey.get(result.bookKey);
        const personal = tiers.find((item) => item.id === mine.get(result.bookKey));
        return <Pressable key={result.bookKey} accessibilityRole="button" accessibilityLabel={`${book ? titleOf(book) : "Book"}, ${result.votes} ${result.votes === 1 ? "vote" : "votes"}${personal ? `, your rank ${personal.label}` : ""}. View vote details`} onPress={() => setSelected(result.bookKey)} style={styles.book}>
          {book ? <TierCover book={book} /> : <Text style={[typography.caption, { color: colors.text }]}>Book</Text>}
          {showMine && personal ? <View style={[styles.badge, { backgroundColor: colors.surface }]}><Text style={[typography.caption, { color: colors.text }]}>You: {personal.label}</Text></View> : null}
        </Pressable>;
      }) : <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>–</Text>}
    </ScrollView>;
  }

  return <View style={styles.root}>
    <View style={styles.summary}><Text {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>{ballotCount} {ballotCount === 1 ? "vote" : "votes"}</Text><Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{votedBooks}/{pool.length} books · {promoted ? "Reference" : votingOpen === undefined ? "Community" : votingOpen ? "Voting open" : "Voting closed"}</Text></View>
    {(eligibleVoteCount !== undefined && !promoted || ownPlacements.length > 0) ? <View style={styles.metaActions}>
      {eligibleVoteCount !== undefined && !promoted ? <Pressable accessibilityRole="button" accessibilityLabel={`${eligibleVoteCount} of 100 eligible voters toward reference status. Learn more`} onPress={() => setExplainProgress(true)} style={styles.metaButton}><Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{eligibleVoteCount}/100 eligible ⓘ</Text></Pressable> : null}
      {ownPlacements.length ? <Pressable accessibilityRole="switch" accessibilityState={{ checked: showMine }} onPress={() => setShowMine(!showMine)} style={styles.metaButton}><Text {...dynamicType} style={[typography.caption, { color: colors.text }]}>My ranks: <Text style={{ color: colors.accent }}>{showMine ? "On" : "Off"}</Text></Text></Pressable> : null}
    </View> : null}
    <ScrollView ref={boardScroll} style={styles.board} contentContainerStyle={styles.rows}>
      {ballotCount === 0 ? <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>No votes yet. Results will appear when someone submits votes.</Text> : null}
      {tiers.map((tier, index) => {
        const rows = results.filter((result) => result.tierId === tier.id);
        return <View key={tier.id} style={[styles.row, { backgroundColor: colors.surface }, index === 0 && styles.topCorners, index === tiers.length - 1 && styles.bottomCorners]}>
          <View style={[styles.label, { backgroundColor: tier.color }]}><Text numberOfLines={3} {...dynamicType} style={[typography.caption, styles.strong, styles.center, { color: "#fff" }]}>{tier.label}</Text></View>
          {renderBooks(rows)}
        </View>;
      })}
      {unrankedBooks.length ? <View style={styles.footer}><Text {...dynamicType} style={[typography.caption, styles.strong, { color: colors.textDim }]}>No votes · {unrankedBooks.length}</Text>{renderBooks(unrankedBooks)}</View> : null}
    </ScrollView>
    <View style={[styles.dock, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View accessibilityRole="radiogroup" accessibilityLabel="Ranking method" style={[styles.methods, { backgroundColor: colors.background }]}>{AGGREGATION_MODES.map((item) => <Pressable key={item.mode} accessibilityRole="radio" accessibilityState={{ checked: mode === item.mode }} onPress={() => setMode(item.mode)} style={[styles.method, mode === item.mode && { backgroundColor: colors.accentSoft }]}><Text numberOfLines={1} {...dynamicType} style={[typography.caption, styles.strong, { color: mode === item.mode ? colors.text : colors.textDim }]}>{item.label === "Most-voted" ? "Most voted" : item.label}</Text></Pressable>)}</View>
      <Pressable accessibilityRole="button" accessibilityLabel="About ranking methods" onPress={() => setExplain(true)} style={styles.infoButton}><Text {...dynamicType} style={[typography.body, { color: colors.accent }]}>ⓘ</Text></Pressable>
    </View>
    <Sheet visible={explain} title="Ranking methods" onClose={() => setExplain(false)}><View style={styles.detailBody}>{AGGREGATION_MODES.map((item) => <Text key={item.mode} {...dynamicType} style={[typography.body, { color: colors.text }]}><Text style={styles.strong}>{item.label}: </Text>{descriptions[item.mode]} Ties favour the higher tier.</Text>)}</View></Sheet>
    <Sheet visible={explainProgress} title="Reference status" onClose={() => setExplainProgress(false)}><Text {...dynamicType} style={[typography.body, { color: colors.text }]}>After 100 distinct signed-in voters other than the creator submit votes, this tier list becomes a permanent community reference. Anonymous votes still count in the results.</Text></Sheet>
    <Sheet visible={detail !== undefined} title="Book votes" onClose={() => setSelected(null)}>
      {detail && <ScrollView contentContainerStyle={styles.detailBody}>
        <View style={styles.detailHead}>{detailBook ? <TierCover book={detailBook} style={styles.detailCover} /> : null}<View style={styles.detailText}><Text {...dynamicType} style={[typography.title, { color: colors.text }]}>{detailBook ? titleOf(detailBook) : "Book"}</Text><Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{detailBook ? authorOf(detailBook) : ""}</Text><Text {...dynamicType} style={[typography.body, { color: colors.text }]}>{detailTier ? `Community tier ${detailTier.label}` : "No community tier yet"}{myTier ? ` · Your tier ${myTier.label}` : ""}</Text></View></View>
        <Text {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>How readers voted</Text>
        <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{detail.votes} of {ballotCount} participants ranked this book{detail.votes > 0 && detail.votes < 5 ? " · Small sample" : ""}</Text>
        {tied ? <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>Tie for most votes; ranking method determines the displayed tier.</Text> : null}
        {tiers.map((tier, index) => <View key={tier.id} style={styles.histRow}><View style={[styles.histLabel, { backgroundColor: tier.color }]}><Text style={[typography.caption, { color: "#fff" }]}>{tier.label}</Text></View><View style={[styles.histTrack, { backgroundColor: colors.background }]}><View style={{ flex: detail.votes ? counts[index]! / detail.votes : 0, backgroundColor: tier.color }} /></View><Text {...dynamicType} style={[typography.caption, styles.histCount, { color: colors.text }]}>{counts[index]} ({detail.votes ? Math.round(counts[index]! / detail.votes * 100) : 0}%)</Text></View>)}
        {detailTier && detail.votes > 0 ? <Text {...dynamicType} style={[typography.body, styles.center, { color: colors.accent }]}>{Math.round((1 - detail.spread) * 100)}% chose {detailTier.label}</Text> : null}
      </ScrollView>}
    </Sheet>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, gap: spacing.sm, paddingTop: spacing.md },
  summary: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: spacing.sm },
  metaActions: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm },
  metaButton: { minHeight: 44, justifyContent: "center" },
  board: { flex: 1 },
  rows: { paddingBottom: spacing.sm },
  row: { height: 84, flexDirection: "row", overflow: "hidden" },
  topCorners: { borderTopLeftRadius: radii.md, borderTopRightRadius: radii.md },
  bottomCorners: { borderBottomLeftRadius: radii.md, borderBottomRightRadius: radii.md },
  label: { width: 42, alignItems: "center", justifyContent: "center", padding: 2 },
  books: { alignItems: "stretch", gap: 2 },
  book: { height: 84, aspectRatio: 2 / 3 },
  footer: { gap: spacing.xs, paddingTop: spacing.sm },
  badge: { position: "absolute", bottom: 2, alignSelf: "center", paddingHorizontal: 3, borderRadius: radii.sm },
  dock: { flexDirection: "row", alignItems: "center", gap: spacing.xs, padding: spacing.xs, borderWidth: 1, borderRadius: radii.lg },
  methods: { flex: 1, flexDirection: "row", borderRadius: radii.md, padding: 2 },
  method: { flex: 1, minWidth: 0, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: radii.sm },
  infoButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  detailBody: { gap: spacing.md, paddingBottom: spacing.md },
  detailHead: { flexDirection: "row", gap: spacing.md },
  detailCover: { width: 100, height: 150, borderRadius: radii.sm },
  detailText: { flex: 1, gap: spacing.xs },
  histRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 28 },
  histLabel: { width: 34, minHeight: 28, alignItems: "center", justifyContent: "center", borderRadius: radii.sm },
  histTrack: { flex: 1, height: 15, flexDirection: "row", borderRadius: radii.full, overflow: "hidden" },
  histCount: { width: 64, textAlign: "right" },
  center: { textAlign: "center" },
  strong: { fontWeight: "700" },
});
