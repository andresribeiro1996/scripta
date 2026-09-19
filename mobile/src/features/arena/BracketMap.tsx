// The whole tournament at a glance, as a two-sided bracket running
// vertically: the top half flows down, the bottom half flows up, and they
// meet at a final in the middle. Mirrors the web client's BracketMap
// (frontend/src/components/arena/BracketMap.tsx) — same shape, same
// reasoning for going vertical instead of the usual left-to-right columns:
// a phone is tall and narrow, and the widest row this way is only half of
// round 1, not the full round-1-to-final span.
//
// Compact read-only tiles (just the two covers, no card chrome or vote
// text) rather than full DuelCards — those are ~180pt tall, so a handful
// of them make a bracket you can vote in but never see the shape of.
// Tapping a tile opens the full match in a read-only sheet (bigger
// covers, exact tallies); an
// owner's settle/tiebreak controls sit directly on the tile instead —
// nested Pressables, so tapping one of those doesn't also open the sheet.
// A web-style "open the sheet to act" round trip is one tap too many on a
// phone for actions this frequent.

import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { bracketShape, countdownLabel, needsVote, type BracketSlot, type Duel, type DuelSide } from "@scripta/shared";
import { Icon, Sheet, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { BookCover } from "./BookCover";
import { DuelSideRow } from "./DuelSideRow";
import type { TournamentView } from "./api";

function MatchSide({ side, isWinner, decided, onPick, busy }: { side: DuelSide; isWinner: boolean; decided: boolean; onPick?: () => void; busy: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={styles.tileSide}>
      {/* The badge sits on this OUTER box, which never clips — only the
       *  inner box (sized to match via absoluteFill) rounds and clips the
       *  cover image itself. A badge clipped by its own cover's rounding
       *  would lose its corner. */}
      <View style={styles.tileCoverOuter}>
        <View style={[styles.tileCoverImage, isWinner ? { borderColor: colors.accent, borderWidth: 2 } : null, decided && !isWinner ? styles.loserCover : null]}>
          <BookCover cover={side.cover} title={side.title} fill />
        </View>
        {isWinner ? (
          <View style={[styles.checkBadge, { backgroundColor: colors.accent }]}>
            <Text style={styles.checkMark}>✓</Text>
          </View>
        ) : null}
      </View>
      {onPick ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${side.title} wins the tiebreak`}
          disabled={busy}
          onPress={onPick}
          hitSlop={4}
          style={[styles.tiebreakPill, { backgroundColor: colors.accentSoft, opacity: busy ? 0.5 : 1 }]}
        >
          <Text {...dynamicType} numberOfLines={1} style={[typography.caption, styles.tiebreakLabel, { color: colors.accent }]}>Wins</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function EmptyTile() {
  const { colors } = useTheme();
  return (
    <View style={styles.tile}>
      <View style={styles.tileSide}>
        <View style={styles.tileCoverOuter}>
          <View style={[styles.tileCoverImage, styles.emptyCover, { backgroundColor: colors.border }]} />
        </View>
      </View>
      <View style={styles.vsWrap}>
        <Text {...dynamicType} style={[typography.caption, styles.vsLabel, { color: colors.textDim, opacity: 0.5 }]}>vs</Text>
      </View>
      <View style={styles.tileSide}>
        <View style={styles.tileCoverOuter}>
          <View style={[styles.tileCoverImage, styles.emptyCover, { backgroundColor: colors.border }]} />
        </View>
      </View>
    </View>
  );
}

function MatchTile({
  duel,
  isOwner,
  busy,
  onOpen,
  onSettle,
  onTiebreak,
}: {
  duel: BracketSlot;
  isOwner: boolean;
  busy: boolean;
  onOpen: (duel: Duel) => void;
  onSettle: (duelId: string) => void;
  onTiebreak: (duelId: string, bookKey: string) => void;
}) {
  const { colors } = useTheme();
  if (!duel) return <EmptyTile />;
  const decided = duel.winnerKey !== null;
  const tiebreak = isOwner && duel.status === "tied_pending_tiebreak";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${duel.bookA.title} versus ${duel.bookB.title}`}
      onPress={() => onOpen(duel)}
      style={styles.tile}
    >
      {needsVote(duel) ? <View style={[styles.voteDot, { backgroundColor: colors.accent, borderColor: colors.surface }]} /> : null}
      <MatchSide side={duel.bookA} isWinner={duel.winnerKey === duel.bookA.key} decided={decided} busy={busy} onPick={tiebreak ? () => onTiebreak(duel.id, duel.bookA.key) : undefined} />
      <View style={styles.vsWrap}>
        <Text {...dynamicType} style={[typography.caption, styles.vsLabel, { color: duel.status === "active" ? colors.accent : colors.textDim }]}>vs</Text>
      </View>
      <MatchSide side={duel.bookB} isWinner={duel.winnerKey === duel.bookB.key} decided={decided} busy={busy} onPick={tiebreak ? () => onTiebreak(duel.id, duel.bookB.key) : undefined} />
      {isOwner && duel.status === "active" ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Settle this match now"
          disabled={busy}
          onPress={() => onSettle(duel.id)}
          hitSlop={6}
          style={[styles.settleButton, { backgroundColor: colors.accent, borderColor: colors.surface, opacity: busy ? 0.5 : 1 }]}
        >
          <Icon name="confirm" size={11} color="#fff" />
        </Pressable>
      ) : null}
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
  widthRatio: number;
  isOwner: boolean;
  busyDuelId: string | null;
  onOpen: (duel: Duel) => void;
  onSettle: (duelId: string) => void;
  onTiebreak: (duelId: string, bookKey: string) => void;
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
              <MatchTile duel={duel} isOwner={isOwner} busy={busyDuelId === duel?.id} onOpen={onOpen} onSettle={onSettle} onTiebreak={onTiebreak} />
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
          isOwner={isOwner}
          busyDuelId={busyDuelId}
          onOpen={(duel) => setOpenId(duel.id)}
          onSettle={onSettle}
          onTiebreak={onTiebreak}
        />
      ))}

      {finalDuel ? (
        <View>
          <Text {...dynamicType} style={[typography.caption, styles.roundLabel, { color: colors.accent }]}>Final</Text>
          <View style={styles.finalCell}>
            <View style={[styles.stub, styles.stubTop, { backgroundColor: colors.border }]} />
            <View style={[styles.stub, styles.stubBottom, { backgroundColor: colors.border }]} />
            <View style={[styles.cellInner, { width: `${tileRatio(1) * 100}%` }]}>
              <MatchTile duel={finalDuel} isOwner={isOwner} busy={busyDuelId === finalDuel.id} onOpen={(duel) => setOpenId(duel.id)} onSettle={onSettle} onTiebreak={onTiebreak} />
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
            isOwner={isOwner}
            busyDuelId={busyDuelId}
            onOpen={(duel) => setOpenId(duel.id)}
            onSettle={onSettle}
            onTiebreak={onTiebreak}
          />
        );
      })}

      {/* Read-only: bigger covers and the exact tallies a tile has no room
       *  for. Acting (vote, settle, tiebreak) happens on the tile itself,
       *  not here — see the file header. */}
      <Sheet visible={Boolean(openDuel)} title="Match" onClose={() => setOpenId(null)}>
        {openDuel ? (
          <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetBody}>
            <Text {...dynamicType} style={[typography.caption, styles.center, { color: colors.textDim }]}>
              Round {openDuel.roundNumber} · Match {openDuel.duelIndex + 1} · {openDuel.status === "active" ? countdownLabel(openDuel.closesAt) : openDuel.status === "tied_pending_tiebreak" ? "Owner tiebreak needed" : "Settled"}
            </Text>
            <DuelSideRow side={openDuel.bookA} duel={openDuel} />
            <DuelSideRow side={openDuel.bookB} duel={openDuel} />
          </ScrollView>
        ) : null}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  map: { gap: spacing.none },
  row: { flexDirection: "row", alignItems: "stretch" },
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
  tile: { position: "relative", flexDirection: "row", alignItems: "stretch", borderRadius: radii.sm },
  vsWrap: { justifyContent: "center", alignItems: "center", paddingHorizontal: 1 },
  vsLabel: { fontSize: 9, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.3 },
  tileSide: { flex: 1, minWidth: 0, alignItems: "center", gap: 2 },
  tileCoverOuter: { width: "100%", aspectRatio: 2 / 3, maxWidth: 56 },
  tileCoverImage: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: 3, overflow: "hidden" },
  emptyCover: { opacity: 0.4 },
  loserCover: { opacity: 0.45 },
  checkBadge: { position: "absolute", top: -3, right: -3, width: 14, height: 14, borderRadius: radii.full, alignItems: "center", justifyContent: "center" },
  checkMark: { color: "#fff", fontSize: 9, fontWeight: "700" },
  voteDot: { position: "absolute", top: -3, right: -3, zIndex: 1, width: 10, height: 10, borderRadius: radii.full, borderWidth: 2 },
  // Bottom-LEFT corner, not centred: the centre is where the round's
  // connector lines land (see hLine/stub, both `left: "50%"`), and an
  // absolutely positioned badge like this doesn't add to the tile's own
  // height, so it can't nudge those connectors' math either way.
  settleButton: { position: "absolute", left: -6, bottom: -6, zIndex: 1, width: 20, height: 20, borderRadius: radii.full, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  tiebreakPill: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: radii.full },
  tiebreakLabel: { fontSize: 9, fontWeight: "700" },
  champion: { marginTop: spacing.xs, textAlign: "center", fontWeight: "700" },
  sheetScroll: { maxHeight: 420 },
  sheetBody: { gap: spacing.md, paddingBottom: spacing.sm },
});
