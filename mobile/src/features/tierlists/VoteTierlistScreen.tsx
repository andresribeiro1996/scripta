import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { toPlacements, type TierlistData } from "@scripta/shared";
import { useQuery } from "@tanstack/react-query";
import { router, Stack } from "expo-router";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useAuth } from "../../core/auth";
import { Button, ErrorState, Screen, Sheet, Skeleton, Toast, dynamicType, spacing, typography, useTheme } from "../../ui";
import { AddBookSheet } from "../community/AddBookSheet";
import { fetchBallot, fetchVotingBoard, submitBallot, type BallotResponse, type PublicBook } from "./api";
import { keyOf, TierBoard, type TierBook } from "./TierBoard";
import { TierlistResults } from "./TierlistResults";
import { TierSortDeck } from "./TierSortDeck";
import { moveBookTo } from "./tierBoardData";

function storageKey(code: string) { return `tierlist-ballot:${code}`; }
function blankBoard(board: { tiers: Array<{ id: string; label: string; color: string }>; pool: string[] }): TierlistData { return { tiers: board.tiers.map((tier) => ({ ...tier, bookKeys: [] })), pool: board.pool }; }
function ballotBoard(board: { tiers: Array<{ id: string; label: string; color: string }>; pool: string[] }, ballot: BallotResponse): TierlistData {
  const placed = new Set(ballot.placements.map((placement) => placement.bookKey));
  return { tiers: board.tiers.map((tier) => ({ ...tier, bookKeys: ballot.placements.filter((placement) => placement.tierId === tier.id).map((placement) => placement.bookKey) })), pool: board.pool.filter((key) => !placed.has(key)) };
}

