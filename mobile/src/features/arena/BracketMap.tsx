// The whole tournament at a glance, as a two-sided bracket running
// vertically: the top half flows down, the bottom half flows up, and they
// meet at a final in the middle. Mirrors the web client's BracketMap
// (frontend/src/components/arena/BracketMap.tsx) — same shape, same
// reasoning for going vertical instead of the usual left-to-right columns:
// a phone is tall and narrow, and the widest row this way is only half of
// round 1, not the full round-1-to-final span.
//
// Compact read-only tiles (cover + vote share per side) rather than full
// DuelCards — those are ~180pt tall, so a handful of them make a bracket
// you can vote in but never see the shape of. Tapping a tile opens the
// full match in a sheet, where an owner also gets settle/tiebreak.

import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { bracketShape, countdownLabel, needsVote, sharePercent, type BracketSlot, type Duel, type DuelSide } from "@scripta/shared";
import { Button, Sheet, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { BookCover } from "./BookCover";
import { DuelSideRow } from "./DuelSideRow";
import type { TournamentView } from "./api";

function MatchSide({ side, duel, isWinner, decided }: { side: DuelSide; duel: Duel; isWinner: boolean; decided: boolean }) {
  const { colors } = useTheme();
  const pct = sharePercent(side.votes, duel);
  return (
    <View style={styles.tileSide}>
      {/* The badge sits on this OUTER box, which never clips — only the
       *  inner box (sized to match via absoluteFill) rounds and clips the
       *  cover image itself. A badge clipped by its own cover's rounding
       *  would lose its corner. */}
      <View style={styles.tileCoverOuter}>
        <View style={[styles.tileCoverImage, isWinner ? { borderColor: colors.accent, borderWidth: 2 } : null]}>
          <BookCover cover={side.cover} title={side.title} fill />
        </View>
        {isWinner ? (
          <View style={[styles.checkBadge, { backgroundColor: colors.accent }]}>
            <Text style={styles.checkMark}>✓</Text>
          </View>
        ) : null}
      </View>
      <Text {...dynamicType} numberOfLines={1} style={[typography.caption, styles.tilePct, { color: isWinner ? colors.accent : colors.textDim, opacity: decided && !isWinner ? 0.6 : 1 }]}>
        {pct === null ? "–" : `${pct}%`}
      </Text>
    </View>
  );
}

function EmptyTile() {
  const { colors } = useTheme();
  return (
    <View style={[styles.tile, styles.emptyTile, { borderColor: colors.border }]}>
      {[0, 1].map((i) => (
        <View key={i} style={styles.tileSide}>
          <View style={styles.tileCoverOuter}>
            <View style={[styles.tileCoverImage, styles.emptyCover, { backgroundColor: colors.border }]} />
          </View>
          <Text {...dynamicType} style={[typography.caption, { color: colors.textDim, opacity: 0.6 }]}>–</Text>
        </View>
      ))}
    </View>
  );
}

function MatchTile({ duel, onOpen }: { duel: BracketSlot; onOpen: (duel: Duel) => void }) {
  const { colors } = useTheme();
  if (!duel) return <EmptyTile />;
  const decided = duel.winnerKey !== null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${duel.bookA.title} versus ${duel.bookB.title}`}
      onPress={() => onOpen(duel)}
      style={[styles.tile, { borderColor: duel.status === "active" ? colors.accent : colors.border, backgroundColor: colors.surface }]}
    >
      {needsVote(duel) ? <View style={[styles.voteDot, { backgroundColor: colors.accent, borderColor: colors.surface }]} /> : null}
      <MatchSide side={duel.bookA} duel={duel} isWinner={duel.winnerKey === duel.bookA.key} decided={decided} />
      <View style={[styles.tileDivider, { backgroundColor: colors.border }]} />
      <MatchSide side={duel.bookB} duel={duel} isWinner={duel.winnerKey === duel.bookB.key} decided={decided} />
    </Pressable>
  );
}

/** One round of one half of the bracket. `mirrored` flips every connector:
 *  the bottom half flows upward, so its matches feed out of their TOP edge
 *  and receive on their BOTTOM — the opposite of the top half. */
function RoundRow({
  slots,
  label,
  mirrored,
  feedsInward,
  receivesFromOutside,
  widthRatio,
  onOpen,
}: {
  slots: BracketSlot[];
  label: string;
  mirrored: boolean;
  feedsInward: boolean;
  receivesFromOutside: boolean;
  widthRatio: number;
  onOpen: (duel: Duel) => void;
}) {
  const { colors } = useTheme();
  return (
    <View>
      <Text {...dynamicType} style={[typography.caption, styles.roundLabel, { color: colors.textDim }, mirrored && styles.roundLabelLast]}>{label}</Text>
      <View style={styles.row}>
        {slots.map((duel, i) => (
          <View key={`${label}-${i}`} style={styles.cell}>
            {receivesFromOutside ? (
              <View style={[styles.stub, { backgroundColor: colors.border }, mirrored ? styles.stubBottom : styles.stubTop]} />
            ) : null}
            <View style={[styles.cellInner, { width: `${widthRatio * 100}%` }]}>
              <MatchTile duel={duel} onOpen={onOpen} />
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
  onTiebreak: (duelId: string, bookKey: string) => void;
}) {
  const { colors } = useTheme();
  const [openId, setOpenId] = useState<string | null>(null);
  const openDuel = openId ? (tournament.duels.find((d) => d.id === openId) ?? null) : null;

  const byRound = bracketShape(tournament.bracketSize, tournament.duels);
  if (byRound.length === 0) return null;

  const finalRound = byRound.at(-1)!;
  // A 2-book "bracket" is nothing but a final — only split off a centre
  // round when it can really halve into two sides.
  const hasCentre = finalRound.length === 1;
  const sideRounds = hasCentre ? byRound.slice(0, -1) : byRound;
  const top = sideRounds.map((slots) => slots.slice(0, Math.ceil(slots.length / 2)));
  const bottom = sideRounds.map((slots) => slots.slice(Math.ceil(slots.length / 2)));

  // Every tile is the same absolute width, whichever round it's in: a row
  // of `c` cells has cells of `total/c`, so a tile takes `c / maxPerRow` of
  // its own cell to match round 1's width.
  const maxPerRow = Math.max(1, ...sideRounds.map((slots) => Math.ceil(slots.length / 2)));
  const tileRatio = (cells: number) => cells / maxPerRow;

  function labelFor(roundIdx: number): string {
    const perSide = top[roundIdx]!.length;
    if (perSide === 1) return "Semis";
    if (perSide === 2) return "Quarters";
    return `Round ${roundIdx + 1}`;
  }

  const finalDuel = hasCentre ? finalRound[0] : null;
  const champion: DuelSide | null = finalDuel?.winnerKey
    ? (finalDuel.winnerKey === finalDuel.bookA.key ? finalDuel.bookA : finalDuel.bookB)
    : null;

  return (
    <View style={styles.map}>
      {top.map((slots, roundIdx) => (
        <RoundRow
          key={`t-${roundIdx}`}
          slots={slots}
          label={labelFor(roundIdx)}
          mirrored={false}
          feedsInward={roundIdx < top.length - 1 || hasCentre}
          receivesFromOutside={roundIdx > 0}
          widthRatio={tileRatio(slots.length)}
          onOpen={(duel) => setOpenId(duel.id)}
        />
      ))}

      {finalDuel ? (
        <View>
          <Text {...dynamicType} style={[typography.caption, styles.roundLabel, { color: colors.accent }]}>Final</Text>
          <View style={styles.finalCell}>
            <View style={[styles.stub, styles.stubTop, { backgroundColor: colors.border }]} />
            <View style={[styles.stub, styles.stubBottom, { backgroundColor: colors.border }]} />
            <View style={[styles.cellInner, { width: `${tileRatio(1) * 100}%` }]}>
              <MatchTile duel={finalDuel} onOpen={(duel) => setOpenId(duel.id)} />
              {champion ? (
                <Text {...dynamicType} numberOfLines={1} style={[typography.caption, styles.champion, { color: colors.accent }]}>🏆 {champion.title}</Text>
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
            widthRatio={tileRatio(slots.length)}
            onOpen={(duel) => setOpenId(duel.id)}
          />
        );
      })}

      <Sheet visible={Boolean(openDuel)} title="Match" onClose={() => setOpenId(null)}>
        {openDuel ? (
          <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetBody}>
            <Text {...dynamicType} style={[typography.caption, styles.center, { color: colors.textDim }]}>
              Round {openDuel.roundNumber} · Match {openDuel.duelIndex + 1} · {openDuel.status === "active" ? countdownLabel(openDuel.closesAt) : openDuel.status === "tied_pending_tiebreak" ? "Owner tiebreak needed" : "Settled"}
            </Text>
            <DuelSideRow side={openDuel.bookA} duel={openDuel} />
            <DuelSideRow side={openDuel.bookB} duel={openDuel} />
            {isOwner && openDuel.status === "active" ? (
              <Button label="Settle now" variant="secondary" loading={busyDuelId === openDuel.id} onPress={() => onSettle(openDuel.id)} />
            ) : null}
            {isOwner && openDuel.status === "tied_pending_tiebreak" ? (
              <View style={styles.row2}>
                <Button label={`${openDuel.bookA.title} wins`} loading={busyDuelId === openDuel.id} onPress={() => onTiebreak(openDuel.id, openDuel.bookA.key)} />
                <Button label={`${openDuel.bookB.title} wins`} loading={busyDuelId === openDuel.id} onPress={() => onTiebreak(openDuel.id, openDuel.bookB.key)} />
              </View>
            ) : null}
          </ScrollView>
        ) : null}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  map: { gap: spacing.none },
  row: { flexDirection: "row", alignItems: "stretch" },
  row2: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  center: { textAlign: "center" },
  cell: { flex: 1, position: "relative", justifyContent: "center" },
  cellInner: { alignSelf: "center", paddingVertical: spacing.xs, paddingHorizontal: 2 },
  finalCell: { position: "relative", justifyContent: "center" },
  roundLabel: { textAlign: "center", fontWeight: "700", textTransform: "uppercase", marginBottom: 2, fontSize: 10 },
  roundLabelLast: { marginBottom: 0, marginTop: 2 },
  stub: { position: "absolute", left: "50%", width: 1, height: 6 },
  stubTop: { top: 0 },
  stubBottom: { bottom: 0 },
  hLine: { position: "absolute", height: 1 },
  hLineTop: { top: 0 },
  hLineBottom: { bottom: 0 },
  hLineRight: { left: "50%", right: 0 },
  hLineLeft: { left: 0, right: "50%" },
  tile: { flexDirection: "row", alignItems: "stretch", borderWidth: 1, borderRadius: radii.sm },
  emptyTile: { borderStyle: "dashed" },
  tileDivider: { width: 1 },
  tileSide: { flex: 1, minWidth: 0, alignItems: "center", gap: 2, paddingVertical: spacing.xs, paddingHorizontal: 2 },
  tileCoverOuter: { width: "100%", aspectRatio: 2 / 3, maxWidth: 56 },
  tileCoverImage: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: 3, overflow: "hidden" },
  emptyCover: { opacity: 0.4 },
  tilePct: { fontSize: 10 },
  checkBadge: { position: "absolute", top: -3, right: -3, width: 14, height: 14, borderRadius: radii.full, alignItems: "center", justifyContent: "center" },
  checkMark: { color: "#fff", fontSize: 9, fontWeight: "700" },
  voteDot: { position: "absolute", top: -3, right: -3, zIndex: 1, width: 10, height: 10, borderRadius: radii.full, borderWidth: 2 },
  champion: { marginTop: spacing.xs, textAlign: "center", fontWeight: "700" },
  sheetScroll: { maxHeight: 420 },
  sheetBody: { gap: spacing.md, paddingBottom: spacing.sm },
});
