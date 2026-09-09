import { useEffect, useState } from "react";
import { bookKey, filterBooks, type TierlistData } from "@scripta/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Linking from "expo-linking";
import { FlatList, Pressable, Share, StyleSheet, Text, View } from "react-native";
import { apiClient } from "../../core/api";
import { Button, EmptyState, ErrorState, Input, Screen, Sheet, Skeleton, Toast, dynamicType, spacing, typography, useTheme } from "../../ui";
import { fetchTierlistResults, fetchVotingBoard, openVoting, setVotingState, updateTierlist, type Tierlist } from "./api";
import { TierBoard } from "./TierBoard";
import { TierlistResults } from "./TierlistResults";

interface LibraryResponse { data: { books?: Array<Record<string, unknown>> } | null }

export function TierlistEditorScreen({ tierlist, onClose, onUpdated }: { tierlist: Tierlist; onClose: () => void; onUpdated: (tierlist: Tierlist) => void }) {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const [current, setCurrent] = useState(tierlist);
  const [name, setName] = useState(tierlist.name);
  const [data, setData] = useState<TierlistData>(tierlist.data);
  const [adding, setAdding] = useState(false);
  const [bookSearch, setBookSearch] = useState("");
  const [view, setView] = useState<"board" | "results">("board");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const library = useQuery({ queryKey: ["library"], queryFn: () => apiClient.request<LibraryResponse>("/library", { auth: true }), retry: false });
  const board = useQuery({ queryKey: ["tierlists", "voting", current.voteCode], queryFn: () => fetchVotingBoard(current.voteCode!), enabled: Boolean(current.voteCode), retry: false });
  const results = useQuery({ queryKey: ["tierlists", "results", current.id], queryFn: () => fetchTierlistResults(current.id), enabled: Boolean(current.voteCode), retry: false });

  useEffect(() => { setCurrent(tierlist); setName(tierlist.name); setData(tierlist.data); }, [tierlist]);

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
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't save changes.");
    } finally {
      setBusy(false);
    }
  }

  const books = library.data?.data?.books ?? [];
  const used = new Set([...data.pool, ...data.tiers.flatMap((tier) => tier.bookKeys)]);
  const availableBooks = filterBooks(books, bookSearch, "all").filter((book) => !used.has(bookKey(book)));
  const frozen = current.voteCode !== null;
  return <Screen style={styles.screen}>
    <View style={styles.header}><Button label="Back" variant="secondary" onPress={onClose} /><Text accessibilityRole="header" numberOfLines={1} {...dynamicType} style={[typography.title, styles.grow, styles.strong, { color: colors.text }]}>{current.name}</Text></View>
    {error ? <Toast visible message={error} tone="error" /> : null}
    <View style={styles.form}><Input label="Tier list name" value={name} onChangeText={setName} editable={!busy} /><Button label="Save changes" loading={busy} onPress={() => void run(() => updateTierlist(current.id, { name: name.trim() || current.name, data }))} /></View>
    {!frozen ? <View style={styles.row}><Text {...dynamicType} style={[typography.caption, styles.grow, { color: colors.textDim }]}>Open a frozen community copy for voting.</Text><Button label="Open: anyone" variant="secondary" loading={busy} onPress={() => void run(async () => (await openVoting(current.id, "anonymous")).tierlist)} /><Button label="Members" variant="secondary" loading={busy} onPress={() => void run(async () => (await openVoting(current.id, "members")).tierlist)} /></View> : <View style={styles.voting}><Text {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>Vote code: {current.voteCode}</Text><Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{board.data?.board.ballotCount ?? 0} ballots · {current.votingOpen ? "open" : "closed"} · {current.voteAccess === "anonymous" ? "anyone" : "members only"}</Text><View style={styles.row}><Button label="Share ballot" variant="secondary" onPress={() => void Share.share({ message: Linking.createURL(`/vote/${current.voteCode}`) })} /><Button label={current.votingOpen ? "Close voting" : "Reopen voting"} variant="secondary" loading={busy} onPress={() => void run(() => setVotingState(current.id, { open: !current.votingOpen }))} /><Button label={current.voteAccess === "anonymous" ? "Require members" : "Allow anyone"} variant="secondary" loading={busy} onPress={() => void run(() => setVotingState(current.id, { access: current.voteAccess === "anonymous" ? "members" : "anonymous" }))} /></View></View>}
    {frozen ? <View style={styles.row}><Button label="Board" variant={view === "board" ? "primary" : "secondary"} onPress={() => setView("board")} /><Button label="Results" variant={view === "results" ? "primary" : "secondary"} onPress={() => setView("results")} /></View> : null}
    {library.isPending ? <Skeleton height={180} /> : library.isError ? <ErrorState body="Your library couldn't be loaded." actionLabel="Retry" onAction={() => void library.refetch()} /> : !frozen || view === "board" ? <TierBoard data={data} books={books} onChange={frozen ? () => {} : setData} structureEditable={!frozen} onAddBooks={frozen ? undefined : () => setAdding(true)} /> : <View style={styles.results}>{results.isPending ? <Skeleton height={140} /> : results.isError ? <ErrorState title="Results unavailable" actionLabel="Retry" onAction={() => void results.refetch()} /> : <TierlistResults histogram={results.data.histogram} tiers={data.tiers} pool={data.pool} books={books} ballotCount={results.data.ballotCount} />}</View>}
    <Sheet visible={adding} title="Add books" onClose={() => setAdding(false)}>
      <Input label="Search books" value={bookSearch} onChangeText={setBookSearch} placeholder="Title or author" />
      <FlatList data={availableBooks} keyExtractor={bookKey} style={styles.picker} ListEmptyComponent={<EmptyState title={bookSearch ? "Nothing matches" : "No books to add"} />} renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={`Add ${String(item.Title ?? "Untitled")}`} onPress={() => setData((value) => ({ ...value, pool: [...value.pool, bookKey(item)] }))} style={styles.bookRow}><Text numberOfLines={1} {...dynamicType} style={[typography.body, { color: colors.text }]}>{String(item.Title ?? "Untitled")}</Text></Pressable>} />
    </Sheet>
  </Screen>;
}

const styles = StyleSheet.create({
  screen: { padding: spacing.lg, gap: spacing.md },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  grow: { flex: 1 },
  strong: { fontWeight: "700" },
  form: { gap: spacing.sm },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm },
  voting: { gap: spacing.sm },
  results: { flex: 1, gap: spacing.md },
  picker: { maxHeight: 440 },
  bookRow: { minHeight: 48, justifyContent: "center", paddingVertical: spacing.sm },
});