export function VoteTierlistScreen({ code }: { code: string }) {
  const { colors } = useTheme();
  const { ready, user } = useAuth();
  const [storedId, setStoredId] = useState<string | null | undefined>(undefined);
  const [ballot, setBallot] = useState<BallotResponse | null>(null);
  const [working, setWorking] = useState<TierlistData | null>(null);
  const [view, setView] = useState<"rank" | "board">("rank");
  const [selectedBookKey, setSelectedBookKey] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [booksOpen, setBooksOpen] = useState(false);
  const [addBook, setAddBook] = useState<PublicBook | null>(null);
  const boardQuery = useQuery({ queryKey: ["tierlists", "voting", code], queryFn: () => fetchVotingBoard(code), enabled: Boolean(code), retry: false });

  useEffect(() => { void AsyncStorage.getItem(storageKey(code)).then(setStoredId); }, [code]);
  useEffect(() => {
    if (!ready || storedId === undefined || !storedId) return;
    void fetchBallot(code, storedId, Boolean(user)).then(setBallot).catch(() => { void AsyncStorage.removeItem(storageKey(code)); setStoredId(null); });
  }, [code, ready, storedId, user]);

  if (!ready || storedId === undefined || boardQuery.isPending) return <Screen bottom style={styles.screen}><Skeleton height={180} /></Screen>;
  if (boardQuery.isError || !boardQuery.data) return <Screen bottom style={styles.screen}><ErrorState title="No tier list at that link" body="Check the voting code and try again." actionLabel="Retry" onAction={() => void boardQuery.refetch()} /></Screen>;
  const { board } = boardQuery.data;
  const books: TierBook[] = boardQuery.data.books.map((book) => ({ Title: book.title, Attribution: book.author, ISBN: book.isbn, ImageId: book.imageId, _coverUrl: book.coverUrl }));
  const allKeys = new Set(books.map(keyOf));
  const cleanBoard = { ...board, pool: board.pool.filter((key) => allKeys.has(key)) };
  const data = working ?? (ballot && editing ? ballotBoard(cleanBoard, ballot) : blankBoard(cleanBoard));
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
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't submit your ballot.");
    } finally {
      setBusy(false);
    }
  }

  function openAddBook(book: PublicBook) {
    setBooksOpen(false);
    setAddBook(book);
  }

  return <Screen bottom top={false} style={styles.screen}>
    <Stack.Screen options={{ headerShown: true, title: board.name }} />
    <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{board.promotedAt ? "Permanent public reference" : board.votingOpen ? "Voting is open." : "Voting is closed."}</Text>
    {error ? <Toast visible message={error} tone="error" /> : null}
    {showResults ? <><View style={styles.row}>{ballot && board.votingOpen ? <Button label="Edit ballot" variant="secondary" onPress={() => { setWorking(ballotBoard(cleanBoard, ballot)); setEditing(true); }} /> : null}<Button label="Books" variant="secondary" onPress={() => setBooksOpen(true)} /></View><TierlistResults histogram={ballot?.results.histogram ?? board.histogram ?? []} tiers={board.tiers} pool={cleanBoard.pool} books={books} ballotCount={ballot?.results.ballotCount ?? board.ballotCount} /></> : <>
      <View style={styles.row}>{blocked ? <Button label="Sign in to vote" onPress={() => router.push({ pathname: "/(public)/login", params: { returnTo: `/vote/${code}` } } as never)} /> : <Button label={storedId ? "Update ballot" : "Submit ballot"} loading={busy} disabled={!toPlacements(data).length} onPress={submit} />}{editing ? <Button label="Cancel edit" variant="secondary" onPress={() => setEditing(false)} /> : null}<Button label="Books" variant="secondary" onPress={() => setBooksOpen(true)} /></View>
      {view === "rank" ? <Pressable accessibilityRole="button" accessibilityLabel="Back to board" onPress={() => { setSelectedBookKey(null); setView("board"); }}><Text {...dynamicType} style={[typography.body, { color: colors.accent }]}>‹ Board</Text></Pressable> : data.pool.length > 0 ? <Pressable accessibilityRole="button" accessibilityLabel={`Rank ${data.pool.length} remaining books`} onPress={() => setView("rank")} style={styles.rankLink}><Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{data.pool.length} {data.pool.length === 1 ? "book" : "books"} left</Text><Text {...dynamicType} style={[typography.body, styles.strong, { color: colors.accent }]}>Rank remaining →</Text></Pressable> : null}
      {view === "rank" ? <TierSortDeck data={data} books={books} selectedBookKey={selectedBookKey} onAssign={(key, tierId) => { setWorking(moveBookTo(data, key, tierId)); if (selectedBookKey || (data.pool.length === 1 && data.pool.includes(key))) { setSelectedBookKey(null); setView("board"); } }} /> : <TierBoard data={data} books={books} onChange={setWorking} structureEditable={false} poolLabel="Unranked" onReassign={(key) => { setSelectedBookKey(key); setView("rank"); }} />}
    </>}
    <Sheet visible={booksOpen} title="Books" onClose={() => setBooksOpen(false)}>
      <FlatList
        data={boardQuery.data.books}
        keyExtractor={(book, index) => book.key ?? `${book.title}-${index}`}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => <Pressable accessibilityLabel={`${item.title} by ${item.author ?? ""}`} onPress={() => openAddBook(item)} style={styles.bookRow}>
          <Text numberOfLines={2} {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>{item.title}</Text>
          <Text numberOfLines={1} {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{item.author ?? ""}</Text>
        </Pressable>}
      />
    </Sheet>
    {addBook ? <AddBookSheet book={{ title: addBook.title, author: addBook.author ?? "", isbn: addBook.isbn ?? null, coverUrl: addBook.coverUrl ?? null }} onClose={() => setAddBook(null)} /> : null}
  </Screen>;
}

const styles = StyleSheet.create({
  screen: { padding: spacing.lg, gap: spacing.md },
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  rankLink: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  strong: { fontWeight: "700" },
  list: { flexGrow: 0 },
  listContent: { gap: spacing.md, paddingBottom: spacing.md },
  bookRow: { gap: spacing.xs },
});
