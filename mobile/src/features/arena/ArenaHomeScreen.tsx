import { useState } from "react";
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Button, Dialog, EmptyState, ErrorState, Fab, IconButton, Input, Menu, Screen, Skeleton, SwipeableTabs, Toast, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { createTierlist, deleteTierlist, fetchTierlists, type Tierlist } from "../tierlists/api";
import { deleteTournament, fetchMyTournaments, type TournamentSummary } from "./api";
import { ARENA_TABS, coverRemainder, emptyCopy, filterItems, ownedItems, tierDistribution, tournamentProgress, type ArenaTab, type OwnedItem } from "./arenaHome";

type Doomed = { kind: "tournament" | "tierlist"; id: string; name: string };

export function ArenaHomeScreen() {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<ArenaTab>("tournaments");
  const [deleting, setDeleting] = useState<Doomed | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tournaments = useQuery({ queryKey: ["arena", "mine"], queryFn: fetchMyTournaments, retry: false });
  const tierlists = useQuery({ queryKey: ["tierlists"], queryFn: fetchTierlists, retry: false });

  async function createList() {
    setBusy(true);
    setError(null);
    try {
      const created = await createTierlist("Untitled tier list");
      queryClient.setQueryData<Tierlist[]>(["tierlists"], (items = []) => [...items, created]);
      router.push(`/tierlist/${created.id}` as never);
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

  // A tournament still being seeded reopens its seeding screen; anything else
  // opens the bracket. Both are pushes, so the back gesture unwinds them.
  function open(item: OwnedItem) {
    if (item.kind === "tierlist") return router.push(`/tierlist/${item.id}` as never);
    return router.push((item.source.status === "seeding" ? `/seed/${item.id}` : `/arena/${item.id}`) as never);
  }

  return <Screen top={false}>
    <Stack.Screen
      options={{
        headerShown: true,
        title: "Arena",
        // The bottom tab already reads "Arena"; a large title spends a third of
        // the screen repeating it above a list that has nowhere else to go.
        headerLargeTitleEnabled: false,
        headerRight: () => <IconButton accessibilityLabel="Browse public arena" label="Browse" name="public" onPress={() => router.push("/arena" as never)} />,
      }}
    />
    {error ? <Toast visible message={error} tone="error" /> : null}
    <SwipeableTabs
      accessibilityLabel="Arena section"
      options={ARENA_TABS}
      value={tab}
      onChange={setTab}
      renderPage={(pageTab) => <ArenaList
        tab={pageTab}
        query={pageTab === "tournaments" ? tournaments : tierlists}
        items={ownedItems(pageTab, tournaments.data ?? [], tierlists.data ?? [])}
        onOpen={open}
        onDelete={setDeleting}
      />}
    />
    <Fab
      label={tab === "tournaments" ? "New tournament" : "New tier list"}
      loading={busy && !deleting}
      onPress={() => tab === "tournaments" ? router.push("/seed/new" as never) : void createList()}
    />
    <Dialog visible={deleting !== null} title={`Delete “${deleting?.name ?? ""}”?`} onClose={() => setDeleting(null)}><View style={styles.dialog}><Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>This cannot be undone.</Text><Button label="Delete" variant="destructive" loading={busy} onPress={() => void remove()} /></View></Dialog>
  </Screen>;
}

// Each tab is its own list with its own scroll position and its own search
// box. Sharing one search across both tabs silently filtered the tab you
// weren't looking at.
function ArenaList({
  tab,
  query,
  items,
  onOpen,
  onDelete,
}: {
  tab: ArenaTab;
  query: UseQueryResult<unknown>;
  items: OwnedItem[];
  onOpen: (item: OwnedItem) => void;
  onDelete: (doomed: Doomed) => void;
}) {
  const { colors } = useTheme();
  const [search, setSearch] = useState("");
  const visible = filterItems(items, search);
  const empty = emptyCopy(tab, items.length > 0);

  if (query.isPending) return <View style={styles.page}><Skeleton height={160} /></View>;
  if (query.isError) return <View style={styles.page}><ErrorState body={query.error instanceof Error ? query.error.message : "Couldn't load this list."} actionLabel="Retry" onAction={() => void query.refetch()} /></View>;

  return <FlatList
    data={visible}
    keyExtractor={(item) => item.id}
    contentContainerStyle={styles.list}
    refreshing={query.isRefetching}
    onRefresh={() => void query.refetch()}
    keyboardShouldPersistTaps="handled"
    // In the list header rather than pinned above it: searching is something
    // you reach for, and as fixed chrome it appearing with the first item
    // shoved the whole screen down.
    ListHeaderComponent={items.length ? <Input label="Search" value={search} onChangeText={setSearch} placeholder={`Search ${tab === "tournaments" ? "tournaments" : "tier lists"}`} autoCapitalize="none" autoCorrect={false} clearButtonMode="while-editing" returnKeyType="search" /> : null}
    ListEmptyComponent={<EmptyState title={empty.title} body={empty.body} />}
    renderItem={({ item }) => <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Open ${item.name}`} onPress={() => onOpen(item)} style={styles.grow}>
        {item.kind === "tournament" ? <TournamentBody tournament={item.source} /> : <TierlistBody item={item} />}
      </Pressable>
      <Menu
        title={item.name}
        items={[{ label: "Delete", destructive: true, onPress: () => onDelete({ kind: item.kind, id: item.id, name: item.name }) }]}
      >
        <IconButton accessibilityLabel={`Actions for ${item.name}`} name="more" />
      </Menu>
    </View>}
  />;
}


// Covers when the pool has art, a bracket-size tile when it doesn't: a
// tournament seeded from books whose covers never resolved would otherwise
// leave an empty strip where the art should be.
function TournamentBody({ tournament }: { tournament: TournamentSummary }) {
  const { colors } = useTheme();
  const progress = tournamentProgress(tournament);
  const remainder = coverRemainder(tournament);
  const tone = tournament.status === "active"
    ? { backgroundColor: colors.accentSoft, color: colors.accent }
    : tournament.status === "completed"
      ? { backgroundColor: colors.successSoft, color: colors.success }
      : { backgroundColor: colors.border, color: colors.textDim };

  return <View style={styles.row}>
    {tournament.covers.length === 0 ? <View style={[styles.tile, { backgroundColor: colors.accentSoft }]}>
      <Text {...dynamicType} style={[styles.tileCount, { color: colors.accent }]}>{tournament.bracketSize}</Text>
      <Text {...dynamicType} style={[styles.tileLabel, { color: colors.accent }]}>BOOKS</Text>
    </View> : null}
    <View style={styles.grow}>
      <Text numberOfLines={1} {...dynamicType} style={[typography.title, styles.strong, { color: colors.text }]}>{tournament.name}</Text>
      {tournament.covers.length ? <View style={styles.covers}>
        {tournament.covers.map((cover, index) => <Image
          key={cover}
          source={{ uri: cover }}
          contentFit="cover"
          style={[styles.cover, { borderColor: colors.border }, index > 0 ? styles.coverOverlap : null]}
        />)}
        {remainder ? <Text {...dynamicType} style={[typography.caption, styles.coverMore, { color: colors.textDim }]}>{`+${remainder}`}</Text> : null}
      </View> : null}
      <View style={styles.statusLine}>
        <View style={[styles.pill, { backgroundColor: tone.backgroundColor }]}>
          <Text {...dynamicType} style={[styles.pillText, { color: tone.color }]}>{tournament.status.toUpperCase()}</Text>
        </View>
        <Text numberOfLines={1} {...dynamicType} style={[typography.caption, styles.grow, { color: colors.textDim }]}>{progress.label}</Text>
      </View>
    </View>
  </View>;
}

function TierlistBody({ item }: { item: Extract<OwnedItem, { kind: "tierlist" }> }) {
  const { colors } = useTheme();
  const segments = tierDistribution(item.source.data.tiers);

  return <View>
    <Text numberOfLines={1} {...dynamicType} style={[typography.title, styles.strong, { color: colors.text }]}>{item.name}</Text>
    <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{item.detail}</Text>
    {segments.length ? <View
      accessibilityRole="image"
      accessibilityLabel={`${segments.length} tiers`}
      style={styles.distribution}
    >
      {segments.map((segment, index) => <View
        key={`${segment.color}-${index}`}
        style={[styles.segment, { backgroundColor: segment.color, flexGrow: segment.weight }]}
      />)}
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  strong: { fontWeight: "700" },
  // flex so a centred EmptyState/ErrorState has a height to centre within —
  // StatePanel grows and centres itself, which needs a parent that has room.
  page: { flex: 1, padding: spacing.lg },
  // flexGrow does the same job for the list's own empty state; paddingBottom
  // clears the extended FAB so the last card isn't sitting under it.
  list: { padding: spacing.lg, gap: spacing.sm, paddingBottom: 96, flexGrow: 1 },
  card: { minHeight: 92, borderWidth: 1, borderRadius: radii.lg, padding: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.md },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  covers: { flexDirection: "row", alignItems: "center", marginTop: spacing.sm },
  cover: { width: 26, height: 38, borderRadius: radii.sm, borderWidth: 1 },
  coverOverlap: { marginLeft: -9 },
  coverMore: { marginLeft: spacing.sm },
  statusLine: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.xs },
  pill: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radii.full },
  pillText: { fontSize: 11, lineHeight: 15, fontWeight: "700", letterSpacing: 0.5 },
  tile: { width: 56, height: 56, borderRadius: radii.md, alignItems: "center", justifyContent: "center" },
  tileCount: { fontSize: 20, lineHeight: 24, fontWeight: "700" },
  tileLabel: { fontSize: 9, lineHeight: 12, letterSpacing: 0.8 },
  distribution: { flexDirection: "row", gap: 2, height: 6, marginTop: spacing.sm },
  segment: { borderRadius: 3, flexBasis: 0 },
  dialog: { gap: spacing.md },
});
