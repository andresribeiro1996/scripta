import { useState } from "react";
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Button, Dialog, EmptyState, ErrorState, Fab, Icon, IconButton, Input, Screen, Skeleton, SwipeableTabs, Toast, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { deleteTierlist, fetchTierlists, fetchVotedTierlists, type Tierlist, type VotedTierlist } from "../tierlists/api";
import { deleteTournament, fetchMyTournaments, fetchVotedTournaments, type TournamentSummary } from "./api";
import {
  ARENA_TABS,
  coverRemainder,
  emptyCopy,
  filterSections,
  homeSections,
  ownedItems,
  previewCovers,
  tierDistribution,
  tournamentProgress,
  votedTierlistDetail,
  type ArenaTab,
  type OwnedItem,
  type SectionedItem,
} from "./arenaHome";

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
  const votedTournaments = useQuery({ queryKey: ["arena", "voted"], queryFn: fetchVotedTournaments, retry: false });
  const votedTierlists = useQuery({ queryKey: ["tierlists", "voted"], queryFn: fetchVotedTierlists, retry: false });

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
        title: "Games",
        // The bottom tab already reads "Arena"; a large title spends a third of
        // the screen repeating it above a list that has nowhere else to go.
        headerLargeTitleEnabled: false,
        headerRight: () => <IconButton accessibilityLabel="Browse games" label="Browse" name="public" onPress={() => router.push("/arena" as never)} />,
      }}
    />
    {error ? <Toast visible message={error} tone="error" /> : null}
    <SwipeableTabs
      accessibilityLabel="Games section"
      options={ARENA_TABS}
      value={tab}
      onChange={setTab}
      renderPage={(pageTab) => {
        const owned = ownedItems(pageTab, tournaments.data ?? [], tierlists.data ?? []);
        const voted = pageTab === "tournaments" ? votedTournaments : votedTierlists;
        return <ArenaList
          tab={pageTab}
          query={pageTab === "tournaments" ? tournaments : tierlists}
          votedQuery={voted}
          sections={homeSections(pageTab, owned, votedTournaments.data ?? [], votedTierlists.data ?? [])}
          rowCount={owned.length + (voted.data?.length ?? 0)}
          onOpen={open}
          onDelete={setDeleting}
        />;
      }}
    />
    <Fab
      label={tab === "tournaments" ? "New tournament" : "New tier list"}
      loading={busy && !deleting}
      onPress={() => tab === "tournaments" ? router.push("/seed/new" as never) : router.push("/tierlist/new" as never)}
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
  votedQuery,
  sections,
  rowCount,
  onOpen,
  onDelete,
}: {
  tab: ArenaTab;
  query: UseQueryResult<unknown>;
  votedQuery: UseQueryResult<unknown>;
  sections: SectionedItem[];
  rowCount: number;
  onOpen: (item: OwnedItem) => void;
  onDelete: (doomed: Doomed) => void;
}) {
  const { colors } = useTheme();
  const [search, setSearch] = useState("");
  const visible = filterSections(sections, search);
  const empty = emptyCopy(tab, rowCount > 0);

  if (query.isPending) return <View style={styles.page}><Skeleton height={160} /></View>;
  if (query.isError) return <View style={styles.page}><ErrorState body={query.error instanceof Error ? query.error.message : "Couldn't load this list."} actionLabel="Retry" onAction={() => void query.refetch()} /></View>;

  return <FlatList
    data={visible}
    keyExtractor={(item) => item.key}
    contentContainerStyle={styles.list}
    refreshing={query.isRefetching || votedQuery.isRefetching}
    onRefresh={() => {
      void query.refetch();
      void votedQuery.refetch();
    }}
    keyboardShouldPersistTaps="handled"
    // In the list header rather than pinned above it: searching is something
    // you reach for, and as fixed chrome it appearing with the first item
    // shoved the whole screen down.
    ListHeaderComponent={rowCount ? <Input icon="search" accessibilityLabel={`Search ${tab === "tournaments" ? "tournaments" : "tier lists"}`} value={search} onChangeText={setSearch} placeholder={`Search ${tab === "tournaments" ? "tournaments" : "tier lists"}`} autoCapitalize="none" autoCorrect={false} clearButtonMode="while-editing" returnKeyType="search" /> : null}
    ListEmptyComponent={<EmptyState title={empty.title} body={empty.body} />}
    ListFooterComponent={votedQuery.isError ? <ErrorState body="Couldn't load the games you voted in." actionLabel="Retry" onAction={() => void votedQuery.refetch()} /> : null}
    renderItem={({ item }) => {
      if (item.kind === "header") {
        return <Text {...dynamicType} style={[typography.caption, styles.sectionHeader, styles.strong, { color: colors.textDim }]}>{item.title}</Text>;
      }
      if (item.kind === "owned") {
        return <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Open ${item.item.name}`} onPress={() => onOpen(item.item)} style={styles.grow}>
            {item.item.kind === "tournament" ? <TournamentBody tournament={item.item.source} /> : <TierlistBody item={item.item} />}
          </Pressable>
          <IconButton
            accessibilityLabel={`Delete ${item.item.name}`}
            name="delete"
            tone="danger"
            onPress={() => onDelete({ kind: item.item.kind, id: item.item.id, name: item.item.name })}
          />
        </View>;
      }
      const name = item.kind === "votedTournament" ? item.tournament.name : item.tierlist.name;
      return <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${name}`}
        onPress={() => router.push(item.target as never)}
        style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        {item.kind === "votedTournament" ? <TournamentBody tournament={item.tournament} /> : <VotedTierlistBody tierlist={item.tierlist} />}
      </Pressable>;
    }}
  />;
}


