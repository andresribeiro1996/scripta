import { useEffect, useRef, useState } from "react";
import { Stack } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Linking from "expo-linking";
import { RefreshControl, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { createVoterToken } from "@scripta/shared";
import { useAuth } from "../../core/auth";
import { Button, Dialog, EmptyState, ErrorState, IconButton, Input, Menu, Screen, Skeleton, SwipeableTabs, Toast, dynamicType, spacing, typography, useTheme } from "../../ui";
import { AddBookSheet } from "../community/AddBookSheet";
import { fetchTournament, renameTournament, resolveTiebreak, settleDuelEarly, voteOnDuel } from "./api";
import { arenaViewTabs, matchEmptyCopy, tournamentChampion, votableDuels, type ArenaViewTab } from "./arenaView";
import { ArenaVoteDeck } from "./ArenaVoteDeck";
import { ArenaBooksSheet } from "./ArenaBooksSheet";
import { BracketMap } from "./BracketMap";
import { BracketRounds } from "./BracketRounds";
import { BracketViewToggle, type BracketView } from "./BracketViewToggle";
import { ChampionBanner } from "./ChampionBanner";

const TOKEN_KEY = "arena-voter-token";

export function ArenaViewScreen({ id, onClose }: { id: string; onClose?: () => void }) {
  const { user } = useAuth();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const [token, setToken] = useState<string | null>(null);
  const [tab, setTab] = useState<ArenaViewTab | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");
  const [booksOpen, setBooksOpen] = useState(false);
  // Frozen on the first render that has data, never recomputed: casting the
  // last vote empties `votable`, and a landing tab that kept recalculating
  // would yank the pane out from under the finger that just voted.
  const landing = useRef<ArenaViewTab | null>(null);
  // Deliberately not persisted: the classic map is a peek at the shape of
  // the draw, not a way to live in it — at 32 slots its round 1 is 16
  // matches wide. Every visit starts on the round-by-round view.
  const [bracketView, setBracketView] = useState<BracketView>("rounds");
  const [addBook, setAddBook] = useState<{ title: string; author: string; coverUrl?: string | null } | null>(null);
  const [, setTick] = useState(0);

  function openAddBook(book: { title: string; author: string; coverUrl?: string | null }) {
    setBooksOpen(false);
    setAddBook(book);
  }

  useEffect(() => {
    void AsyncStorage.getItem(TOKEN_KEY).then(async (stored) => {
      const next = stored ?? createVoterToken();
      if (!stored) await AsyncStorage.setItem(TOKEN_KEY, next);
      setToken(next);
    });
  }, []);
  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const tournament = useQuery({ queryKey: ["arena", id, token], queryFn: () => fetchTournament(id, token!), enabled: Boolean(token), retry: false, refetchInterval: 15_000 });
  const data = tournament.data;
  const isOwner = Boolean(user && data?.ownerUserId === user.id);

  async function action(duelId: string, run: () => Promise<unknown>) {
    setBusy(duelId);
    setError(null);
    try {
      await run();
      await queryClient.invalidateQueries({ queryKey: ["arena", id] });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That action failed.");
    } finally {
      setBusy(null);
    }
  }

  if (!token || tournament.isPending) return <Screen bottom top={false} style={styles.screen}><Skeleton height={160} /></Screen>;
  if (tournament.isError || !data) return <Screen bottom top={false} style={styles.screen}><ErrorState title="Tournament unavailable" body={tournament.error instanceof Error ? tournament.error.message : "No such tournament."} actionLabel="Retry" onAction={() => void tournament.refetch()} /></Screen>;

  const votable = votableDuels(data.duels);
  const next = votable[0];
  const champion = tournamentChampion(data.bracketSize, data.duels);
  const refresh = () => void tournament.refetch();
  const tabs = arenaViewTabs(data.status);
  // Open on the pane with something to do: the deck when there are votes to
  // cast, the bracket otherwise — landing a finished tournament on "No
  // matches" wasted the one screen that had anything to show.
  landing.current ??= votable.length ? "match" : "bracket";
  const chosen = tab ?? landing.current;
  const activeTab = tabs.some((option) => option.value === chosen) ? chosen : tabs[0]!.value;

  const matchPane = () => {
    const empty = matchEmptyCopy(data.status, data.duels.length > 0);
    // A vote deck owns vertical pan gestures for its own swipe-to-vote, so
    // (unlike the other panes) it can't also sit inside a pull-to-refresh
    // ScrollView — the two would compete for the same drag. It already
    // refetches on the query's own interval instead. The empty state has no
    // competing gesture, so it keeps pull-to-refresh.
    if (next) {
      return (
        <View style={styles.matchWrap}>
          <ArenaVoteDeck
            duel={next}
            disabled={busy === next.id}
            onVote={(bookKey) => void action(next.id, () => voteOnDuel(id, next.id, token, bookKey, Boolean(user)))}
          />
        </View>
      );
    }
    return (
      <ScrollView style={styles.grow} contentContainerStyle={styles.pane} refreshControl={<RefreshControl refreshing={tournament.isRefetching} onRefresh={refresh} />}>
        {champion ? (
          <>
            <Text {...dynamicType} style={[typography.caption, styles.note, { color: colors.textDim }]}>{empty.title}</Text>
            <ChampionBanner champion={champion} />
          </>
        ) : (
          <EmptyState title={empty.title} body={empty.body} />
        )}
      </ScrollView>
    );
  };

  const bracketPane = () => {
    if (data.status === "seeding") {
      return (
        <ScrollView style={styles.grow} contentContainerStyle={styles.pane} refreshControl={<RefreshControl refreshing={tournament.isRefetching} onRefresh={refresh} />}>
          <EmptyState title="Tournament is being seeded" body="Pull to refresh for updates." />
        </ScrollView>
      );
    }
    if (bracketView === "classic") {
      // The map draws every round at once, so the round bar's chips have
      // nothing to select here — the toggle back is all that pane keeps.
      return (
        <View style={styles.grow}>
          <ScrollView style={styles.grow} contentContainerStyle={styles.list} refreshControl={<RefreshControl refreshing={tournament.isRefetching} onRefresh={refresh} />}>
            <BracketMap
              tournament={data}
              isOwner={isOwner}
              busyDuelId={busy}
              onSettle={(duelId) => void action(duelId, () => settleDuelEarly(id, duelId))}
              onTiebreak={(duelId, bookKey) => void action(duelId, () => resolveTiebreak(id, duelId, bookKey))}
            />
          </ScrollView>
          <View style={[styles.classicBar, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
            <BracketViewToggle to="rounds" onPress={() => setBracketView("rounds")} />
          </View>
        </View>
      );
    }
    // Owns its own ScrollView so its round bar can stay pinned to the
    // bottom of the pane instead of scrolling away with the matches.
    return (
      <BracketRounds
        tournament={data}
        isOwner={isOwner}
        busyDuelId={busy}
        refreshing={tournament.isRefetching}
        onRefresh={refresh}
        onShowClassic={() => setBracketView("classic")}
        onSettle={(duelId) => void action(duelId, () => settleDuelEarly(id, duelId))}
        onTiebreak={(duelId, bookKey) => void action(duelId, () => resolveTiebreak(id, duelId, bookKey))}
      />
    );
  };

  return (
    <Screen bottom top={false} style={styles.screen}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: data.name,
          headerRight: () => (
            <Menu
              title={data.name}
              items={[
                { label: data.slots.length ? `See all ${data.slots.length} books` : "View book pool", onPress: () => setBooksOpen(true) },
                ...(isOwner ? [{ label: "Rename…", onPress: () => { setName(data.name); setRenaming(true); } }] : []),
                { label: "Share…", onPress: () => void Share.share({ message: Linking.createURL(`/arena/${id}`) }) },
              ]}
            >
              <IconButton accessibilityLabel={`Actions for ${data.name}`} framed name="more" />
            </Menu>
          ),
        }}
      />
      {error ? <Toast visible message={error} tone="error" /> : null}
      <SwipeableTabs
        accessibilityLabel="Tournament view"
        options={tabs.map((option) => option.value === "match" ? { ...option, badge: votable.length } : option)}
        value={activeTab}
        onChange={setTab}
        renderPage={(pageTab) => pageTab === "match" ? matchPane() : bracketPane()}
      />
      <ArenaBooksSheet id={booksOpen ? id : null} name={data.name} onAddBook={openAddBook} onClose={() => setBooksOpen(false)} />
      {addBook ? <AddBookSheet book={addBook} onClose={() => setAddBook(null)} /> : null}
      <Dialog visible={renaming} title="Rename tournament" onClose={() => setRenaming(false)}><View style={styles.dialog}><Input label="Tournament name" value={name} onChangeText={setName} maxLength={200} /><Button label="Save name" disabled={!name.trim()} loading={busy === "rename"} onPress={() => void action("rename", async () => { await renameTournament(id, name.trim()); setRenaming(false); })} /></View></Dialog>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { padding: spacing.lg, gap: spacing.md },
  grow: { flex: 1 },
  pane: { gap: spacing.md, paddingBottom: spacing.huge, flexGrow: 1, justifyContent: "center" },
  matchWrap: { flex: 1, paddingTop: spacing.lg, justifyContent: "center" },
  list: { gap: spacing.md, paddingBottom: spacing.huge, flexGrow: 1 },
  classicBar: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", justifyContent: "center", paddingTop: spacing.sm, paddingBottom: spacing.xs, borderTopWidth: 1 },
  note: { textAlign: "center", textTransform: "uppercase", letterSpacing: 1, fontWeight: "700" },
  dialog: { gap: spacing.md },
});
