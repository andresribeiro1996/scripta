import { useState } from "react";
import { Stack, router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { bookKey, createTier, DEFAULT_TIER_PRESET, filterBooks, type TierlistData } from "@scripta/shared";
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { apiClient } from "../../core/api";
import { Button, ErrorState, IconButton, Input, Screen, Segmented, Skeleton, Toast, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { createTierlist, type Tierlist } from "./api";

interface LibraryResponse { data: { books?: Array<Record<string, unknown>> } | null }

const VISIBILITY = [{ value: "private", label: "Private" }, { value: "public", label: "Public" }] as const;
const ACCESS = [{ value: "anonymous", label: "Anyone" }, { value: "members", label: "Members" }] as const;

export function TierlistCreateScreen() {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");
  const [pool, setPool] = useState<string[]>([]);
  const [tiers, setTiers] = useState<TierlistData["tiers"]>(() => DEFAULT_TIER_PRESET.map((tier) => createTier(tier.label, tier.color)));
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  const [access, setAccess] = useState<"anonymous" | "members">("anonymous");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const library = useQuery({ queryKey: ["library"], queryFn: () => apiClient.request<LibraryResponse>("/library", { auth: true }), retry: false });
  const books = library.data?.data?.books ?? [];
  const selected = new Set(pool);
  const filtered = filterBooks(books, search, "all");

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const created = await createTierlist(name.trim() || "Untitled tier list", { tiers, pool }, visibility === "public" ? access : undefined);
      queryClient.setQueryData<Tierlist[]>(["tierlists"], (items = []) => [created, ...items]);
      router.replace((created.voteCode ? `/vote/${created.voteCode}` : `/tierlist/${created.id}?rank=1`) as never);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't create the tier list.");
    } finally {
      setBusy(false);
    }
  }

  return <Screen top={false} style={styles.screen}>
    <Stack.Screen options={{ headerShown: true, title: "Create tier list" }} />
    {error ? <Toast visible message={error} tone="error" /> : null}
    <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>Step {step + 1} of 3</Text>
    <Text {...dynamicType} style={[typography.title, { color: colors.text }]}>{["Choose books", "Set up tiers", "Publish settings"][step]}</Text>
    {step === 0 ? <>
      <Input label="Tier list name" value={name} onChangeText={setName} placeholder="Untitled tier list" maxLength={200} />
      <Input label={`Books in pool · ${pool.length}`} value={search} onChangeText={setSearch} placeholder="Search your library" autoCapitalize="none" autoCorrect={false} />
      {library.isPending ? <Skeleton height={160} /> : library.isError ? <ErrorState body="Your library couldn't be loaded." actionLabel="Retry" onAction={() => void library.refetch()} /> : <FlatList
        data={filtered}
        keyExtractor={bookKey}
        ListEmptyComponent={<Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>No books found.</Text>}
        renderItem={({ item }) => {
          const key = bookKey(item);
          const checked = selected.has(key);
          return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked }} onPress={() => setPool((value) => checked ? value.filter((entry) => entry !== key) : [...value, key])} style={[styles.book, { borderColor: checked ? colors.accent : colors.border, backgroundColor: checked ? colors.accentSoft : colors.surface }]}>
            <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.grow, { color: colors.text }]}>{String(item.Title ?? "Untitled")}</Text>
            <Text {...dynamicType} style={[typography.body, { color: colors.accent }]}>{checked ? "✓" : "+"}</Text>
          </Pressable>;
        }}
      />}
    </> : null}
    {step === 1 ? <ScrollView contentContainerStyle={styles.tiers} keyboardShouldPersistTaps="handled">
      <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>The default S–D tiers are ready. Rename, remove, or add tiers before creating.</Text>
      {tiers.map((tier, index) => <View key={tier.id} style={styles.tier}>
        <View style={[styles.swatch, { backgroundColor: tier.color }]} />
        <View style={styles.grow}><Input accessibilityLabel={`Tier ${index + 1} label`} value={tier.label} onChangeText={(label) => setTiers((value) => value.map((entry) => entry.id === tier.id ? { ...entry, label } : entry))} maxLength={30} /></View>
        {tiers.length > 1 ? <IconButton accessibilityLabel={`Remove tier ${index + 1}`} name="delete" onPress={() => setTiers((value) => value.filter((entry) => entry.id !== tier.id))} /> : null}
      </View>)}
      <Button label="Add tier" variant="secondary" onPress={() => setTiers((value) => [...value, createTier("New tier", "#8a8580")])} />
    </ScrollView> : null}
    {step === 2 ? <View style={styles.settings}>
      <Segmented accessibilityLabel="Visibility" options={VISIBILITY} value={visibility} onChange={setVisibility} />
      {visibility === "public" ? <>
        <Text {...dynamicType} style={[typography.body, { color: colors.text }]}>Open for voting</Text>
        <Segmented accessibilityLabel="Who can vote" options={ACCESS} value={access} onChange={setAccess} />
        <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>This tier list becomes public and its books, name, and tiers are locked. At 100 distinct signed-in voters, it becomes an app-owned reference that stays available for everyone to consult.</Text>
      </> : <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>Only you can see this list. You can edit it and open voting later.</Text>}
      <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{pool.length} {pool.length === 1 ? "book" : "books"} · {tiers.length} tiers</Text>
    </View> : null}
    <View style={styles.actions}>
      {step > 0 ? <Button label="Back" variant="secondary" onPress={() => setStep((value) => value - 1)} /> : null}
      <View style={styles.grow}>{step < 2 ? <Button label="Next" disabled={step === 0 ? pool.length === 0 || library.isError : tiers.some((tier) => !tier.label.trim())} onPress={() => setStep((value) => value + 1)} /> : <Button label="Create tier list" loading={busy} onPress={() => void create()} />}</View>
    </View>
  </Screen>;
}

const styles = StyleSheet.create({
  screen: { padding: spacing.lg, gap: spacing.md },
  grow: { flex: 1 },
  book: { minHeight: 52, borderWidth: 1, borderRadius: radii.md, paddingHorizontal: spacing.md, marginBottom: spacing.xs, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  tiers: { gap: spacing.sm, paddingBottom: spacing.lg },
  tier: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  swatch: { width: 20, alignSelf: "stretch", borderRadius: radii.sm },
  settings: { flex: 1, gap: spacing.md },
  actions: { flexDirection: "row", alignItems: "stretch", gap: spacing.sm },
});
