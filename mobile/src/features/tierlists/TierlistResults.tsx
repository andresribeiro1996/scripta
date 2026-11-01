import { RankingMethodSelector } from "./RankingMethodSelector";
import { useEffect, useRef, useState } from "react";
import { aggregate, aggregationModes, booksByWork, isCharacterBook, itemNoun, type AggregationMode, type HistogramCell } from "@scripta/shared";
import { router, useSegments } from "expo-router";
import { Pressable, ScrollView, StyleSheet, View, type ScrollViewInstance } from "react-native";
import { Text } from "../../ui/Text";
import { Button, Sheet, captionHitSlop, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { workPath } from "../works/workPath";
import { TierCover, TierHead, TierRowScroll } from "./TierBoard";
import { authorOf, titleOf, type TierBook } from "./tierBook";
import { useLocale, useT, type MessageKey } from "../../i18n";

const descriptions: Record<AggregationMode, MessageKey> = {
  average: "tierlists.descriptionAverage",
  plurality: "tierlists.descriptionPlurality",
  median: "tierlists.descriptionMedian",
};

export function TierlistResults({ histogram, tiers, pool, books, ballotCount, eligibleVoteCount, votingOpen, promoted, ownPlacements = [], active = true, mode = "average", onModeChange }: {
  histogram: HistogramCell[];
  tiers: Array<{ id: string; label: string; color: string }>;
  pool: string[];
  books: TierBook[];
  ballotCount: number;
  eligibleVoteCount?: number;
  votingOpen?: boolean;
  promoted?: boolean;
  ownPlacements?: Array<{ workId: string; tierId: string }>;
  active?: boolean;
  mode?: AggregationMode;
  onModeChange?: (mode: AggregationMode) => void;
}) {
  const locale = useLocale();
  const t = useT();
  const { colors } = useTheme();
  const segments = useSegments();
  const boardScroll = useRef<ScrollViewInstance>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [showMine, setShowMine] = useState(false);
  const [explain, setExplain] = useState(false);
  const [explainProgress, setExplainProgress] = useState(false);
  const results = aggregate(histogram, tiers.map((tier) => tier.id), pool, mode);
  const byWork = booksByWork(books);
  const character = books.some(isCharacterBook);
  const noun = itemNoun(character, 1, locale);
  const mine = new Map(ownPlacements.map(({ workId, tierId }) => [workId, tierId]));
  const votedBooks = results.filter((result) => result.votes > 0).length;
  const unrankedBooks = results.filter((result) => result.tierId === null);
  const detail = results.find((result) => result.workId === selected);
  const detailBook = detail ? byWork.get(detail.workId) : undefined;
  const detailTier = tiers.find((tier) => tier.id === detail?.tierId);
  const myTier = tiers.find((tier) => tier.id === (selected ? mine.get(selected) : undefined));
  const counts = tiers.map((tier) => histogram.filter((cell) => cell.workId === selected && cell.tierId === tier.id).reduce((sum, cell) => sum + cell.votes, 0));
  const topCount = Math.max(...counts, 0);
  const small = detail !== undefined && detail.votes > 0 && detail.votes < 5;
  const tied = topCount > 0 && counts.filter((count) => count === topCount).length > 1;
  useEffect(() => { if (active) boardScroll.current?.scrollTo({ y: 0, animated: false }); }, [active]);

  function renderBooks(rows: typeof results) {
    return <TierRowScroll contentContainerStyle={styles.books}>
      {rows.length ? rows.map((result) => {
        const book = byWork.get(result.workId);
        const personal = tiers.find((item) => item.id === mine.get(result.workId));
        return <Pressable key={result.workId} accessibilityRole="button" accessibilityLabel={t(personal ? "tierlists.voteRowLabelWithRank" : "tierlists.voteRowLabel", { title: book ? titleOf(book, locale) : noun, count: result.votes, rank: personal?.label ?? "" })} onPress={() => setSelected(result.workId)} style={styles.book}>
          {book ? <TierCover book={book} /> : <Text style={[typography.caption, { color: colors.text }]}>{noun}</Text>}
          {showMine && personal ? <View style={[styles.badge, { backgroundColor: colors.surface }]}><Text style={[typography.caption, { color: colors.text }]}>{t("tierlists.youRank", { label: personal.label })}</Text></View> : null}
        </Pressable>;
      }) : <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>–</Text>}
    </TierRowScroll>;
  }

  return <View style={styles.root}>
    <TierHead>
    <View style={styles.summary}><Text {...dynamicType} style={[typography.caption, styles.strong, { color: colors.text }]}>{t("tierlists.voteCount", { count: ballotCount })}</Text><Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{t("tierlists.summaryLine", { progress: t(character ? "tierlists.votedOfCharacters" : "tierlists.votedOfBooks", { voted: votedBooks, total: pool.length }), status: t(promoted ? "tierlists.reference" : votingOpen === undefined ? "tierlists.community" : votingOpen ? "tierlists.votingOpen" : "tierlists.votingClosed") })}</Text></View>
    {(eligibleVoteCount !== undefined && !promoted || ownPlacements.length > 0) ? <View style={styles.metaActions}>
      {eligibleVoteCount !== undefined && !promoted ? <Pressable accessibilityRole="button" accessibilityLabel={t("tierlists.eligibleLabel", { count: eligibleVoteCount })} hitSlop={captionHitSlop} onPress={() => setExplainProgress(true)}><Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{t("tierlists.eligibleShort", { count: eligibleVoteCount })}</Text></Pressable> : null}
      {ownPlacements.length ? <Pressable accessibilityRole="switch" accessibilityState={{ checked: showMine }} hitSlop={captionHitSlop} onPress={() => setShowMine(!showMine)} style={styles.toggle}><Text {...dynamicType} style={[typography.caption, { color: colors.text }]}>{t("tierlists.myRanks")}</Text><Text {...dynamicType} style={[typography.caption, { color: colors.accent }]}>{t(showMine ? "tierlists.on" : "tierlists.off")}</Text></Pressable> : null}
    </View> : null}
    </TierHead>
    <ScrollView ref={boardScroll} style={styles.board} contentContainerStyle={styles.rows}>
      {ballotCount === 0 ? <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{t("tierlists.noVotesYet")}</Text> : null}
      {tiers.map((tier, index) => {
        const rows = results.filter((result) => result.tierId === tier.id);
        return <View key={tier.id} style={[styles.row, { backgroundColor: colors.surface }, index === 0 && styles.topCorners, index === tiers.length - 1 && styles.bottomCorners]}>
          <View style={[styles.label, { backgroundColor: tier.color }]}><Text numberOfLines={3} {...dynamicType} style={[typography.caption, styles.strong, styles.center, { color: "#fff" }]}>{tier.label}</Text></View>
          {renderBooks(rows)}
        </View>;
      })}
      {unrankedBooks.length ? <View style={styles.footer}><Text {...dynamicType} style={[typography.caption, styles.strong, { color: colors.textDim }]}>{t("tierlists.noVotesCount", { count: unrankedBooks.length })}</Text>{renderBooks(unrankedBooks)}</View> : null}
    </ScrollView>
    <View style={[styles.dock, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <RankingMethodSelector mode={mode} onChange={(next) => onModeChange?.(next)} />
      <Pressable accessibilityRole="button" accessibilityLabel={t("tierlists.aboutRankingMethods")} onPress={() => setExplain(true)} style={styles.infoButton}><Text {...dynamicType} style={[typography.body, { color: colors.accent }]}>ⓘ</Text></Pressable>
    </View>
    <Sheet visible={explain} title={t("tierlists.rankingMethods")} onClose={() => setExplain(false)}><View style={styles.detailBody}>{aggregationModes(locale).map((item) => <Text key={item.mode} {...dynamicType} style={[typography.body, { color: colors.text }]}><Text style={styles.strong}>{item.label}: </Text>{t(descriptions[item.mode])}</Text>)}</View></Sheet>
    <Sheet visible={explainProgress} title={t("tierlists.referenceStatus")} onClose={() => setExplainProgress(false)}><Text {...dynamicType} style={[typography.body, { color: colors.text }]}>{t("tierlists.referenceStatusBody")}</Text></Sheet>
    <Sheet visible={detail !== undefined} title={t(character ? "tierlists.characterVotes" : "tierlists.bookVotes")} onClose={() => setSelected(null)}>
      {detail && <ScrollView contentContainerStyle={styles.detailBody}>
        <View style={styles.detailHead}>{detailBook ? <TierCover book={detailBook} style={styles.detailCover} /> : null}<View style={styles.detailText}><Text {...dynamicType} style={[typography.title, { color: colors.text }]}>{detailBook ? titleOf(detailBook, locale) : noun}</Text><Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{detailBook ? authorOf(detailBook, locale) : ""}</Text><Text {...dynamicType} style={[typography.body, { color: colors.text }]}>{t(detailTier ? myTier ? "tierlists.communityTierMine" : "tierlists.communityTier" : myTier ? "tierlists.noCommunityTierMine" : "tierlists.noCommunityTier", { tier: detailTier?.label ?? "", mine: myTier?.label ?? "" })}</Text></View></View>
        <Text {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>{t("tierlists.howReadersVoted")}</Text>
        <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{t(character ? small ? "tierlists.rankedThisCharacterSmall" : "tierlists.rankedThisCharacter" : small ? "tierlists.rankedThisBookSmall" : "tierlists.rankedThisBook", { votes: detail.votes, ballots: ballotCount })}</Text>
        {tied ? <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{t("tierlists.tie")}</Text> : null}
        {tiers.map((tier, index) => <View key={tier.id} style={styles.histRow}><View style={[styles.histLabel, { backgroundColor: tier.color }]}><Text style={[typography.caption, { color: "#fff" }]}>{tier.label}</Text></View><View style={[styles.histTrack, { backgroundColor: colors.background }]}><View style={{ flex: detail.votes ? counts[index]! / detail.votes : 0, backgroundColor: tier.color }} /></View><Text {...dynamicType} style={[typography.caption, styles.histCount, { color: colors.text }]}>{counts[index]} ({detail.votes ? Math.round(counts[index]! / detail.votes * 100) : 0}%)</Text></View>)}
        {detailTier && detail.votes > 0 ? <Text {...dynamicType} style={[typography.body, styles.center, { color: colors.accent }]}>{t("tierlists.choseTier", { percent: Math.round((1 - detail.spread) * 100), tier: detailTier.label })}</Text> : null}
        {character ? null : <Button label={t("tierlists.aboutThisBook")} variant="secondary" onPress={() => { setSelected(null); router.push(workPath(detail.workId, segments) as never); }} />}
      </ScrollView>}
    </Sheet>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, gap: spacing.sm, paddingTop: spacing.lg },
  summary: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: spacing.sm },
  metaActions: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm },
  toggle: { flexDirection: "row", gap: spacing.xs },
  board: { flex: 1, marginTop: spacing.md },
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
