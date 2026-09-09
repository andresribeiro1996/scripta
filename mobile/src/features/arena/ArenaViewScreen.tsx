import { useEffect, useState } from "react";
import { Stack } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import * as Linking from "expo-linking";
import { FlatList, Pressable, Share, StyleSheet, Text, View } from "react-native";
import { bracketShape, countdownLabel, createVoterToken, sharePercent, type Duel, type DuelSide } from "@scripta/shared";
import { useAuth } from "../../core/auth";
import { Button, Dialog, EmptyState, ErrorState, IconButton, Input, Menu, Screen, Skeleton, Toast, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { fetchTournament, renameTournament, resolveTiebreak, settleDuelEarly, voteOnDuel } from "./api";

const TOKEN_KEY = "arena-voter-token";

function Side({ side, duel, disabled, onVote }: { side: DuelSide; duel: Duel; disabled: boolean; onVote: () => void }) {
  const { colors } = useTheme();
  const percent = sharePercent(side.votes, duel);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Vote for ${side.title}`} accessibilityState={{ disabled }} disabled={disabled} onPress={onVote} style={[styles.side, { borderColor: duel.winnerKey === side.key ? colors.success : colors.border, opacity: disabled && duel.winnerKey !== side.key ? 0.7 : 1 }]}>
      {side.cover ? <Image source={side.cover} style={styles.cover} contentFit="cover" /> : <View style={[styles.cover, styles.coverFallback, { backgroundColor: colors.accentSoft }]}><Text {...dynamicType} style={{ color: colors.accent }}>{side.title.charAt(0)}</Text></View>}
      <View style={styles.grow}>
        <Text numberOfLines={2} {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>{side.title}</Text>
        <Text numberOfLines={1} {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{side.author}</Text>
        <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{side.votes} votes{percent === null ? "" : ` · ${percent}%`}</Text>
      </View>
    </Pressable>
  );
}

export function ArenaViewScreen({ id, onClose }: { id: string; onClose?: () => void }) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [token, setToken] = useState<string | null>(null);
  const [mode, setMode] = useState<"matches" | "bracket">("matches");
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

  const duels: Array<{ key: string; duel: Duel | null }> = mode === "matches"
    ? data.duels.map((duel) => ({ key: duel.id, duel }))
    : bracketShape(data.bracketSize, data.duels).flatMap((round, roundIndex) => round.map((duel, duelIndex) => ({ duel, key: `${roundIndex}:${duelIndex}` })));
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
              <IconButton accessibilityLabel={`Actions for ${data.name}`} name="ellipsis-horizontal" />
            </Menu>
          ),
        }}
      />
      <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{data.bracketSize} books · {data.status === "active" ? `Round ${data.currentRound}` : data.status}</Text>
      {error ? <Toast visible message={error} tone="error" /> : null}
      <View style={styles.row}><Button label="Matches" variant={mode === "matches" ? "primary" : "secondary"} onPress={() => setMode("matches")} /><Button label="Bracket" variant={mode === "bracket" ? "primary" : "secondary"} onPress={() => setMode("bracket")} /></View>
      <FlatList
        data={duels}
        keyExtractor={(item) => item.key}
        contentContainerStyle={styles.list}
        refreshing={tournament.isRefetching}
        onRefresh={() => void tournament.refetch()}
        ListEmptyComponent={<EmptyState title={data.status === "seeding" ? "Tournament is being seeded" : "No matches yet"} body="Pull to refresh for updates." />}
        renderItem={({ item }) => {
          const duel = item.duel;
          if (!duel) return <View style={[styles.emptySlot, { borderColor: colors.border }]}><Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>Waiting for earlier round</Text></View>;
          const voteDisabled = duel.status !== "active" || duel.hasVoted || busy === duel.id;
          return <View style={[styles.duel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>Round {duel.roundNumber} · Match {duel.duelIndex + 1} · {duel.status === "active" ? countdownLabel(duel.closesAt) : duel.status === "tied_pending_tiebreak" ? "Owner tiebreak needed" : "Settled"}</Text>
            <Side side={duel.bookA} duel={duel} disabled={voteDisabled} onVote={() => void action(duel.id, () => voteOnDuel(id, duel.id, token, duel.bookA.key))} />
            <Side side={duel.bookB} duel={duel} disabled={voteDisabled} onVote={() => void action(duel.id, () => voteOnDuel(id, duel.id, token, duel.bookB.key))} />
            {isOwner && duel.status === "active" ? <Button label="Settle now" variant="secondary" loading={busy === duel.id} onPress={() => void action(duel.id, () => settleDuelEarly(id, duel.id))} /> : null}
            {isOwner && duel.status === "tied_pending_tiebreak" ? <View style={styles.row}><Button label={`${duel.bookA.title} wins`} loading={busy === duel.id} onPress={() => void action(duel.id, () => resolveTiebreak(id, duel.id, duel.bookA.key))} /><Button label={`${duel.bookB.title} wins`} loading={busy === duel.id} onPress={() => void action(duel.id, () => resolveTiebreak(id, duel.id, duel.bookB.key))} /></View> : null}
          </View>;
        }}
      />
      <Dialog visible={renaming} title="Rename tournament" onClose={() => setRenaming(false)}><View style={styles.dialog}><Input label="Tournament name" value={name} onChangeText={setName} maxLength={200} /><Button label="Save name" disabled={!name.trim()} loading={busy === "rename"} onPress={() => void action("rename", async () => { await renameTournament(id, name.trim()); setRenaming(false); })} /></View></Dialog>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { padding: spacing.lg, gap: spacing.md },
  grow: { flex: 1 },
  strong: { fontWeight: "700" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  list: { gap: spacing.md, paddingBottom: spacing.huge },
  duel: { borderWidth: 1, borderRadius: radii.lg, padding: spacing.md, gap: spacing.sm },
  side: { minHeight: 84, borderWidth: 1, borderRadius: radii.md, padding: spacing.sm, flexDirection: "row", gap: spacing.md, alignItems: "center" },
  cover: { width: 46, height: 66, borderRadius: radii.sm },
  coverFallback: { alignItems: "center", justifyContent: "center" },
  emptySlot: { minHeight: 72, borderWidth: 1, borderStyle: "dashed", borderRadius: radii.md, alignItems: "center", justifyContent: "center" },
  dialog: { gap: spacing.md },
});
