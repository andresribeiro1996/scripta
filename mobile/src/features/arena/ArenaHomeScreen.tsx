import { useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import { booksByWork } from "@scripta/shared";
import { FlatList, StyleSheet, View } from "react-native";
import { Text } from "../../ui/Text";
import { Button, Dialog, EmptyState, ErrorState, Fab, Screen, SearchDock, Sheet, Skeleton, SwipeableTabs, Toast, dynamicType, searchDockFabClearance, spacing, typography, useTheme, type IconName } from "../../ui";
import { useLibrary, useWorkBooks } from "../library";
import { DiscoverPane } from "../community/DiscoverPane";
import { GameRow, type RowCover } from "../community/DiscoverRow";
import { deleteQuiz, fetchQuizzes, type Quiz } from "../quizzes/api";
import { deleteTierlist, fetchTierlists, fetchVotedTierlists, type Tierlist, type VotedTierlist } from "../tierlists/api";
import { deleteTournament, fetchMyTournaments, fetchVotedTournaments, type Tournament } from "./api";
import {
  DELETE_EFFECT,
  GAMES_TABS,
  NEW_GAMES,
  OWNER_FILTERS,
  emptyCopy,
  gameRow,
  homeSections,
  nextOwnerFilter,
  ownedItems,
  tierlistCovers,
  type ArenaTab,
  type GamesTab,
  type OwnedItem,
  type OwnerFilter,
} from "./arenaHome";

type Doomed = { kind: "tournament" | "tierlist" | "quiz"; id: string; name: string };

const noVoted = { data: [], isPending: false, isRefetching: false, isError: false, refetch: () => {} };

const OWNER_FILTER_ICONS: Record<OwnerFilter, IconName> = { all: "filter", mine: "profile", voted: "vote" };

export function ArenaHomeScreen() {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<GamesTab>(GAMES_TABS[0].value);
  const [choosing, setChoosing] = useState(false);
  const [deleting, setDeleting] = useState<Doomed | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tournaments = useQuery({ queryKey: ["arena", "mine"], queryFn: fetchMyTournaments, retry: false });
  const tierlists = useQuery({ queryKey: ["tierlists"], queryFn: fetchTierlists, retry: false });
  const quizzes = useQuery({ queryKey: ["quizzes"], queryFn: fetchQuizzes, retry: false });
  const votedTournaments = useQuery({ queryKey: ["arena", "voted"], queryFn: fetchVotedTournaments, retry: false });
  const votedTierlists = useQuery({ queryKey: ["tierlists", "voted"], queryFn: fetchVotedTierlists, retry: false });
  const library = useLibrary();
  const libraryBooks = useWorkBooks(library.data);
  const byWork = useMemo(() => booksByWork(libraryBooks), [libraryBooks]);

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    setError(null);
    try {
      if (deleting.kind === "tournament") {
        await deleteTournament(deleting.id);
        await queryClient.invalidateQueries({ queryKey: ["arena", "mine"] });
      } else if (deleting.kind === "quiz") {
        await deleteQuiz(deleting.id);
        queryClient.setQueryData<Quiz[]>(["quizzes"], (items = []) => items.filter((item) => item.id !== deleting.id));
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
    if (item.kind === "quiz") return router.push(`/quiz/${item.id}` as never);
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
      }}
    />
    {error ? <Toast visible message={error} tone="error" /> : null}
    <SwipeableTabs
      accessibilityLabel="Games section"
      options={GAMES_TABS}
      value={tab}
      onChange={setTab}
      renderPage={(pageTab) => {
        if (pageTab === "browse") return <DiscoverPane fab={<Fab label="New" accessibilityLabel="New game" onPress={() => setChoosing(true)} />} />;
        const owned = ownedItems(pageTab, tournaments.data ?? [], tierlists.data ?? [], quizzes.data ?? []);
        const voted = pageTab === "tournaments" ? votedTournaments : pageTab === "tierlists" ? votedTierlists : noVoted;
        return <ArenaList
          tab={pageTab}
          query={pageTab === "tournaments" ? tournaments : pageTab === "tierlists" ? tierlists : quizzes}
          votedQuery={voted}
          owned={owned}
          votedTournaments={votedTournaments.data ?? []}
          votedTierlists={votedTierlists.data ?? []}
          byWork={byWork}
          rowCount={owned.length + (voted.data?.length ?? 0)}
          onOpen={open}
          onDelete={setDeleting}
          fab={<Fab
            label="New"
            accessibilityLabel={pageTab === "tournaments" ? "New tournament" : pageTab === "quizzes" ? "New quiz" : "New tier list"}
            onPress={() => router.push(NEW_GAMES.find((option) => option.tab === pageTab)!.href as never)}
          />}
        />;
      }}
    />
    <Dialog visible={deleting !== null} title={`Delete “${deleting?.name ?? ""}”?`} onClose={() => setDeleting(null)}><View style={styles.dialog}><Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{deleting ? `${DELETE_EFFECT[deleting.kind]} This can't be undone.` : ""}</Text><Button label="Delete" variant="destructive" loading={busy} onPress={() => void remove()} /></View></Dialog>
    <Sheet visible={choosing} title="New game" onClose={() => setChoosing(false)}>
      <View style={styles.dialog}>
        {NEW_GAMES.map((option) => (
          <Button
            key={option.href}
            label={option.label}
            variant="secondary"
            onPress={() => {
              setChoosing(false);
              router.push(option.href as never);
            }}
          />
        ))}
      </View>
    </Sheet>
  </Screen>;
}

// Each tab is its own list with its own scroll position and its own search
// box. Sharing one search across both tabs silently filtered the tab you
// weren't looking at.
function ArenaList({
  tab,
  query,
  votedQuery,
  owned,
  votedTournaments,
  votedTierlists,
  byWork,
  rowCount,
  onOpen,
  onDelete,
  fab,
}: {
  tab: ArenaTab;
  query: UseQueryResult<unknown>;
  votedQuery: { isPending: boolean; isRefetching: boolean; isError: boolean; refetch: () => void };
  owned: OwnedItem[];
  votedTournaments: Tournament[];
  votedTierlists: VotedTierlist[];
  byWork: Map<string, Record<string, unknown>>;
  rowCount: number;
  onOpen: (item: OwnedItem) => void;
  onDelete: (doomed: Doomed) => void;
  fab: ReactNode;
}) {
  const { colors } = useTheme();
  const [search, setSearch] = useState("");
  const [owner, setOwner] = useState<OwnerFilter>("all");
  const filtering = rowCount > 0;
  const activeOwner = filtering ? owner : "all";
  const visible = homeSections(tab, owned, votedTournaments, votedTierlists, activeOwner, filtering ? search : "");
  const empty = emptyCopy(tab, filtering && search.trim() !== "", activeOwner);
  const votedUnknown = activeOwner === "voted" && (votedQuery.isPending || votedQuery.isError);
  const noun = tab === "tournaments" ? "tournaments" : tab === "tierlists" ? "tier lists" : "quizzes";
  const ownerOption = OWNER_FILTERS.find((option) => option.value === owner)!;

  return <SearchDock
    value={search}
    onChangeText={setSearch}
    accessibilityLabel={`Search ${noun}`}
    placeholder={`Search ${noun}`}
    hidden={!filtering}
    fab={filtering || query.isPending || query.isError ? fab : undefined}
    cycle={tab === "quizzes" ? undefined : {
      icon: OWNER_FILTER_ICONS[owner],
      active: owner !== "all",
      accessibilityLabel: `Showing ${ownerOption.label.toLowerCase()}`,
      accessibilityHint: "Switches to the next filter",
      onPress: () => setOwner(nextOwnerFilter(owner)),
    }}
  >
    {(scrollProps) => query.isPending ? <View style={styles.page}><Skeleton height={160} /></View>
      : query.isError ? <View style={styles.page}><ErrorState body={query.error instanceof Error ? query.error.message : "Couldn't load this list."} actionLabel="Retry" onAction={() => void query.refetch()} /></View>
      : <FlatList
      {...scrollProps}
      data={visible}
      keyExtractor={(item) => item.key}
      contentContainerStyle={styles.list}
      refreshing={query.isRefetching || votedQuery.isRefetching}
      onRefresh={() => {
        void query.refetch();
        void votedQuery.refetch();
      }}
      ListEmptyComponent={votedUnknown ? null : <View style={styles.page}><EmptyState title={empty.title} body={empty.body} actionLabel={empty.action} onAction={empty.action ? () => router.push(NEW_GAMES.find((option) => option.tab === tab)!.href as never) : undefined} /></View>}
      ListFooterComponent={votedQuery.isError ? <View style={styles.page}><ErrorState body="Couldn't load the games you voted in." actionLabel="Retry" onAction={() => void votedQuery.refetch()} /></View> : null}
      renderItem={({ item }) => {
        if (item.kind === "header") {
          return <Text {...dynamicType} style={[typography.title, styles.sectionHeader, styles.strong, { color: colors.text }]}>{item.title}</Text>;
        }
        const row = gameRow(item);
        if (item.kind === "owned") {
          const covers: RowCover[] = item.item.kind === "tierlist" ? tierlistCovers(item.item.source.data, byWork) : row.covers;
          return <GameRow {...row} covers={covers} onPress={() => onOpen(item.item)} onDelete={() => onDelete({ kind: item.item.kind, id: item.item.id, name: item.item.name })} />;
        }
        return <GameRow {...row} onPress={() => router.push(item.target as never)} />;
      }}
    />}
  </SearchDock>;
}

const styles = StyleSheet.create({
  strong: { fontWeight: "700" },
  // flex so a centred EmptyState/ErrorState has a height to centre within —
  // StatePanel grows and centres itself, which needs a parent that has room.
  page: { flex: 1, padding: spacing.lg },
  list: { paddingTop: spacing.lg - spacing.md, paddingBottom: searchDockFabClearance, flexGrow: 1 },
  sectionHeader: { marginTop: spacing.lg, marginBottom: spacing.xs, paddingHorizontal: spacing.lg },
  dialog: { gap: spacing.md },
});
