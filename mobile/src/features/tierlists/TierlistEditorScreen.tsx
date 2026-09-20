import { useEffect, useState } from "react";
import { Stack, router } from "expo-router";
import { ballotBoard, bookKey, createTier, filterBooks, type TierlistData } from "@scripta/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Linking from "expo-linking";
import { FlatList, Pressable, Share, StyleSheet, Text, View } from "react-native";
import { apiClient } from "../../core/api";
import { Button, Dialog, EmptyState, ErrorState, IconButton, Input, Menu, type MenuItem, Screen, Segmented, Sheet, Skeleton, Toast, dynamicType, spacing, typography, useTheme } from "../../ui";
import { fetchMyBallot, fetchTierlistResults, fetchVotingBoard, openVoting, setVotingState, updateTierlist, type Tierlist } from "./api";
import { moveBookTo } from "./tierBoardData";
import { TierBoard } from "./TierBoard";
import { TierlistResults } from "./TierlistResults";
import { TierSortDeck } from "./TierSortDeck";

interface LibraryResponse { data: { books?: Array<Record<string, unknown>> } | null }

type EditorView = "sort" | "board" | "results";

const VOTE_VIEWS = [{ value: "board", label: "Board" }, { value: "results", label: "Results" }] as const;

export function TierlistEditorScreen({ tierlist, onUpdated, startInRank = false }: { tierlist: Tierlist; onUpdated: (tierlist: Tierlist) => void; startInRank?: boolean }) {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const [current, setCurrent] = useState(tierlist);
  const [name, setName] = useState(tierlist.name);
  const [data, setData] = useState<TierlistData>(tierlist.data);
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [bookSearch, setBookSearch] = useState("");
  const [view, setView] = useState<EditorView>(startInRank && tierlist.voteCode === null && tierlist.data.pool.length > 0 ? "sort" : "board");
  const [selectedBookKey, setSelectedBookKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingVoting, setConfirmingVoting] = useState(false);
  const library = useQuery({ queryKey: ["library"], queryFn: () => apiClient.request<LibraryResponse>("/library", { auth: true }), retry: false });
  const board = useQuery({ queryKey: ["tierlists", "voting", current.voteCode], queryFn: () => fetchVotingBoard(current.voteCode!), enabled: Boolean(current.voteCode), retry: false });
  const results = useQuery({ queryKey: ["tierlists", "results", current.id], queryFn: () => fetchTierlistResults(current.id), enabled: Boolean(current.voteCode), retry: false });
  // Opening voting blanks the tier list document and keeps the owner's own
  // ranking as a seeded ballot, so `data` alone renders an empty board for
  // someone who spent an evening sorting it.
  const myBallot = useQuery({ queryKey: ["tierlists", "ballot", current.voteCode], queryFn: () => fetchMyBallot(current.voteCode!), enabled: Boolean(current.voteCode), retry: false });

  // Keyed on the server's own version, not the object: a background refetch
  // hands back an equal-but-new tierlist, and resetting on that threw away
  // whatever was sorted or dragged since the last save.
  useEffect(() => { setCurrent(tierlist); setName(tierlist.name); setData(tierlist.data); }, [tierlist.id, tierlist.updatedAt]);

  async function run(action: () => Promise<Tierlist>) {
    setBusy(true);
    setError(null);
    try {
      const updated = await action();
      setCurrent(updated);
      setName(updated.name);
      setData(updated.data);
      onUpdated(updated);
      await queryClient.invalidateQueries({ queryKey: ["tierlists"] });
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't save changes.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function openCommunityVoting(access: "anonymous" | "members") {
    setBusy(true);
    setError(null);
    try {
      const { tierlist: published } = await openVoting(current.id, access);
      setCurrent(published);
      setData(published.data);
      onUpdated(published);
      setView("board");
      setConfirmingVoting(false);
      await queryClient.invalidateQueries({ queryKey: ["tierlists"] });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't open voting.");
    } finally {
      setBusy(false);
    }
  }

  const books = library.data?.data?.books ?? [];
  const used = new Set([...data.pool, ...data.tiers.flatMap((tier) => tier.bookKeys)]);
  const availableBooks = filterBooks(books, bookSearch, "all").filter((book) => !used.has(bookKey(book)));
  const frozen = current.voteCode !== null;
  const ballots = board.data?.board.ballotCount ?? 0;
  const myPlacements = myBallot.data?.placements ?? null;
  const boardData = frozen && myPlacements ? ballotBoard(data, myPlacements) : data;
  const save = () => run(() => updateTierlist(current.id, { data }));
  const actionItems: MenuItem[] = frozen
    ? [
      { label: "Share ballot", onPress: () => void Share.share({ message: Linking.createURL(`/vote/${current.voteCode}`) }) },
      { label: current.votingOpen ? "Close voting" : "Reopen voting", onPress: () => void run(() => setVotingState(current.id, { open: !current.votingOpen })) },
      { label: current.voteAccess === "anonymous" ? "Require members" : "Allow anyone", onPress: () => void run(() => setVotingState(current.id, { access: current.voteAccess === "anonymous" ? "members" : "anonymous" })) },
    ]
    : [
      { label: "Rename", onPress: () => setRenaming(true) },
      { label: "Add books", onPress: () => setAdding(true) },
      { label: "Add tier", onPress: () => setData((value) => ({ ...value, tiers: [...value.tiers, createTier("New tier", "#8a8580")] })) },
      { label: "Open voting…", onPress: () => setConfirmingVoting(true) },
    ];

  return <Screen top={false} style={styles.screen}>
    <Stack.Screen options={{
      headerShown: true,
      title: current.name,
      headerRight: () => <View style={styles.headerActions}>
        {!frozen ? <IconButton framed accessibilityLabel="Save changes" name="confirm" onPress={() => void save()} /> : null}
        <Menu title={current.name} items={actionItems}><IconButton framed accessibilityLabel="Tier list actions" name="more" /></Menu>
      </View>,
    }} />
    {error ? <Toast visible message={error} tone="error" /> : null}
    {frozen ? <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>Vote code <Text style={[styles.strong, { color: colors.text }]}>{current.voteCode}</Text> · {ballots} {ballots === 1 ? "ballot" : "ballots"} · {board.data?.board.eligibleVoteCount ?? 0}/100 eligible voters · {current.votingOpen ? "open" : "closed"}</Text> : null}
    {frozen ? <><Segmented accessibilityLabel="View" options={VOTE_VIEWS} value={view === "results" ? "results" : "board"} onChange={setView} /><Button label={myPlacements?.length ? "Edit your ballot" : "Rank your ballot"} variant="secondary" onPress={() => router.push(`/vote/${current.voteCode}` as never)} /></> : view === "sort" ? <Pressable accessibilityRole="button" accessibilityLabel="Back to board" onPress={() => { setSelectedBookKey(null); setView("board"); }}><Text {...dynamicType} style={[typography.body, { color: colors.accent }]}>‹ Board</Text></Pressable> : data.pool.length > 0 ? <Pressable accessibilityRole="button" accessibilityLabel={`Rank ${data.pool.length} remaining books`} onPress={() => setView("sort")} style={styles.rankLink}><Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{data.pool.length} {data.pool.length === 1 ? "book" : "books"} left</Text><Text {...dynamicType} style={[typography.body, styles.strong, { color: colors.accent }]}>Rank remaining →</Text></Pressable> : null}
    {library.isPending || (frozen && myBallot.isPending) ? <Skeleton height={180} /> : library.isError ? <ErrorState body="Your library couldn't be loaded." actionLabel="Retry" onAction={() => void library.refetch()} /> : frozen && view === "results" ? <View style={styles.results}>{results.isPending ? <Skeleton height={140} /> : results.isError ? <ErrorState title="Results unavailable" actionLabel="Retry" onAction={() => void results.refetch()} /> : <TierlistResults histogram={results.data.histogram} tiers={data.tiers} pool={data.pool} books={books} ballotCount={results.data.ballotCount} />}</View> : !frozen && view === "sort" ? <TierSortDeck data={data} books={books} selectedBookKey={selectedBookKey} onAssign={(key, tierId) => { setData((value) => moveBookTo(value, key, tierId)); if (selectedBookKey || (data.pool.length === 1 && data.pool.includes(key))) { setSelectedBookKey(null); setView("board"); } }} /> : <TierBoard data={boardData} books={books} onChange={frozen ? () => {} : setData} structureEditable={!frozen} poolLabel={frozen ? "Unranked" : "Pool"} onReassign={frozen ? undefined : (key) => { setSelectedBookKey(key); setView("sort"); }} />}
    <Sheet visible={adding} title="Add books" onClose={() => setAdding(false)}>
      <Input label="Search books" value={bookSearch} onChangeText={setBookSearch} placeholder="Title or author" autoCapitalize="none" autoCorrect={false} clearButtonMode="while-editing" returnKeyType="search" />
      <FlatList data={availableBooks} keyExtractor={bookKey} style={styles.picker} ListEmptyComponent={<EmptyState title={bookSearch ? "Nothing matches" : "No books to add"} />} renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={`Add ${String(item.Title ?? "Untitled")}`} onPress={() => setData((value) => ({ ...value, pool: [...value.pool, bookKey(item)] }))} style={styles.bookRow}><Text numberOfLines={1} {...dynamicType} style={[typography.body, { color: colors.text }]}>{String(item.Title ?? "Untitled")}</Text></Pressable>} />
    </Sheet>
    <Dialog visible={renaming} title="Rename tier list" onClose={() => setRenaming(false)}>
      <View style={styles.dialog}><Input label="Tier list name" value={name} onChangeText={setName} maxLength={200} /><Button label="Save name" loading={busy} onPress={() => void run(() => updateTierlist(current.id, { name: name.trim() || current.name })).then((okay) => { if (okay) setRenaming(false); })} /></View>
    </Dialog>
    <Dialog visible={confirmingVoting} title="Open voting" onClose={() => setConfirmingVoting(false)}>
      <View style={styles.dialog}>
        <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>This makes “{current.name}” public and locks its name, books, and tiers. At 100 distinct signed-in voters, it becomes an app-owned reference.</Text>
        <Button label="Open to anyone" loading={busy} onPress={() => void openCommunityVoting("anonymous")} />
        <Button label="Members only" variant="secondary" loading={busy} onPress={() => void openCommunityVoting("members")} />
      </View>
    </Dialog>
  </Screen>;
}

const styles = StyleSheet.create({
  screen: { padding: spacing.lg, gap: spacing.md },
  strong: { fontWeight: "700" },
  headerActions: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  results: { flex: 1, gap: spacing.md },
  rankLink: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  picker: { maxHeight: 440 },
  bookRow: { minHeight: 48, justifyContent: "center", paddingVertical: spacing.sm },
  dialog: { gap: spacing.md },
});
