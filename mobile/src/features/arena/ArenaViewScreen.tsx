import { useEffect, useState } from "react";
import { Stack } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Linking from "expo-linking";
import { RefreshControl, ScrollView, Share, StyleSheet, View } from "react-native";
import { createVoterToken } from "@scripta/shared";
import { useAuth } from "../../core/auth";
import { Button, Dialog, EmptyState, ErrorState, IconButton, Input, Menu, Screen, Skeleton, SwipeableTabs, Toast, spacing } from "../../ui";
import { fetchTournament, renameTournament, resolveTiebreak, settleDuelEarly, voteOnDuel } from "./api";
import { arenaViewTabs, matchEmptyCopy, votableDuels, type ArenaViewTab } from "./arenaView";
import { ArenaVoteDeck } from "./ArenaVoteDeck";
import { ArenaBooksSheet } from "./ArenaBooksSheet";
import { BracketMap } from "./BracketMap";

const TOKEN_KEY = "arena-voter-token";

export function ArenaViewScreen({ id, onClose }: { id: string; onClose?: () => void }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [token, setToken] = useState<string | null>(null);
  const [tab, setTab] = useState<ArenaViewTab>("match");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");
  const [booksOpen, setBooksOpen] = useState(false);
  const [, setTick] = useState(0);

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
  const refresh = () => void tournament.refetch();
  const tabs = arenaViewTabs(data.status);
  const activeTab = tabs.some((option) => option.value === tab) ? tab : tabs[0]!.value;

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
        <EmptyState title={empty.title} body={empty.body} />
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
    return (
      <ScrollView style={styles.grow} contentContainerStyle={styles.list} refreshControl={<RefreshControl refreshing={tournament.isRefetching} onRefresh={refresh} />}>
        <BracketMap
          tournament={data}
          isOwner={isOwner}
          busyDuelId={busy}
          onSettle={(duelId) => void action(duelId, () => settleDuelEarly(id, duelId))}
          onTiebreak={(duelId, bookKey) => void action(duelId, () => resolveTiebreak(id, duelId, bookKey))}
        />
      </ScrollView>
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
                ...(isOwner ? [{ label: "Rename…", onPress: () => { setName(data.name); setRenaming(true); } }] : []),
                { label: "Share…", onPress: () => void Share.share({ message: Linking.createURL(`/arena/${id}`) }) },
              ]}
            >
              <IconButton accessibilityLabel={`Actions for ${data.name}`} name="more" />
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
      <Button label={data.slots.length ? `See all ${data.slots.length} books` : "View book pool"} variant="secondary" onPress={() => setBooksOpen(true)} />
      <ArenaBooksSheet id={booksOpen ? id : null} name={data.name} onClose={() => setBooksOpen(false)} />
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
  dialog: { gap: spacing.md },
});
