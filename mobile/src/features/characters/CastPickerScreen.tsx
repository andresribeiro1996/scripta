import { useState } from "react";
import { Stack, router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { bracketSizes, canCreate, defaultTicked, roundMinutesFromHours, type CharacterGameMode, type WorkCast } from "@scripta/shared";
import { Text } from "../../ui/Text";
import { Button, ErrorState, Input, Screen, Segmented, Skeleton, Toast, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { BookCover } from "../arena/BookCover";
import { createCharacterTournament } from "../arena/api";
import { createCharacterTierlist, type Tierlist } from "../tierlists/api";
import { fetchWorkCast } from "../works/api";
import { useT, type MessageKey } from "../../i18n";

const MODES = [{ value: "tierlist", labelKey: "book.gameTierlist" }, { value: "tournament", labelKey: "book.gameTournament" }] as const satisfies readonly { value: CharacterGameMode; labelKey: MessageKey }[];

export function CastPickerScreen({ workId }: { workId: string }) {
  const t = useT();
  const cast = useQuery({ queryKey: ["works", workId, "cast"], queryFn: () => fetchWorkCast(workId), retry: false });
  return (
    <Screen top={false} style={styles.screen}>
      <Stack.Screen options={{ headerShown: true, title: t("book.characterGame") }} />
      {cast.isPending ? <Skeleton height={160} /> : cast.isError ? <ErrorState body={t("book.castLoadFailed")} actionLabel={t("shell.retry")} onAction={() => void cast.refetch()} /> : <CastPicker workId={workId} cast={cast.data} />}
    </Screen>
  );
}

function CastPicker({ workId, cast }: { workId: string; cast: WorkCast }) {
  const t = useT();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const sizes = bracketSizes(cast.characters.length);
  const modes = sizes.length > 0 ? MODES : MODES.slice(0, 1);
  const [mode, setMode] = useState<CharacterGameMode>("tierlist");
  const [size, setSize] = useState(sizes[sizes.length - 1] ?? 0);
  const [ticked, setTicked] = useState(() => defaultTicked(cast.characters, "tierlist", size));
  const [name, setName] = useState(t("book.castDefaultName", { label: cast.scope.label }));
  const [duration, setDuration] = useState("24");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = new Set(ticked);

  function chooseMode(next: CharacterGameMode) {
    setMode(next);
    setTicked(defaultTicked(cast.characters, next, size));
  }

  function chooseSize(next: number) {
    setSize(next);
    setTicked(defaultTicked(cast.characters, "tournament", next));
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const characters = { workId, characterIds: ticked };
      const title = name.trim() || t("book.castDefaultName", { label: cast.scope.label });
      if (mode === "tierlist") {
        const created = await createCharacterTierlist(title, characters);
        queryClient.setQueryData<Tierlist[]>(["tierlists"], (items = []) => [created, ...items]);
        router.navigate(`/(app)/(arena)/tierlist/${created.id}?rank=1` as never);
      } else {
        const created = await createCharacterTournament({ name: title, bracketSize: size, roundDurationMinutes: roundMinutesFromHours(duration.replace(",", ".")), characters });
        void queryClient.invalidateQueries({ queryKey: ["arena", "mine"] });
        router.replace(`/arena/${created.id}` as never);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("book.gameCreateFailed"));
    } finally {
      setBusy(false);
    }
  }

  const header = (
    <View style={styles.headerBlock}>
      <View style={styles.header}>
        <BookCover cover={cast.scope.coverUrl} title={cast.scope.label} width={48} height={72} />
        <View style={styles.grow}>
          <Text numberOfLines={2} {...dynamicType} style={[typography.title, { color: colors.text }]}>{cast.scope.label}</Text>
          {cast.scope.kind === "series" ? <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{t("library.bookCount", { count: cast.scope.workCount })}</Text> : null}
        </View>
      </View>
      {modes.length > 1 ? <Segmented accessibilityLabel={t("book.gameType")} options={modes.map(({ value, labelKey }) => ({ value, label: t(labelKey) }))} value={mode} onChange={chooseMode} /> : null}
      {mode === "tournament" ? (
        <>
          <Text {...dynamicType} style={[typography.body, { color: colors.text }]}>{t("book.bracketSize")}</Text>
          <View style={styles.row}>{sizes.map((value) => <Button key={value} label={String(value)} variant={size === value ? "primary" : "secondary"} onPress={() => chooseSize(value)} />)}</View>
          <Input label={t("book.roundDurationHours")} keyboardType="decimal-pad" value={duration} onChangeText={setDuration} returnKeyType="done" />
        </>
      ) : null}
      <Input label={t("library.name")} value={name} onChangeText={setName} maxLength={200} returnKeyType="done" />
      <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{mode === "tournament" ? t("book.castTicked", { count: ticked.length, size }) : t("book.castSelected", { count: ticked.length })}</Text>
    </View>
  );

  return (
    <View style={styles.form}>
      {error ? <Toast visible message={error} tone="error" /> : null}
      <FlatList
        data={cast.characters}
        keyExtractor={(character) => character.id}
        style={styles.grow}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={header}
        renderItem={({ item }) => {
          const checked = selected.has(item.id);
          return (
            <Pressable accessibilityRole="checkbox" accessibilityState={{ checked }} onPress={() => setTicked((value) => checked ? value.filter((id) => id !== item.id) : [...value, item.id])} style={[styles.character, { borderColor: checked ? colors.accent : colors.border, backgroundColor: checked ? colors.accentSoft : colors.surface }]}>
              <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.grow, { color: colors.text }]}>{item.name}</Text>
              <Text {...dynamicType} style={[typography.body, { color: colors.accent }]}>{checked ? "✓" : "+"}</Text>
            </Pressable>
          );
        }}
      />
      <Button label={mode === "tierlist" ? t("book.createTierlist") : t("book.createTournament")} loading={busy} disabled={!canCreate(mode, ticked.length, size)} onPress={() => void create()} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { padding: spacing.lg, gap: spacing.md },
  grow: { flex: 1 },
  form: { flex: 1, gap: spacing.md },
  headerBlock: { gap: spacing.md, paddingBottom: spacing.sm },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  list: { gap: spacing.xs, paddingBottom: spacing.lg },
  character: { minHeight: 52, borderWidth: 1, borderRadius: radii.md, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.sm },
});
