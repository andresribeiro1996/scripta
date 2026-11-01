import { useMemo, useState } from "react";
import { Stack, router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { booksByWork, createTier, DEFAULT_TIER_PRESET, filterBooks, workIdOf, type TierlistData } from "@scripta/shared";
import { FlatList, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "../../ui/Text";
import { useLibrary, useWorkBooks } from "../library";
import { Button, ErrorState, Input, Screen, Segmented, Skeleton, Toast, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { createTierlist, type Tierlist } from "./api";
import { useT, type MessageKey } from "../../i18n";

const VISIBILITY = [{ value: "private", label: "tierlists.private" }, { value: "public", label: "tierlists.public" }] as const satisfies ReadonlyArray<{ value: string; label: MessageKey }>;
const DIRECTION = [{ value: "best", label: "tierlists.best" }, { value: "worst", label: "tierlists.worst" }] as const satisfies ReadonlyArray<{ value: string; label: MessageKey }>;
const ACCESS = [{ value: "anonymous", label: "tierlists.anyone" }, { value: "members", label: "tierlists.members" }] as const satisfies ReadonlyArray<{ value: string; label: MessageKey }>;

export function TierlistCreateScreen() {
  const t = useT();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");
  const [pool, setPool] = useState<string[]>([]);
  const [tiers, setTiers] = useState<TierlistData["tiers"]>(() => DEFAULT_TIER_PRESET.map((tier) => createTier(tier.label, tier.color)));
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  const [access, setAccess] = useState<"anonymous" | "members">("anonymous");
  const [direction, setDirection] = useState<"best" | "worst">("best");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const library = useLibrary();
  const workBooks = useWorkBooks(library.data);
  const books = useMemo(() => [...booksByWork(workBooks).values()], [workBooks]);
  const selected = new Set(pool);
  const filtered = filterBooks(books, search, "all");

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const created = await createTierlist(name.trim() || t("tierlists.untitledList"), { tiers, pool }, visibility === "public" ? access : undefined, direction === "worst");
      queryClient.setQueryData<Tierlist[]>(["tierlists"], (items = []) => [created, ...items]);
      router.replace((created.voteCode ? `/vote/${created.voteCode}` : `/tierlist/${created.id}?rank=1`) as never);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("tierlists.createFailed"));
    } finally {
      setBusy(false);
    }
  }

  return <Screen top={false} style={styles.screen}>
    <Stack.Screen options={{ headerShown: true, title: t("tierlists.create") }} />
    {error ? <Toast visible message={error} tone="error" /> : null}
    <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{t("tierlists.stepOf", { step: step + 1 })}</Text>
    <Text {...dynamicType} style={[typography.title, { color: colors.text }]}>{[t("tierlists.stepChooseBooks"), t("tierlists.stepSetUpTiers"), t("tierlists.stepPublishSettings")][step]}</Text>
    {step === 0 ? <>
      <Input label={t("tierlists.name")} value={name} onChangeText={setName} placeholder={t("tierlists.untitledList")} maxLength={200} />
      <Input label={t("tierlists.booksInPool", { count: pool.length })} value={search} onChangeText={setSearch} placeholder={t("library.searchYourLibrary")} autoCapitalize="none" autoCorrect={false} returnKeyType="search" />
      {library.isPending ? <Skeleton height={160} /> : library.isError ? <ErrorState body={t("arena.libraryLoadFailed")} actionLabel={t("shell.retry")} onAction={() => void library.refetch()} /> : <FlatList
        data={filtered}
        keyExtractor={(book) => workIdOf(book) ?? ""}
        ListEmptyComponent={<Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{t("tierlists.noBooksFound")}</Text>}
        renderItem={({ item }) => {
          const workId = workIdOf(item) ?? "";
          const checked = selected.has(workId);
          return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked }} onPress={() => setPool((value) => checked ? value.filter((entry) => entry !== workId) : [...value, workId])} style={[styles.book, { borderColor: checked ? colors.accent : colors.border, backgroundColor: checked ? colors.accentSoft : colors.surface }]}>
            <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.grow, { color: colors.text }]}>{String(item.Title ?? t("library.untitled"))}</Text>
            <Text {...dynamicType} style={[typography.body, { color: colors.accent }]}>{checked ? "✓" : "+"}</Text>
          </Pressable>;
        }}
      />}
    </> : null}
    {step === 1 ? <ScrollView contentContainerStyle={styles.tiers} keyboardShouldPersistTaps="handled">
      <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{t("tierlists.defaultTiersReady")}</Text>
      {tiers.map((tier, index) => <View key={tier.id} style={styles.tier}>
        <View style={[styles.swatch, { backgroundColor: tier.color }]} />
        <View style={styles.grow}><Input label={t("tierlists.tierNumber", { number: index + 1 })} value={tier.label} onChangeText={(label) => setTiers((value) => value.map((entry) => entry.id === tier.id ? { ...entry, label } : entry))} maxLength={30} /></View>
        <Button label={t("tierlists.remove")} variant="secondary" disabled={tiers.length === 1} onPress={() => setTiers((value) => value.filter((entry) => entry.id !== tier.id))} />
      </View>)}
      <Button label={t("tierlists.addTier")} variant="secondary" onPress={() => setTiers((value) => [...value, createTier(t("tierlists.newTier"), "#8a8580")])} />
    </ScrollView> : null}
    {step === 2 ? <ScrollView style={styles.grow} contentContainerStyle={styles.settings} keyboardShouldPersistTaps="handled">
      <Text accessible={false} {...dynamicType} style={[typography.body, { color: colors.text }]}>{t("tierlists.topTierMeans")}</Text>
      <Segmented accessibilityLabel={t("tierlists.topTierMeans")} options={DIRECTION.map((option) => ({ value: option.value, label: t(option.label) }))} value={direction} onChange={setDirection} />
      <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{t("tierlists.cantChangeLater")}</Text>
      <Segmented accessibilityLabel={t("tierlists.visibility")} options={VISIBILITY.map((option) => ({ value: option.value, label: t(option.label) }))} value={visibility} onChange={setVisibility} />
      {visibility === "public" ? <>
        <Text {...dynamicType} style={[typography.body, { color: colors.text }]}>{t("tierlists.openForVoting")}</Text>
        <Segmented accessibilityLabel={t("tierlists.whoCanVote")} options={ACCESS.map((option) => ({ value: option.value, label: t(option.label) }))} value={access} onChange={setAccess} />
        <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{t("tierlists.publicNote")}</Text>
      </> : <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{t("tierlists.privateNote")}</Text>}
      <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{t("tierlists.poolSummary", { books: t("tierlists.bookCount", { count: pool.length }), tiers: t("tierlists.tierCount", { count: tiers.length }) })}</Text>
    </ScrollView> : null}
    <View style={styles.actions}>
      {step > 0 ? <Button label={t("shell.back")} variant="secondary" onPress={() => setStep((value) => value - 1)} /> : null}
      {step < 2 ? <Button label={t("tierlists.next")} disabled={step === 0 ? pool.length === 0 || library.isError : tiers.some((tier) => !tier.label.trim())} onPress={() => setStep((value) => value + 1)} /> : <Button label={t("tierlists.create")} loading={busy} onPress={() => void create()} />}
    </View>
  </Screen>;
}

const styles = StyleSheet.create({
  screen: { padding: spacing.lg, gap: spacing.md },
  grow: { flex: 1 },
  book: { minHeight: 52, borderWidth: 1, borderRadius: radii.md, paddingHorizontal: spacing.md, marginBottom: spacing.xs, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  tiers: { gap: spacing.sm, paddingBottom: spacing.lg },
  tier: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  swatch: { width: 20, height: 44, borderRadius: radii.sm },
  settings: { gap: spacing.md, paddingBottom: spacing.lg },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm },
});
