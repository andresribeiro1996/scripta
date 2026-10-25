import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import Animated, { useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, type SharedValue } from "react-native-reanimated";
import { Text } from "../../ui/Text";
import { bracketShape, countdownLabel, duelWinner, needsVote, roundLabel, type BracketSlot, type Duel, type DuelSide } from "@scripta/shared";
import { Icon, Sheet, dynamicType, minimumTouchTarget, radii, spacing, typography, useTheme } from "../../ui";
import { BookCover } from "./BookCover";
import { DuelSideRow } from "./DuelSideRow";
import { BRACKET_MATCH_WIDTH, bracketMapLayout } from "./arenaView";
import type { TournamentView } from "./api";

function MatchSide({ side, isWinner, decided, onPick, busy, coverWidth }: { side: DuelSide; isWinner: boolean; decided: boolean; onPick?: () => void; busy: boolean; coverWidth: number }) {
  const { colors } = useTheme();
  return (
    <View style={styles.tileSide}>
      <View style={[styles.tileCoverOuter, { width: coverWidth }]}>
        <View style={[styles.tileCoverImage, isWinner ? { borderColor: colors.accent, borderWidth: 2 } : null, decided && !isWinner ? styles.loserCover : null]}>
          <BookCover cover={side.cover} title={side.title} fill />
        </View>
      </View>
      <Text {...dynamicType} numberOfLines={2} style={[typography.caption, styles.bookTitle, isWinner && styles.bold, { color: colors.text }]}>{side.title}</Text>
      <View style={styles.sideResult}>
        {isWinner ? <><Icon name="confirm" size={12} color={colors.accent} /><Text {...dynamicType} style={[typography.caption, { color: colors.text }]}>Winner</Text></> : null}
      </View>
      {onPick ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${side.title} wins the tiebreak`}
          disabled={busy}
          onPress={(event) => { event.stopPropagation(); onPick(); }}
          style={({ pressed }) => [styles.tiebreakPill, { backgroundColor: pressed ? colors.surfacePressed : colors.accentSoft, opacity: busy ? 0.5 : 1 }]}
        >
          <Text {...dynamicType} style={[typography.caption, styles.bold, styles.center, { color: colors.text }]}>Choose winner</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function EmptyTile({ coverWidth }: { coverWidth: number }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.tileCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.matchHeading}>
        <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>Awaiting winners</Text>
      </View>
      <View style={styles.tile}>
        <View style={styles.tileSide}>
          <View style={[styles.tileCoverOuter, { width: coverWidth }]}>
            <View style={[styles.tileCoverImage, styles.emptyCover, { backgroundColor: colors.border }]} />
          </View>
          <Text {...dynamicType} numberOfLines={2} style={[typography.caption, styles.bookTitle, { color: colors.textDim }]}>To be decided</Text>
          <View style={styles.sideResult} />
        </View>
        <View style={styles.vsWrap}>
          <Text {...dynamicType} style={[typography.caption, styles.vsLabel, { color: colors.textDim }]}>vs</Text>
        </View>
        <View style={styles.tileSide}>
          <View style={[styles.tileCoverOuter, { width: coverWidth }]}>
            <View style={[styles.tileCoverImage, styles.emptyCover, { backgroundColor: colors.border }]} />
          </View>
          <Text {...dynamicType} numberOfLines={2} style={[typography.caption, styles.bookTitle, { color: colors.textDim }]}>To be decided</Text>
          <View style={styles.sideResult} />
        </View>
      </View>
    </View>
  );
}

function MatchTile({
  duel,
  coverWidth,
  isOwner,
  busy,
  onOpen,
  onSettle,
  onTiebreak,
  isFinal = false,
}: {
  duel: BracketSlot;
  coverWidth: number;
  isOwner: boolean;
  busy: boolean;
  onOpen: (duel: Duel) => void;
  onSettle: (duelId: string) => void;
  onTiebreak: (duelId: string, workId: string) => void;
  isFinal?: boolean;
}) {
  const { colors } = useTheme();
  if (!duel) return <EmptyTile coverWidth={coverWidth} />;
  const decided = duel.status === "settled";
  const winner = duelWinner(duel);
  const tiebreak = isOwner && duel.status === "tied_pending_tiebreak";
  const stateLabel = duel.status === "active" ? (duel.hasVoted ? "Voted" : "Vote open") : decided ? "Settled" : "Tiebreak";
  const pick = (side: DuelSide) => {
    const workId = side.workId;
    return tiebreak && workId ? () => onTiebreak(duel.id, workId) : undefined;
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${duel.bookA.title} versus ${duel.bookB.title}${winner ? `, ${winner.title} won` : ""}`}
      onPress={() => onOpen(duel)}
      style={({ pressed }) => [styles.tileCard, { backgroundColor: pressed ? colors.surfacePressed : colors.surface, borderColor: isFinal ? colors.accent : colors.border }]}
    >
      <View style={styles.matchHeading}>
        <Text {...dynamicType} style={[typography.caption, styles.bold, styles.matchNumber, { color: colors.textDim }]}>Match {duel.duelIndex + 1}</Text>
        {isOwner && duel.status === "active" ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Settle this match now" disabled={busy} onPress={(event) => { event.stopPropagation(); onSettle(duel.id); }} style={({ pressed }) => [styles.settleButton, { backgroundColor: pressed ? colors.surfacePressed : colors.accentSoft, opacity: busy ? 0.5 : 1 }]}>
            <Text {...dynamicType} style={[typography.caption, styles.bold, { color: colors.text }]}>Settle</Text>
          </Pressable>
        ) : <Text {...dynamicType} style={[typography.caption, styles.matchState, { color: needsVote(duel) ? colors.accent : colors.textDim }]}>{stateLabel}</Text>}
      </View>
      <View style={styles.tile}>
        <MatchSide side={duel.bookA} isWinner={winner === duel.bookA} decided={decided} busy={busy} onPick={pick(duel.bookA)} coverWidth={coverWidth} />
        <View style={styles.vsWrap}>
          <Text {...dynamicType} style={[typography.caption, styles.vsLabel, { color: duel.status === "active" ? colors.accent : colors.textDim }]}>vs</Text>
        </View>
        <MatchSide side={duel.bookB} isWinner={winner === duel.bookB} decided={decided} busy={busy} onPick={pick(duel.bookB)} coverWidth={coverWidth} />
      </View>
    </Pressable>
  );
}

