import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ballotBoard, blankBoard, toPlacements, type TierlistData } from "@scripta/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, Stack } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useAuth } from "../../core/auth";
import { Button, ErrorState, Screen, Skeleton, Toast, dynamicType, spacing, typography, useTheme } from "../../ui";
import { fetchBallot, fetchMyBallot, fetchVotingBoard, submitBallot, type BallotResponse } from "./api";
import { keyOf, TierBoard, type TierBook } from "./TierBoard";
import { TierlistResults } from "./TierlistResults";
import { TierSortDeck } from "./TierSortDeck";
import { moveBookTo } from "./tierBoardData";

function storageKey(code: string) { return `tierlist-ballot:${code}`; }

export function VoteTierlistScreen({ code }: { code: string }) {
  const { colors } = useTheme();
  const { ready, user } = useAuth();
  const queryClient = useQueryClient();
  const [storedId, setStoredId] = useState<string | null | undefined>(undefined);
  const [ballot, setBallot] = useState<BallotResponse | null>(null);
  const [working, setWorking] = useState<TierlistData | null>(null);
  const [view, setView] = useState<"rank" | "board">("rank");
  const [selectedBookKey, setSelectedBookKey] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boardQuery = useQuery({ queryKey: ["tierlists", "voting", code], queryFn: () => fetchVotingBoard(code), enabled: Boolean(code), retry: false });

  useEffect(() => { void AsyncStorage.getItem(storageKey(code)).then(setStoredId); }, [code]);
  // A signed-in voter's ballot is keyed to their account, so it comes back
  // on this device even on a fresh install where nothing was ever stored —
  // and it's the only way a poll's owner reaches theirs, since openVoting
  // seeded it server-side.
  useEffect(() => {
    if (!ready || storedId === undefined) return;
    if (user) { void fetchMyBallot(code).then(setBallot).catch(() => setBallot(null)); return; }
    if (!storedId) return;
    void fetchBallot(code, storedId, false).then(setBallot).catch(() => { void AsyncStorage.removeItem(storageKey(code)); setStoredId(null); });
  }, [code, ready, storedId, user]);

  if (!ready || storedId === undefined || boardQuery.isPending) return <Screen bottom style={styles.screen}><Skeleton height={180} /></Screen>;
  if (boardQuery.isError || !boardQuery.data) return <Screen bottom style={styles.screen}><ErrorState title="No tier list at that link" body="Check the voting code and try again." actionLabel="Retry" onAction={() => void boardQuery.refetch()} /></Screen>;
  const { board } = boardQuery.data;
  const books: TierBook[] = boardQuery.data.books.map((book) => ({ Title: book.title, Attribution: book.author, ISBN: book.isbn, ImageId: book.imageId, _coverUrl: book.coverUrl }));
  const allKeys = new Set(books.map(keyOf));
  const cleanBoard = { ...board, pool: board.pool.filter((key) => allKeys.has(key)) };
  const data = working ?? (ballot && editing ? ballotBoard(cleanBoard, ballot.placements) : blankBoard(cleanBoard));
  const blocked = board.access === "members" && !user;
  const showResults = (!board.votingOpen || Boolean(ballot)) && !editing;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const response = await submitBallot(code, toPlacements(data), storedId ?? null, Boolean(user));
      await AsyncStorage.setItem(storageKey(code), response.ballotId);
      setStoredId(response.ballotId);
      setBallot(response);
      setEditing(false);
      await queryClient.invalidateQueries({ queryKey: ["tierlists"] });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't submit your ballot.");
    } finally {
      setBusy(false);
    }
  }

  return <Screen bottom top={false} style={styles.screen}>
    <Stack.Screen options={{ headerShown: true, title: board.name }} />
    <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{board.promotedAt ? "Permanent public reference" : board.votingOpen ? "Voting is open." : "Voting is closed."}</Text>
    {error ? <Toast visible message={error} tone="error" /> : null}
    {showResults ? <><View style={styles.row}>{ballot && board.votingOpen ? <Button label="Edit ballot" variant="secondary" onPress={() => { setWorking(ballotBoard(cleanBoard, ballot.placements)); setEditing(true); }} /> : null}</View><TierlistResults histogram={ballot?.results.histogram ?? board.histogram ?? []} tiers={board.tiers} pool={cleanBoard.pool} books={books} ballotCount={ballot?.results.ballotCount ?? board.ballotCount} /></> : <>
      <View style={styles.row}>{blocked ? <Button label="Sign in to vote" onPress={() => router.push({ pathname: "/(public)/login", params: { returnTo: `/vote/${code}` } } as never)} /> : <Button label={storedId ? "Update ballot" : "Submit ballot"} loading={busy} disabled={!toPlacements(data).length} onPress={submit} />}{editing ? <Button label="Cancel edit" variant="secondary" onPress={() => setEditing(false)} /> : null}</View>
      {view === "rank" ? <Pressable accessibilityRole="button" accessibilityLabel="Back to board" onPress={() => { setSelectedBookKey(null); setView("board"); }}><Text {...dynamicType} style={[typography.body, { color: colors.accent }]}>‹ Board</Text></Pressable> : data.pool.length > 0 ? <Pressable accessibilityRole="button" accessibilityLabel={`Rank ${data.pool.length} remaining books`} onPress={() => setView("rank")} style={styles.rankLink}><Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{data.pool.length} {data.pool.length === 1 ? "book" : "books"} left</Text><Text {...dynamicType} style={[typography.body, styles.strong, { color: colors.accent }]}>Rank remaining →</Text></Pressable> : null}
      {view === "rank" ? <TierSortDeck data={data} books={books} selectedBookKey={selectedBookKey} onAssign={(key, tierId) => { setWorking(moveBookTo(data, key, tierId)); if (selectedBookKey || (data.pool.length === 1 && data.pool.includes(key))) { setSelectedBookKey(null); setView("board"); } }} /> : <TierBoard data={data} books={books} onChange={setWorking} structureEditable={false} poolLabel="Unranked" onReassign={(key) => { setSelectedBookKey(key); setView("rank"); }} />}
    </>}
  </Screen>;
}

const styles = StyleSheet.create({
  screen: { padding: spacing.lg, gap: spacing.md },
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  rankLink: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  strong: { fontWeight: "700" },
});
