import { useEffect, useState } from "react";
import { Stack } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Linking from "expo-linking";
import { FlatList, RefreshControl, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { countdownLabel, createVoterToken, sharePercent, type Duel, type DuelSide } from "@scripta/shared";
import { useAuth } from "../../core/auth";
import { Button, Dialog, EmptyState, ErrorState, IconButton, Input, Menu, Screen, Segmented, Skeleton, Toast, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { fetchTournament, renameTournament, resolveTiebreak, settleDuelEarly, voteOnDuel } from "./api";
import { ARENA_VIEW_TABS, bracketSlots, matchEmptyCopy, votableDuels, waitingLabel, type ArenaViewTab } from "./arenaView";
import { ArenaVoteDeck } from "./ArenaVoteDeck";
import { BookCover } from "./BookCover";

const TOKEN_KEY = "arena-voter-token";

function Side({ side, duel }: { side: DuelSide; duel: Duel }) {
  const { colors } = useTheme();
  const percent = sharePercent(side.votes, duel);
  return (
    <View accessibilityLabel={`${side.title} by ${side.author}`} style={[styles.side, { borderColor: duel.winnerKey === side.key ? colors.success : colors.border }]}>
      <BookCover cover={side.cover} title={side.title} width={46} height={66} />
      <View style={styles.grow}>
        <Text numberOfLines={2} {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>{side.title}</Text>
        <Text numberOfLines={1} {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{side.author}</Text>
        <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{side.votes} votes{percent === null ? "" : ` · ${percent}%`}</Text>
      </View>
    </View>
  );
}

export function ArenaViewScreen({ id, onClose }: { id: string; onClose?: () => void }) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [token, setToken] = useState<string | null>(null);
  const [tab, setTab] = useState<ArenaViewTab>("match");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");
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

  const matchPane = () => {
    const empty = matchEmptyCopy(data.status, data.duels.length > 0);
    return (
      <ScrollView style={styles.grow} contentContainerStyle={styles.pane} refreshControl={<RefreshControl refreshing={tournament.isRefetching} onRefresh={refresh} />}>
        {next
          ? <>
              <Text {...dynamicType} style={[typography.caption, styles.center, { color: colors.textDim }]}>{waitingLabel(votable.length)}</Text>
              <ArenaVoteDeck
                duel={next}
                disabled={busy === next.id}
                onVote={(bookKey) => void action(next.id, () => voteOnDuel(id, next.id, token, bookKey))}
              />
            </>
          : <EmptyState title={empty.title} body={empty.body} />}
      </ScrollView>
    );
  };

  const booksPane = () => {
    return (
      <FlatList
        data={data.slots}
        keyExtractor={(slot) => String(slot.slotIndex)}
        contentContainerStyle={styles.list}
        refreshing={tournament.isRefetching}
        onRefresh={refresh}
        ListEmptyComponent={<EmptyState title="No books seeded" body="Seed the bracket to fill it." />}
        renderItem={({ item }) => (
          <View style={[styles.side, { borderColor: colors.border }]}>
            <BookCover cover={item.cover} title={item.title} width={46} height={66} />
            <View style={styles.grow}>
              <Text numberOfLines={2} {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>{item.title}</Text>
              <Text numberOfLines={1} {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{item.author}</Text>
            </View>
          </View>
        )}
      />
    );
  };

  const bracketPane = () => {
    return (
      <FlatList
        data={bracketSlots(data.bracketSize, data.duels)}
        keyExtractor={(item) => item.key}
        contentContainerStyle={styles.list}
        refreshing={tournament.isRefetching}
        onRefresh={refresh}
        ListEmptyComponent={<EmptyState title={data.status === "seeding" ? "Tournament is being seeded" : "No matches yet"} body="Pull to refresh for updates." />}
        renderItem={({ item }) => {
          const duel = item.duel;
          if (!duel) return <View style={[styles.emptySlot, { borderColor: colors.border }]}><Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>Waiting for earlier round</Text></View>;
          return <View style={[styles.duel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>Round {duel.roundNumber} · Match {duel.duelIndex + 1} · {duel.status === "active" ? countdownLabel(duel.closesAt) : duel.status === "tied_pending_tiebreak" ? "Owner tiebreak needed" : "Settled"}</Text>
            <Side side={duel.bookA} duel={duel} />
            <Side side={duel.bookB} duel={duel} />
            {isOwner && duel.status === "active" ? <Button label="Settle now" variant="secondary" loading={busy === duel.id} onPress={() => void action(duel.id, () => settleDuelEarly(id, duel.id))} /> : null}
            {isOwner && duel.status === "tied_pending_tiebreak" ? <View style={styles.row}><Button label={`${duel.bookA.title} wins`} loading={busy === duel.id} onPress={() => void action(duel.id, () => resolveTiebreak(id, duel.id, duel.bookA.key))} /><Button label={`${duel.bookB.title} wins`} loading={busy === duel.id} onPress={() => void action(duel.id, () => resolveTiebreak(id, duel.id, duel.bookB.key))} /></View> : null}
          </View>;
        }}
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
                ...(isOwner ? [{ label: "Rename…", onPress: () => { setName(data.name); setRenaming(true); } }] : []),
                { label: "Share…", onPress: () => void Share.share({ message: Linking.createURL(`/arena/${id}`) }) },
              ]}
            >
              <IconButton accessibilityLabel={`Actions for ${data.name}`} name="more" />
            </Menu>
          ),
        }}
      />
      <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{data.bracketSize} books · {data.status === "active" ? `Round ${data.currentRound}` : data.status}</Text>
      {error ? <Toast visible message={error} tone="error" /> : null}
      <Segmented accessibilityLabel="Tournament view" options={ARENA_VIEW_TABS} value={tab} onChange={setTab} />
      {tab === "match" ? matchPane() : tab === "books" ? booksPane() : bracketPane()}
      <Dialog visible={renaming} title="Rename tournament" onClose={() => setRenaming(false)}><View style={styles.dialog}><Input label="Tournament name" value={name} onChangeText={setName} maxLength={200} /><Button label="Save name" disabled={!name.trim()} loading={busy === "rename"} onPress={() => void action("rename", async () => { await renameTournament(id, name.trim()); setRenaming(false); })} /></View></Dialog>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { padding: spacing.lg, gap: spacing.md },
  grow: { flex: 1 },
  strong: { fontWeight: "700" },
  center: { textAlign: "center" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  pane: { gap: spacing.md, paddingBottom: spacing.huge, flexGrow: 1, justifyContent: "center" },
  list: { gap: spacing.md, paddingBottom: spacing.huge, flexGrow: 1 },
  duel: { borderWidth: 1, borderRadius: radii.lg, padding: spacing.md, gap: spacing.sm },
  side: { minHeight: 84, borderWidth: 1, borderRadius: radii.md, padding: spacing.sm, flexDirection: "row", gap: spacing.md, alignItems: "center" },
  emptySlot: { minHeight: 72, borderWidth: 1, borderStyle: "dashed", borderRadius: radii.md, alignItems: "center", justifyContent: "center" },
  dialog: { gap: spacing.md },
});