function RoundHeading({ title, detail, width, offset, isFinal = false }: { title: string; detail: string; width: number; offset: SharedValue<number>; isFinal?: boolean }) {
  const { colors } = useTheme();
  const pinned = useAnimatedStyle(() => ({ transform: [{ translateX: offset.get() }] }));
  return (
    <Animated.View style={[styles.roundHeading, { width }, pinned]}>
      <Text {...dynamicType} accessibilityRole="header" style={[typography.title, { color: isFinal ? colors.accent : colors.text }]}>{title}</Text>
      <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{detail}</Text>
    </Animated.View>
  );
}

function RoundRow({
  slots,
  label,
  mirrored,
  feedsInward,
  receivesFromOutside,
  coverWidth,
  viewportWidth,
  headingOffset,
  isOwner,
  busyDuelId,
  onOpen,
  onSettle,
  onTiebreak,
}: {
  slots: BracketSlot[];
  label: string;
  mirrored: boolean;
  feedsInward: boolean;
  receivesFromOutside: boolean;
  coverWidth: number;
  viewportWidth: number;
  headingOffset: SharedValue<number>;
  isOwner: boolean;
  busyDuelId: string | null;
  onOpen: (duel: Duel) => void;
  onSettle: (duelId: string) => void;
  onTiebreak: (duelId: string, workId: string) => void;
}) {
  const { colors } = useTheme();
  return (
    <View>
      <RoundHeading title={label} detail={`${slots.length} ${slots.length === 1 ? "match" : "matches"}`} width={viewportWidth} offset={headingOffset} />
      <View style={styles.row}>
        {slots.map((duel, i) => (
          <View key={`${label}-${i}`} style={styles.cell}>
            {receivesFromOutside ? (
              <View style={[styles.stub, { backgroundColor: colors.border }, mirrored ? styles.stubBottom : styles.stubTop]} />
            ) : null}
            <View style={styles.cellInner}>
              <MatchTile duel={duel} coverWidth={coverWidth} isOwner={isOwner} busy={busyDuelId === duel?.id} onOpen={onOpen} onSettle={onSettle} onTiebreak={onTiebreak} />
            </View>
            {feedsInward ? (
              <>
                <View style={[styles.stub, { backgroundColor: colors.border }, mirrored ? styles.stubTop : styles.stubBottom]} />
                {slots.length > 1 ? (
                  <View style={[styles.hLine, { backgroundColor: colors.border }, mirrored ? styles.hLineTop : styles.hLineBottom, i % 2 === 0 ? styles.hLineRight : styles.hLineLeft]} />
                ) : null}
              </>
            ) : null}
          </View>
        ))}
      </View>
    </View>
  );
}

