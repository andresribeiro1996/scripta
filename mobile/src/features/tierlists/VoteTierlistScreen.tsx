import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ballotBoard, blankBoard, toPlacements, type TierlistData } from "@scripta/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, Stack } from "expo-router";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useAuth } from "../../core/auth";
import { ApiError } from "../../core/api";
import { Button, ErrorState, Fab, Screen, Sheet, Skeleton, SwipeableTabs, Toast, dynamicType, spacing, typography, useTheme } from "../../ui";
import { AddBookSheet } from "../community/AddBookSheet";
import { fetchBallot, fetchMyBallot, fetchVotingBoard, submitBallot, type BallotResponse, type PublicBook } from "./api";
import { keyOf, TierBoard, type TierBook } from "./TierBoard";
import { TierlistResults } from "./TierlistResults";
import { TierSortDeck } from "./TierSortDeck";
import { moveBookTo } from "./tierBoardData";

function storageKey(code: string) { return `tierlist-ballot:${code}`; }

export function VoteTierlistScreen({ code, startInRank = false }: { code: string; startInRank?: boolean }) {
  const { colors } = useTheme();
  const { ready, user } = useAuth();
  const queryClient = useQueryClient();
  const [storedId, setStoredId] = useState<string | null | undefined>(undefined);
  const [ballot, setBallot] = useState<BallotResponse | null>(null);
  const [working, setWorking] = useState<TierlistData | null>(null);
  const [view, setView] = useState<"rank" | "board" | "community">(startInRank ? "rank" : "board");
  const [selectedBookKey, setSelectedBookKey] = useState<string | null>(null);
  const [editing, setEditing] = useState(startInRank);
  const [ballotLoading, setBallotLoading] = useState(true);
  const [ballotError, setBallotError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [booksOpen, setBooksOpen] = useState(false);
  const [addBook, setAddBook] = useState<PublicBook | null>(null);
  const boardQuery = useQuery({ queryKey: ["tierlists", "voting", code], queryFn: () => fetchVotingBoard(code), enabled: Boolean(code), retry: false });
  const votingBoard = boardQuery.data?.board;
  useEffect(() => {
    if (view === "rank" && votingBoard && (!votingBoard.votingOpen || votingBoard.promotedAt || votingBoard.access === "members" && !user)) setView("board");
  }, [view, votingBoard, user]);

  useEffect(() => { void AsyncStorage.getItem(storageKey(code)).then(setStoredId).catch(() => setStoredId(null)); }, [code]);
  // A signed-in voter's ballot is keyed to their account, so it comes back
  // on this device even on a fresh install where nothing was ever stored —
  // and it's the only way a poll's owner reaches theirs, since openVoting
  // seeded it server-side.
  useEffect(() => {
    if (!ready || storedId === undefined) return;
    if (!user && !storedId) { setBallotLoading(false); return; }
    setBallotLoading(true);
    const request = user ? fetchMyBallot(code) : fetchBallot(code, storedId!, false);
    void request.then((found) => { setBallot(found); setBallotError(null); }).catch((reason) => {
      if (reason instanceof ApiError && reason.status === 404) {
        setBallot(null);
        setBallotError(null);
        if (!user) { void AsyncStorage.removeItem(storageKey(code)); setStoredId(null); }
      }
      else setBallotError(reason instanceof Error ? reason.message : "Couldn't load your votes.");
    }).finally(() => setBallotLoading(false));
  }, [code, ready, storedId, user]);

  if (!ready || storedId === undefined || boardQuery.isPending || ballotLoading) return <Screen bottom style={styles.screen}><Skeleton height={180} /></Screen>;
  if (boardQuery.isError || !boardQuery.data) return <Screen bottom style={styles.screen}><ErrorState title="No tier list at that link" body="Check the voting code and try again." actionLabel="Retry" onAction={() => void boardQuery.refetch()} /></Screen>;
  if (ballotError) return <Screen bottom style={styles.screen}><ErrorState title="Your votes unavailable" body={ballotError} actionLabel="Retry" onAction={() => { setBallotError(null); setBallotLoading(true); if (user) void fetchMyBallot(code).then(setBallot).catch((reason) => setBallotError(String(reason))).finally(() => setBallotLoading(false)); else if (storedId) void fetchBallot(code, storedId, false).then(setBallot).catch((reason) => setBallotError(String(reason))).finally(() => setBallotLoading(false)); }} /></Screen>;
  const { board } = boardQuery.data;
  const books: TierBook[] = boardQuery.data.books.map((book) => ({ Title: book.title, Attribution: book.author, ISBN: book.isbn, ImageId: book.imageId, _coverUrl: book.coverUrl }));
  const allKeys = new Set(books.map(keyOf));
  const cleanBoard = { ...board, pool: board.pool.filter((key) => allKeys.has(key)) };
  const data = working ?? (ballot ? ballotBoard(cleanBoard, ballot.placements) : blankBoard(cleanBoard));
  const blocked = board.access === "members" && !user;
  const canEdit = board.votingOpen && !board.promotedAt && !blocked && (!ballot || editing);
  const showRank = view === "rank" && canEdit && (data.pool.length > 0 || selectedBookKey !== null);
  const placements = toPlacements(data);
  const dirty = JSON.stringify(placements) !== JSON.stringify(ballot?.placements ?? []);
  const changeData = setWorking;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const response = await submitBallot(code, placements, ballot?.ballotId ?? null, Boolean(user));
      setStoredId(response.ballotId);
      setBallot(response);
      setWorking(null);
      setEditing(false);
      setView("board");
      try { await AsyncStorage.setItem(storageKey(code), response.ballotId); }
      catch { setError("Votes submitted, but this device couldn't save your edit link."); }
      await queryClient.invalidateQueries({ queryKey: ["tierlists"] });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't submit your votes.");
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
    {error ? <Toast visible message={error} tone="error" /> : null}
    <SwipeableTabs accessibilityLabel="Tier list view" options={[{ value: "board", label: "My board" }, { value: "community", label: "Community" }]} value={view === "community" ? "community" : "board"} onChange={setView} renderPage={(page, active) => page === "community"
      ? board.histogram || ballot?.results.histogram ? <TierlistResults histogram={board.histogram ?? ballot!.results.histogram} tiers={board.tiers} pool={cleanBoard.pool} books={books} ballotCount={board.ballotCount} eligibleVoteCount={board.eligibleVoteCount} votingOpen={board.votingOpen} promoted={Boolean(board.promotedAt)} ownPlacements={ballot?.placements ?? []} active={active} /> : <ErrorState title="Results unavailable" actionLabel="Retry" onAction={() => void boardQuery.refetch()} />
      : <View style={styles.page}>
        <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{board.promotedAt ? "Permanent reference" : board.votingOpen ? "Voting open" : "Voting closed"} · {ballot ? dirty ? "Unsaved changes" : "Votes submitted" : "Not submitted"}</Text>
        {showRank ? <Pressable accessibilityRole="button" accessibilityLabel="Back to board" onPress={() => { setSelectedBookKey(null); setView("board"); }}><Text {...dynamicType} style={[typography.body, { color: colors.accent }]}>‹ Board</Text></Pressable> : <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{placements.length} of {cleanBoard.pool.length} ranked</Text>}
        {showRank ? <TierSortDeck data={data} books={books} selectedBookKey={selectedBookKey} onAssign={(key, tierId) => { changeData(moveBookTo(data, key, tierId)); if (selectedBookKey || (data.pool.length === 1 && data.pool.includes(key))) { setSelectedBookKey(null); setView("board"); } }} /> : <TierBoard data={data} books={books} onChange={canEdit ? changeData : () => {}} structureEditable={false} poolLabel="Unranked" bottomClearance={76} onReassign={canEdit ? (key) => { setSelectedBookKey(key); setView("rank"); } : undefined} />}
        {blocked && board.votingOpen ? <Button label="Sign in to vote" onPress={() => router.push({ pathname: "/(public)/login", params: { returnTo: `/vote/${code}` } } as never)} /> : null}
        {canEdit && (data.pool.length === 0 || placements.length > 0) ? <View style={[styles.complete, view === "board" && data.pool.length > 0 ? styles.fabClearance : null]}>{data.pool.length === 0 ? <Text {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>All books ranked</Text> : null}<Button label={ballot ? "Update votes" : "Submit votes"} loading={busy} disabled={!dirty || !placements.length} onPress={() => void submit()} /></View> : null}
      </View>} />
    {board.votingOpen && !board.promotedAt && !blocked && view === "board" && (ballot && !editing || canEdit && data.pool.length > 0) ? <Fab icon="tierlist" label={ballot && !editing ? data.pool.length ? "Continue ranking" : "Edit votes" : `Rank · ${data.pool.length} left`} onPress={() => { if (ballot) setEditing(true); setView(data.pool.length ? "rank" : "board"); }} /> : null}
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
  page: { flex: 1, gap: spacing.sm, paddingTop: spacing.md },
  complete: { gap: spacing.sm },
  fabClearance: { paddingBottom: 72 },
  strong: { fontWeight: "700" },
  list: { flexGrow: 0 },
  listContent: { gap: spacing.md, paddingBottom: spacing.md },
  bookRow: { gap: spacing.xs },
});