// Covers when the pool has art, a bracket-size tile when it doesn't: a
// tournament seeded from books whose covers never resolved would otherwise
// leave an empty strip where the art should be.
function TournamentBody({ tournament }: { tournament: TournamentSummary }) {
  const { colors } = useTheme();
  const progress = tournamentProgress(tournament);
  const remainder = coverRemainder(tournament);
  const covers = previewCovers(tournament);
  const tone = tournament.status === "active"
    ? { backgroundColor: colors.accentSoft, color: colors.accent }
    : tournament.status === "completed"
      ? { backgroundColor: colors.successSoft, color: colors.success }
      : { backgroundColor: colors.border, color: colors.textDim };

  return <View style={styles.row}>
    {tournament.winner ? (
      tournament.winner.cover ? <Image
        accessibilityLabel={`Winner: ${tournament.winner.title}`}
        source={{ uri: tournament.winner.cover }}
        contentFit="cover"
        style={[styles.tile, styles.winnerTile, { borderWidth: 2, borderColor: colors.success }]}
      /> : <View accessibilityLabel={`Winner: ${tournament.winner.title}`} style={[styles.tile, styles.winnerTile, { backgroundColor: colors.successSoft, borderWidth: 2, borderColor: colors.success }]}>
        <Icon filled name="arena" size={24} color={colors.success} />
      </View>
    ) : tournament.covers.length === 0 ? <View style={[styles.tile, { backgroundColor: colors.accentSoft }]}>
      <Text {...dynamicType} style={[styles.tileCount, { color: colors.accent }]}>{tournament.bracketSize}</Text>
      <Text {...dynamicType} style={[styles.tileLabel, { color: colors.accent }]}>BOOKS</Text>
    </View> : null}
    <View style={styles.grow}>
      <Text numberOfLines={1} {...dynamicType} style={[typography.title, styles.strong, { color: colors.text }]}>{tournament.name}</Text>
      {covers.length ? <View style={styles.covers}>
        {covers.map((cover, index) => <Image
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
        {progress.label ? <Text numberOfLines={1} {...dynamicType} style={[typography.caption, styles.grow, { color: colors.textDim }]}>{progress.label}</Text> : null}
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

// Someone else's poll the account voted on — its ladder is the owner's
// answer key, not the viewer's ballot, so no tier distribution here.
function VotedTierlistBody({ tierlist }: { tierlist: VotedTierlist }) {
  const { colors } = useTheme();
  return <View style={styles.grow}>
    <Text numberOfLines={1} {...dynamicType} style={[typography.title, styles.strong, { color: colors.text }]}>{tierlist.name}</Text>
    <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{votedTierlistDetail(tierlist)}</Text>
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
  sectionHeader: { marginTop: spacing.lg, marginBottom: spacing.xs, textTransform: "uppercase", letterSpacing: 0.8 },
  pill: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radii.full },
  pillText: { fontSize: 11, lineHeight: 15, fontWeight: "700", letterSpacing: 0.5 },
  tile: { width: 56, height: 56, borderRadius: radii.md, alignItems: "center", justifyContent: "center" },
  winnerTile: { height: 84 },
  tileCount: { fontSize: 20, lineHeight: 24, fontWeight: "700" },
  tileLabel: { fontSize: 9, lineHeight: 12, letterSpacing: 0.8 },
  distribution: { flexDirection: "row", gap: 2, height: 6, marginTop: spacing.sm },
  segment: { borderRadius: 3, flexBasis: 0 },
  dialog: { gap: spacing.md },
});