export function BracketMap({
  tournament,
  isOwner,
  busyDuelId,
  onSettle,
  onTiebreak,
}: {
  tournament: TournamentView;
  isOwner: boolean;
  busyDuelId: string | null;
  onSettle: (duelId: string) => void;
  onTiebreak: (duelId: string, workId: string) => void;
}) {
  const { colors } = useTheme();
  const [openId, setOpenId] = useState<string | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const horizontal = useRef<ScrollView>(null);
  const headingOffset = useSharedValue(0);
  const onPan = useAnimatedScrollHandler((event) => { headingOffset.set(event.contentOffset.x); });
  const openDuel = openId ? (tournament.duels.find((d) => d.id === openId) ?? null) : null;

  const byRound = bracketShape(tournament.bracketSize, tournament.duels);
  const { width: mapWidth, coverWidths } = bracketMapLayout(byRound, viewportWidth);
  useEffect(() => {
    if (viewportWidth > 0) horizontal.current?.scrollTo({ x: (mapWidth - viewportWidth) / 2, animated: false });
  }, [mapWidth, viewportWidth]);
  if (byRound.length === 0) return null;

  const finalRound = byRound.at(-1)!;
  // A 2-book "bracket" is nothing but a final — only split off a centre
  // round when it can really halve into two sides.
  const hasCentre = finalRound.length === 1;
  const sideRounds = hasCentre ? byRound.slice(0, -1) : byRound;
  const top = sideRounds.map((slots) => slots.slice(0, Math.ceil(slots.length / 2)));
  const bottom = sideRounds.map((slots) => slots.slice(Math.ceil(slots.length / 2)));

  function labelFor(roundIdx: number): string {
    return roundLabel(byRound[roundIdx]!.length, roundIdx + 1);
  }

  const finalDuel = hasCentre ? finalRound[0] : null;
  const champion: DuelSide | null = finalDuel ? duelWinner(finalDuel) : null;
  const finalCoverWidth = coverWidths.at(-1)!;

  return (
    <View style={styles.map} onLayout={(event) => setViewportWidth(event.nativeEvent.layout.width)}>
      {mapWidth > viewportWidth ? <Text {...dynamicType} style={[typography.caption, styles.panHint, { color: colors.textDim }]}>Swipe sideways to explore the bracket</Text> : null}
      <Animated.ScrollView ref={horizontal} horizontal nestedScrollEnabled directionalLockEnabled onScroll={onPan} scrollEventThrottle={16} style={styles.horizontal}>
        <View style={{ width: mapWidth }}>
          {top.map((slots, roundIdx) => (
            <RoundRow
              key={`t-${roundIdx}`}
              slots={slots}
              label={labelFor(roundIdx)}
              mirrored={false}
              feedsInward={roundIdx < top.length - 1 || hasCentre}
              receivesFromOutside={roundIdx > 0}
              coverWidth={coverWidths[roundIdx]!}
              viewportWidth={viewportWidth}
              headingOffset={headingOffset}
              isOwner={isOwner}
              busyDuelId={busyDuelId}
              onOpen={(duel) => setOpenId(duel.id)}
              onSettle={onSettle}
              onTiebreak={onTiebreak}
            />
          ))}

          {hasCentre ? (
            <View>
              <RoundHeading title="Final" detail="The deciding match" width={viewportWidth} offset={headingOffset} isFinal />
              <View style={styles.finalCell}>
                <View style={[styles.stub, styles.stubTop, { backgroundColor: colors.border }]} />
                <View style={[styles.stub, styles.stubBottom, { backgroundColor: colors.border }]} />
                <View style={styles.cellInner}>
                  <MatchTile duel={finalDuel ?? null} isFinal coverWidth={finalCoverWidth} isOwner={isOwner} busy={busyDuelId === finalDuel?.id} onOpen={(duel) => setOpenId(duel.id)} onSettle={onSettle} onTiebreak={onTiebreak} />
                  {champion ? (
                    <View style={[styles.champion, { backgroundColor: colors.accentSoft }]}>
                      <Icon name="champion" size={20} color={colors.accent} />
                      <View style={styles.championText}>
                        <Text {...dynamicType} style={[typography.caption, { color: colors.text }]}>Tournament winner</Text>
                        <Text {...dynamicType} numberOfLines={2} style={[typography.body, styles.bold, { color: colors.text }]}>{champion.title}</Text>
                      </View>
                    </View>
                  ) : null}
                </View>
              </View>
            </View>
          ) : null}

          {[...bottom].reverse().map((slots, i) => {
            const roundIdx = bottom.length - 1 - i;
            return (
              <RoundRow
                key={`b-${roundIdx}`}
                slots={slots}
                label={labelFor(roundIdx)}
                mirrored
                feedsInward={roundIdx < bottom.length - 1 || hasCentre}
                receivesFromOutside={roundIdx > 0}
                coverWidth={coverWidths[roundIdx]!}
                viewportWidth={viewportWidth}
                headingOffset={headingOffset}
                isOwner={isOwner}
                busyDuelId={busyDuelId}
                onOpen={(duel) => setOpenId(duel.id)}
                onSettle={onSettle}
                onTiebreak={onTiebreak}
              />
            );
          })}
        </View>
      </Animated.ScrollView>

      {/* Read-only: bigger covers and the exact tallies a tile has no room
       *  for. Acting (vote, settle, tiebreak) happens on the tile itself,
       *  not here — see the file header. */}
      <Sheet visible={Boolean(openDuel)} title="Match" onClose={() => setOpenId(null)}>
        {openDuel ? (
          <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetBody}>
            <Text {...dynamicType} style={[typography.caption, styles.center, { color: colors.textDim }]}>
              Round {openDuel.roundNumber} · Match {openDuel.duelIndex + 1} · {openDuel.status === "active" ? countdownLabel(openDuel.closesAt) : openDuel.status === "tied_pending_tiebreak" ? "Owner tiebreak needed" : "Settled"}
            </Text>
            <DuelSideRow side={openDuel.bookA} duel={openDuel} onClose={() => setOpenId(null)} />
            <DuelSideRow side={openDuel.bookB} duel={openDuel} onClose={() => setOpenId(null)} />
          </ScrollView>
        ) : null}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  map: { gap: spacing.none },
  horizontal: { flexGrow: 0 },
  panHint: { textAlign: "center", paddingBottom: spacing.sm },
  row: { flexDirection: "row", alignItems: "stretch" },
  center: { textAlign: "center" },
  cell: { flex: 1, position: "relative", justifyContent: "center" },
  cellInner: { alignSelf: "center", width: BRACKET_MATCH_WIDTH + spacing.sm * 2, padding: spacing.sm },
  finalCell: { position: "relative", justifyContent: "center" },
  roundHeading: { alignItems: "center", paddingTop: spacing.lg, paddingBottom: spacing.md, gap: spacing.xs },
  stub: { position: "absolute", left: "50%", width: 1, height: 6 },
  stubTop: { top: 0 },
  stubBottom: { bottom: 0 },
  hLine: { position: "absolute", height: 1 },
  hLineTop: { top: 0 },
  hLineBottom: { bottom: 0 },
  hLineRight: { left: "50%", right: 0 },
  hLineLeft: { left: 0, right: "50%" },
  tileCard: { padding: spacing.md, gap: spacing.sm, borderWidth: 1, borderRadius: radii.lg },
  matchHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: spacing.xxl, gap: spacing.xs },
  matchState: { flexShrink: 1, textAlign: "right" },
  matchNumber: { flexShrink: 1 },
  tile: { flexDirection: "row", alignItems: "flex-start", justifyContent: "center" },
  vsWrap: { alignItems: "center", width: 24, paddingTop: spacing.xl },
  vsLabel: { fontWeight: "600" },
  tileSide: { width: 80, alignItems: "center", gap: spacing.xs },
  tileCoverOuter: { aspectRatio: 2 / 3 },
  tileCoverImage: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: 3, overflow: "hidden" },
  emptyCover: { opacity: 0.4 },
  loserCover: { opacity: 0.72 },
  bookTitle: { textAlign: "center", minHeight: typography.caption.lineHeight * 2, alignSelf: "stretch" },
  bold: { fontWeight: "700" },
  sideResult: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs, minHeight: typography.caption.lineHeight },
  settleButton: { flexShrink: 1, minHeight: minimumTouchTarget, minWidth: minimumTouchTarget, paddingHorizontal: spacing.sm, borderRadius: radii.md, alignItems: "center", justifyContent: "center" },
  tiebreakPill: { alignSelf: "stretch", minHeight: minimumTouchTarget, paddingHorizontal: spacing.xs, borderRadius: radii.md, alignItems: "center", justifyContent: "center" },
  champion: { marginTop: spacing.sm, padding: spacing.md, borderRadius: radii.lg, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  championText: { flex: 1, gap: spacing.xs },
  sheetScroll: { maxHeight: 420 },
  sheetBody: { gap: spacing.md, paddingBottom: spacing.sm },
});
