import { useEffect, useState } from "react";
import { Stack, router } from "expo-router";
import { bookKey, filterBooks, type TierlistData } from "@scripta/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Linking from "expo-linking";
import { FlatList, Pressable, Share, StyleSheet, Text, View } from "react-native";
import { apiClient } from "../../core/api";
import { Button, Dialog, EmptyState, ErrorState, Input, Screen, Segmented, Sheet, Skeleton, Toast, dynamicType, spacing, typography, useTheme } from "../../ui";
import { fetchTierlistResults, fetchVotingBoard, openVoting, setVotingState, updateTierlist, type Tierlist } from "./api";
import { TierBoard } from "./TierBoard";
import { TierlistResults } from "./TierlistResults";

interface LibraryResponse { data: { books?: Array<Record<string, unknown>> } | null }

const VIEW_OPTIONS = [
  { value: "board", label: "Board" },
  { value: "results", label: "Results" },
] as const;

export function TierlistEditorScreen({ tierlist, onUpdated }: { tierlist: Tierlist; onUpdated: (tierlist: Tierlist) => void }) {
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
  const [confirmingVoting, setConfirmingVoting] = useState(false);
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

  // Opening voting duplicates this tier list into a separate, publicly listed
  // copy — a distinct entity with its own id, not a state change on the one
  // being edited. So this pushes a new screen for it rather than swapping
  // `current` in place under the original's route.
  async function openCommunityVoting(access: "anonymous" | "members") {
    setBusy(true);
    setError(null);
    try {
      const { tierlist: copy } = await openVoting(current.id, access);
      queryClient.setQueryData<Tierlist[]>(["tierlists"], (items = []) => [...items, copy]);
      setConfirmingVoting(false);
      router.push(`/tierlist/${copy.id}` as never);
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
  return <Screen top={false} style={styles.screen}>
    <Stack.Screen options={{ headerShown: true, title: current.name }} />
    {error ? <Toast visible message={error} tone="error" /> : null}
    <View style={styles.form}><Input label="Tier list name" value={name} onChangeText={setName} editable={!busy} /><Button label="Save changes" loading={busy} onPress={() => void run(() => updateTierlist(current.id, { name: name.trim() || current.name, data }))} /></View>
    {!frozen ? <View style={styles.stack}><Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>Open a frozen community copy for voting.</Text><Button label="Open voting" variant="secondary" onPress={() => setConfirmingVoting(true)} /></View> : <View style={styles.voting}><Text {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>Vote code: {current.voteCode}</Text><Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{board.data?.board.ballotCount ?? 0} ballots · {current.votingOpen ? "open" : "closed"} · {current.voteAccess === "anonymous" ? "anyone" : "members only"}</Text><View style={styles.stack}><Button label="Share ballot" variant="secondary" onPress={() => void Share.share({ message: Linking.createURL(`/vote/${current.voteCode}`) })} /><Button label={current.votingOpen ? "Close voting" : "Reopen voting"} variant="secondary" loading={busy} onPress={() => void run(() => setVotingState(current.id, { open: !current.votingOpen }))} /><Button label={current.voteAccess === "anonymous" ? "Require members" : "Allow anyone"} variant="secondary" loading={busy} onPress={() => void run(() => setVotingState(current.id, { access: current.voteAccess === "anonymous" ? "members" : "anonymous" }))} /></View></View>}
    {frozen ? <Segmented accessibilityLabel="View" options={VIEW_OPTIONS} value={view} onChange={setView} /> : null}
    {library.isPending ? <Skeleton height={180} /> : library.isError ? <ErrorState body="Your library couldn't be loaded." actionLabel="Retry" onAction={() => void library.refetch()} /> : !frozen || view === "board" ? <TierBoard data={data} books={books} onChange={frozen ? () => {} : setData} structureEditable={!frozen} onAddBooks={frozen ? undefined : () => setAdding(true)} /> : <View style={styles.results}>{results.isPending ? <Skeleton height={140} /> : results.isError ? <ErrorState title="Results unavailable" actionLabel="Retry" onAction={() => void results.refetch()} /> : <TierlistResults histogram={results.data.histogram} tiers={data.tiers} pool={data.pool} books={books} ballotCount={results.data.ballotCount} />}</View>}
    <Sheet visible={adding} title="Add books" onClose={() => setAdding(false)}>
      <Input label="Search books" value={bookSearch} onChangeText={setBookSearch} placeholder="Title or author" autoCapitalize="none" autoCorrect={false} clearButtonMode="while-editing" returnKeyType="search" />
      <FlatList data={availableBooks} keyExtractor={bookKey} style={styles.picker} ListEmptyComponent={<EmptyState title={bookSearch ? "Nothing matches" : "No books to add"} />} renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={`Add ${String(item.Title ?? "Untitled")}`} onPress={() => setData((value) => ({ ...value, pool: [...value.pool, bookKey(item)] }))} style={styles.bookRow}><Text numberOfLines={1} {...dynamicType} style={[typography.body, { color: colors.text }]}>{String(item.Title ?? "Untitled")}</Text></Pressable>} />
    </Sheet>
    <Dialog visible={confirmingVoting} title="Open voting" onClose={() => setConfirmingVoting(false)}>
      <View style={styles.dialog}>
        <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>This creates a separate, public copy of “{current.name}” that anyone with the link can vote on. The original stays private and editable; the copy's tiers and pool are locked once voting opens.</Text>
        <Button label="Open to anyone" loading={busy} onPress={() => void openCommunityVoting("anonymous")} />
        <Button label="Members only" variant="secondary" loading={busy} onPress={() => void openCommunityVoting("members")} />
      </View>
    </Dialog>
  </Screen>;
}

const styles = StyleSheet.create({
  screen: { padding: spacing.lg, gap: spacing.md },
  strong: { fontWeight: "700" },
  form: { gap: spacing.sm },
  stack: { gap: spacing.sm },
  voting: { gap: spacing.sm },
  results: { flex: 1, gap: spacing.md },
  picker: { maxHeight: 440 },
  bookRow: { minHeight: 48, justifyContent: "center", paddingVertical: spacing.sm },
  dialog: { gap: spacing.md },
});
