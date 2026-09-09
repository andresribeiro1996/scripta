import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Button, Dialog, EmptyState, ErrorState, IconButton, Input, Menu, Screen, Segmented, Skeleton, Toast, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { createTierlist, deleteTierlist, fetchTierlists, type Tierlist } from "../tierlists/api";
import { TierlistEditorScreen } from "../tierlists/TierlistEditorScreen";
import { deleteTournament, fetchMyTournaments, type TournamentSummary } from "./api";
import { ArenaSeedScreen } from "./ArenaSeedScreen";

const ARENA_TABS = [
  { value: "tournaments", label: "Tournaments" },
  { value: "tierlists", label: "Tier lists" },
] as const;

type OwnedItem =
  | { id: string; name: string; detail: string; kind: "tournament"; source: TournamentSummary }
  | { id: string; name: string; detail: string; kind: "tierlist"; source: Tierlist };

export function ArenaHomeScreen() {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"tournaments" | "tierlists">("tournaments");
  const [seeding, setSeeding] = useState<TournamentSummary | "new" | null>(null);
  const [editing, setEditing] = useState<Tierlist | null>(null);
  const [deleting, setDeleting] = useState<{ kind: "tournament" | "tierlist"; id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const tournaments = useQuery({ queryKey: ["arena", "mine"], queryFn: fetchMyTournaments, retry: false });
  const tierlists = useQuery({ queryKey: ["tierlists"], queryFn: fetchTierlists, retry: false });

  if (seeding) return <ArenaSeedScreen tournament={seeding === "new" ? undefined : seeding} onClose={() => setSeeding(null)} onStarted={(id) => { setSeeding(null); router.push(`/arena/${id}` as never); }} />;
  if (editing) return <TierlistEditorScreen tierlist={editing} onClose={() => setEditing(null)} onUpdated={(updated) => { setEditing(updated); queryClient.setQueryData<Tierlist[]>(["tierlists"], (items = []) => items.map((item) => item.id === updated.id ? updated : item).concat(items.some((item) => item.id === updated.id) ? [] : [updated])); }} />;

  async function createList() {
    setBusy(true);
    setError(null);
    try {
      const created = await createTierlist("Untitled tier list");
      queryClient.setQueryData<Tierlist[]>(["tierlists"], (items = []) => [...items, created]);
      setEditing(created);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't create a tier list.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    setError(null);
    try {
      if (deleting.kind === "tournament") {
        await deleteTournament(deleting.id);
        await queryClient.invalidateQueries({ queryKey: ["arena", "mine"] });
      } else {
        await deleteTierlist(deleting.id);
        queryClient.setQueryData<Tierlist[]>(["tierlists"], (items = []) => items.filter((item) => item.id !== deleting.id));
      }
      setDeleting(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't delete that item.");
    } finally {
      setBusy(false);
    }
  }

  const query = tab === "tournaments" ? tournaments : tierlists;
  const allItems: OwnedItem[] = tab === "tournaments"
    ? (tournaments.data ?? []).map((item) => ({ id: item.id, name: item.name, detail: `${item.bracketSize} books · ${item.status}`, kind: "tournament" as const, source: item }))
    : (tierlists.data ?? []).map((item) => ({ id: item.id, name: item.name, detail: `${item.data.tiers.length} tiers${item.voteCode ? ` · voting ${item.votingOpen ? "open" : "closed"}` : ""}`, kind: "tierlist" as const, source: item }));
  const needle = search.trim().toLowerCase();
  const items = needle ? allItems.filter((item) => item.name.toLowerCase().includes(needle)) : allItems;
  return <Screen style={styles.screen}>
    <View style={styles.header}><Text accessibilityRole="header" {...dynamicType} style={[typography.heading, styles.strong, styles.grow, { color: colors.text }]}>Arena</Text><Button label="Browse public" variant="secondary" onPress={() => router.push("/arena" as never)} /></View>
    <Segmented accessibilityLabel="Arena section" options={ARENA_TABS} value={tab} onChange={setTab} />
    {error ? <Toast visible message={error} tone="error" /> : null}
    {allItems.length ? <Input label="Search" value={search} onChangeText={setSearch} placeholder={`Search ${tab}`} autoCapitalize="none" autoCorrect={false} clearButtonMode="while-editing" returnKeyType="search" /> : null}
    <Button label={tab === "tournaments" ? "New tournament" : "New tier list"} loading={busy} onPress={() => tab === "tournaments" ? setSeeding("new") : void createList()} />
    {query.isPending ? <Skeleton height={160} /> : query.isError ? <ErrorState body={query.error instanceof Error ? query.error.message : "Couldn't load this list."} actionLabel="Retry" onAction={() => void query.refetch()} /> : <FlatList
      data={items}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      refreshing={query.isRefetching}
      onRefresh={() => void query.refetch()}
      ListEmptyComponent={<EmptyState title={allItems.length ? "Nothing matches" : tab === "tournaments" ? "No tournaments yet" : "No tier lists yet"} body={allItems.length ? "Try a different search." : tab === "tournaments" ? "Create one and seed it from your library." : "Create one to rank books into tiers."} />}
      renderItem={({ item }) => <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Open ${item.name}`} onPress={() => item.kind === "tournament" ? (item.source.status === "seeding" ? setSeeding(item.source) : router.push(`/arena/${item.id}` as never)) : setEditing(item.source)} style={styles.grow}><Text numberOfLines={1} {...dynamicType} style={[typography.title, styles.strong, { color: colors.text }]}>{item.name}</Text><Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{item.detail}</Text></Pressable>
        <Menu
          title={item.name}
          items={[{ label: "Delete", destructive: true, onPress: () => setDeleting({ kind: item.kind, id: item.id, name: item.name }) }]}
        >
          <IconButton accessibilityLabel={`Actions for ${item.name}`} name="ellipsis-horizontal" />
        </Menu>
      </View>}
    />}
    <Dialog visible={deleting !== null} title={`Delete “${deleting?.name ?? ""}”?`} onClose={() => setDeleting(null)}><View style={styles.dialog}><Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>This cannot be undone.</Text><Button label="Delete" variant="destructive" loading={busy} onPress={() => void remove()} /></View></Dialog>
  </Screen>;
}

const styles = StyleSheet.create({
  screen: { padding: spacing.lg, gap: spacing.md },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  grow: { flex: 1 },
  strong: { fontWeight: "700" },
  list: { gap: spacing.sm, paddingBottom: spacing.huge },
  card: { minHeight: 92, borderWidth: 1, borderRadius: radii.lg, padding: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.md },
  dialog: { gap: spacing.md },
});
