// One round at a time rather than the whole tree, the way a sports app
// draws a draw: a phone cannot put round 1 of a 16-book bracket across its
// width and leave the covers legible — the two-sided map this replaced
// shrank them to ~28pt and they collided.
//
// The round bar is pinned to the BOTTOM of the pane, not the top: it is
// where the thumb already is. That's also why this component owns its own
// ScrollView instead of sitting inside the screen's.
//
// The bar does not hide while the list moves. It used to slide away on
// every scroll and come back on a settle timer, which meant two pieces of
// chrome animating on each flick and a control that was missing whenever
// you reached for it.
//
// Its chips are the short forms a sports page uses — R1, QF, SF, F — so
// even a 32-book bracket's five rounds fit one row without scrolling. The
// round header above the list spells the current one out in full, and the
// accessibility label always carries the long name. Changing the view is
// the floating button's job, not a sixth chip's.
//
// A match is a flat block on the page separated by a hairline, not a card:
// the same shape the home feed's activity rows use — an uppercase label row
// carrying the state in colour, then the content under it. Boxes around
// every match made a results table look like a stack of widgets.
//
// Rounds whose duels don't exist yet still get a block, with each side
// naming the match whose winner will land there.
//
// Tapping a card opens the same read-only sheet as before (bigger covers,
// author, exact share). An owner's settle/tiebreak controls sit on the card
// as nested Pressables, so tapping one doesn't also open the sheet.

import { useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { bracketShape, countdownLabel, needsVote, sharePercent, type BracketSlot, type Duel, type DuelSide } from "@scripta/shared";
import { Icon, Sheet, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { BookCover } from "./BookCover";
import { DuelSideRow } from "./DuelSideRow";
import { BracketViewToggle } from "./BracketViewToggle";
import { tournamentChampion } from "./arenaView";
import type { TournamentView } from "./api";

const BAR_HEIGHT = 56;
const FAB_SIZE = 48;
// Enough for the bar AND the button floating above it, so the last match
// scrolls clear of both rather than under them.
const BAR_RESERVE = BAR_HEIGHT + FAB_SIZE + 40;

const COVER_WIDTH = 32;
const COVER_HEIGHT = 48;

function MatchRow({ side, isWinner, isChampion, decided, busy, onPick }: { side: DuelSide; isWinner: boolean; isChampion: boolean; decided: boolean; busy: boolean; onPick?: () => void }) {
  const { colors } = useTheme();
  const faded = decided && !isWinner;
  return (
    <View style={styles.row}>
      <BookCover cover={side.cover} title={side.title} width={COVER_WIDTH} height={COVER_HEIGHT} />
      <View style={styles.rowText}>
        <Text numberOfLines={1} {...dynamicType} style={[typography.body, isWinner && styles.bold, { color: faded ? colors.textDim : colors.text }]}>{side.title}</Text>
        <Text numberOfLines={1} {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{side.author}</Text>
      </View>
      {onPick ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${side.title} wins the tiebreak`}
          disabled={busy}
          hitSlop={6}
          onPress={onPick}
          style={[styles.winsPill, { backgroundColor: colors.accentSoft, opacity: busy ? 0.5 : 1 }]}
        >
          <Text {...dynamicType} style={[typography.caption, styles.bold, { color: colors.accent }]}>Wins</Text>
        </Pressable>
      ) : null}
      {/* Weight alone is a thin cue for "this one went through" — the mark
       *  gives it a second, non-typographic one, and the trophy says this
       *  book didn't just win a round, it won the tournament. */}
      {isChampion ? <Icon name="champion" size={14} color={colors.accent} /> : null}
      {isWinner && !isChampion ? <Text {...dynamicType} style={[typography.caption, styles.bold, { color: colors.accent }]}>✓</Text> : null}
      <Text {...dynamicType} style={[typography.body, isWinner && styles.bold, styles.votes, { color: faded ? colors.textDim : colors.text }]}>{side.votes}</Text>
    </View>
  );
}

function PendingRow({ label }: { label: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      <View style={[styles.pendingCover, { backgroundColor: colors.border }]} />
      <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.rowText, { color: colors.textDim }]}>{label}</Text>
    </View>
  );
}

function MatchCard({
  duel,
  matchNumber,
  feeders,
  championKey,
  isOwner,
  busy,
  onOpen,
  onSettle,
  onTiebreak,
}: {
  duel: BracketSlot;
  matchNumber: number;
  feeders: [string, string] | null;
  championKey: string | null;
  isOwner: boolean;
  busy: boolean;
  onOpen: (duel: Duel) => void;
  onSettle: (duelId: string) => void;
  onTiebreak: (duelId: string, bookKey: string) => void;
}) {
  const { colors } = useTheme();
  if (!duel) {
    return (
      <View style={[styles.block, { borderBottomColor: colors.border }]}>
        <View style={styles.labelRow}>
          <Text {...dynamicType} numberOfLines={1} style={[typography.caption, styles.meta, styles.grow, { color: colors.textDim }]}>Match {matchNumber}</Text>
        </View>
        <PendingRow label={feeders ? feeders[0] : "Not decided yet"} />
        <PendingRow label={feeders ? feeders[1] : "Not decided yet"} />
      </View>
    );
  }
  const decided = duel.winnerKey !== null;
  const winner = duel.winnerKey === duel.bookA.key ? duel.bookA : duel.winnerKey === duel.bookB.key ? duel.bookB : null;
  const tiebreak = isOwner && duel.status === "tied_pending_tiebreak";
  const shareA = sharePercent(duel.bookA.votes, duel);
  // Every duel in a round shares one deadline, so the countdown belongs to
  // the round header, not to each card. Only a match that has left the
  // round's own state behind says anything here.
  const state = duel.status === "settled" ? "Settled" : duel.status === "tied_pending_tiebreak" ? "Tiebreak needed" : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Match ${matchNumber}, ${duel.bookA.title} versus ${duel.bookB.title}${winner ? `, ${winner.title} won` : ""}`}
      onPress={() => onOpen(duel)}
      style={({ pressed }) => [styles.block, { borderBottomColor: colors.border, backgroundColor: pressed ? colors.surfacePressed : "transparent" }]}
    >
      <View style={styles.labelRow}>
        {needsVote(duel) ? <View style={[styles.voteDot, { backgroundColor: colors.accent }]} /> : null}
        <Text {...dynamicType} numberOfLines={1} style={[typography.caption, styles.meta, styles.grow, { color: needsVote(duel) ? colors.accent : colors.textDim }]}>
          Match {matchNumber}
        </Text>
        {state ? <Text {...dynamicType} numberOfLines={1} style={[typography.caption, styles.meta, { color: colors.textDim }]}>{state}</Text> : null}
        {isOwner && duel.status === "active" ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Settle this match now"
            disabled={busy}
            hitSlop={6}
            onPress={() => onSettle(duel.id)}
            style={[styles.settle, { borderColor: colors.border, opacity: busy ? 0.5 : 1 }]}
          >
            <Text {...dynamicType} style={[typography.caption, styles.bold, { color: colors.accent }]}>Settle</Text>
          </Pressable>
        ) : null}
      </View>
      <MatchRow
        side={duel.bookA}
        isWinner={duel.winnerKey === duel.bookA.key}
        isChampion={championKey !== null && championKey === duel.bookA.key}
        decided={decided}
        busy={busy}
        onPick={tiebreak ? () => onTiebreak(duel.id, duel.bookA.key) : undefined}
      />
      <MatchRow
        side={duel.bookB}
        isWinner={duel.winnerKey === duel.bookB.key}
        isChampion={championKey !== null && championKey === duel.bookB.key}
        decided={decided}
        busy={busy}
        onPick={tiebreak ? () => onTiebreak(duel.id, duel.bookB.key) : undefined}
      />
      {/* Only once someone has voted — before that the two tallies are
       *  both 0 and a half-empty bar would imply a contest that hasn't
       *  started. */}
      {shareA === null ? null : (
        <View style={[styles.shareTrack, { backgroundColor: colors.border }]}>
          <View style={[styles.shareFill, { width: `${shareA}%`, backgroundColor: colors.accent }]} />
        </View>
      )}
    </Pressable>
  );
}

export function BracketRounds({
  tournament,
  isOwner,
  busyDuelId,
  refreshing,
  onRefresh,
  onShowClassic,
  onSettle,
  onTiebreak,
}: {
  tournament: TournamentView;
  isOwner: boolean;
  busyDuelId: string | null;
  refreshing: boolean;
  onRefresh: () => void;
  /** Hands the pane over to the classic whole-tree map. */
  onShowClassic: () => void;
  onSettle: (duelId: string) => void;
  onTiebreak: (duelId: string, bookKey: string) => void;
}) {
  const { colors } = useTheme();
  const [openId, setOpenId] = useState<string | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const scroller = useRef<ScrollView>(null);
  const openDuel = openId ? (tournament.duels.find((d) => d.id === openId) ?? null) : null;

  const byRound = bracketShape(tournament.bracketSize, tournament.duels);
  if (byRound.length === 0) return null;

  // Sports-page short forms for the chips; labelFor stays the long name for
  // the round header, prose and accessibility labels.
  function shortLabelFor(roundIdx: number): string {
    const count = byRound[roundIdx]?.length ?? 0;
    if (count === 1) return "F";
    if (count === 2) return "SF";
    if (count === 4) return "QF";
    return `R${roundIdx + 1}`;
  }

  function labelFor(roundIdx: number): string {
    const count = byRound[roundIdx]?.length ?? 0;
    if (count === 1) return "Final";
    if (count === 2) return "Semis";
    if (count === 4) return "Quarters";
    return `Round ${roundIdx + 1}`;
  }

  // Named rounds read as "Winner of Quarters 2"; the early numbered ones
  // would read "Winner of Round 1 3", so those name the match alone — the
  // number matches the "Match N" on that round's own cards.
  function feederLabel(prevRoundIdx: number, matchNumber: number): string {
    const label = labelFor(prevRoundIdx);
    return label.startsWith("Round") ? `Winner of match ${matchNumber}` : `Winner of ${label} ${matchNumber}`;
  }

  const liveRound = byRound.findIndex((slots) => slots.some((duel) => !duel || duel.status !== "settled"));
  const roundIdx = Math.min(picked ?? (liveRound === -1 ? byRound.length - 1 : liveRound), byRound.length - 1);
  const slots = byRound[roundIdx]!;

  const champion = tournamentChampion(tournament.bracketSize, tournament.duels);
  // One deadline per round, set when the round's duels are built, so any
  // still-open duel in it carries the same one.
  const closesAt = slots.find((duel) => duel?.status === "active")?.closesAt ?? null;

  // A round you switch into is shorter than the one you left as often as
  // not, so keeping the old offset can land you in empty space.
  function pickRound(next: number) {
    setPicked(next);
    scroller.current?.scrollTo({ y: 0, animated: true });
  }

  return (
    <View style={styles.pane}>
      <ScrollView
        ref={scroller}
        style={styles.grow}
        // The bar floats over the list, so the padding is what keeps the
        // last card clear of it. A fixed reserve rather than the bar's
        // measured height: measuring it fed an onLayout setState back into
        // this list's padding, and with the chips in their own scroller
        // that update landed before the bar had mounted.
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Text {...dynamicType} numberOfLines={1} style={[typography.caption, styles.meta, styles.roundHead, { color: colors.textDim }]}>
          {labelFor(roundIdx)}{closesAt ? ` · ${countdownLabel(closesAt)}` : ""}
        </Text>
        <View>
          {slots.map((duel, i) => (
            <View key={duel?.id ?? `pending-${roundIdx}-${i}`}>
              <MatchCard
                duel={duel}
                matchNumber={i + 1}
                feeders={roundIdx > 0 ? [feederLabel(roundIdx - 1, i * 2 + 1), feederLabel(roundIdx - 1, i * 2 + 2)] : null}
                championKey={champion?.key ?? null}
                isOwner={isOwner}
                busy={busyDuelId === duel?.id}
                onOpen={(opened) => setOpenId(opened.id)}
                onSettle={onSettle}
                onTiebreak={onTiebreak}
              />
            </View>
          ))}
        </View>

      </ScrollView>

      <View style={[styles.bar, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
        {byRound.map((_, i) => {
          const on = i === roundIdx;
          const live = i === liveRound;
          return (
            <Pressable
              key={i}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={live ? `${labelFor(i)}, current round` : labelFor(i)}
              hitSlop={6}
              onPress={() => pickRound(i)}
              style={[styles.chip, { backgroundColor: on ? colors.accent : colors.background, borderColor: on ? colors.accent : colors.border }]}
            >
              {live ? <View style={[styles.liveDot, { backgroundColor: on ? colors.onAccent : colors.accent }]} /> : null}
              <Text {...dynamicType} numberOfLines={1} style={[typography.caption, styles.bold, { color: on ? colors.onAccent : colors.textDim }]}>{shortLabelFor(i)}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.fabDock} pointerEvents="box-none">
        <BracketViewToggle to="classic" onPress={onShowClassic} />
      </View>

      {/* Read-only: bigger covers and the exact share a card has no room
       *  for. Acting (vote, settle, tiebreak) happens on the card itself,
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
  pane: { flex: 1 },
  list: { paddingBottom: BAR_RESERVE, flexGrow: 1 },
  bar: { position: "absolute", left: 0, right: 0, bottom: 0, minHeight: BAR_HEIGHT, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs, paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xs, borderTopWidth: 1 },
  // flexShrink, not a scroller: the row must fit whatever the bracket size
  // and the type scale hand it.
  fabDock: { position: "absolute", right: spacing.lg, bottom: BAR_HEIGHT + spacing.md },
  chip: { flexShrink: 1, flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radii.full, borderWidth: 1 },
  liveDot: { width: 6, height: 6, borderRadius: radii.full },
  // The home feed's row recipe: a hairline under each block and nothing
  // else, so a round reads as one list of results.
  block: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1 },
  labelRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingBottom: spacing.xs },
  meta: { fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6 },
  roundHead: { paddingTop: spacing.md, paddingBottom: spacing.xs, paddingHorizontal: spacing.lg },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xs },
  rowText: { flex: 1, minWidth: 0 },
  pendingCover: { width: COVER_WIDTH, height: COVER_HEIGHT, borderRadius: radii.sm, opacity: 0.4 },
  shareTrack: { height: 3, borderRadius: radii.full, overflow: "hidden", marginLeft: COVER_WIDTH + spacing.sm, marginTop: spacing.xs },
  shareFill: { height: 3, borderRadius: radii.full },
  bold: { fontWeight: "700" },
  votes: { minWidth: 22, textAlign: "right" },
  winsPill: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radii.full },
  grow: { flex: 1 },
  voteDot: { width: 8, height: 8, borderRadius: radii.full },
  settle: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radii.full, borderWidth: 1 },
  center: { textAlign: "center" },
  sheetScroll: { maxHeight: 420 },
  sheetBody: { gap: spacing.md, paddingBottom: spacing.sm },
});
