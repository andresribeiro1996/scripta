import { useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { seedCoverLookup, toSeedBook, type SeedBook } from "@scripta/shared";
import { Button, EmptyState, ErrorState, Input, Sheet, Skeleton, Toast, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { apiClient } from "../../core/api";
import { createTournament, fetchTournament, randomFillTournament, resolveCover, setTournamentSlots, startTournament, type TournamentSummary } from "./api";

interface LibraryResponse { data: { books?: Array<Record<string, unknown>> } | null }

export function ArenaSeedScreen({ tournament, onClose, onStarted }: { tournament?: TournamentSummary; onClose: () => void; onStarted: (id: string) => void }) {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const [name, setName] = useState(tournament?.name ?? "Untitled tournament");
  const [size, setSize] = useState(tournament?.bracketSize ?? 16);
  const [duration, setDuration] = useState(String((tournament?.roundDurationMinutes ?? 1440) / 60));
  const [current, setCurrent] = useState(tournament);
  const [slots, setSlots] = useState<Array<SeedBook | null>>(() => Array.from({ length: tournament?.bracketSize ?? 16 }, () => null));
  const [slotToAssign, setSlotToAssign] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const library = useQuery({ queryKey: ["library"], queryFn: () => apiClient.request<LibraryResponse>("/library", { auth: true }), retry: false });
  const saved = useQuery({
    queryKey: ["arena", current?.id, "seed"],
    queryFn: () => fetchTournament(current!.id, "owner-seed"),
    enabled: Boolean(current),
    retry: false,
  });

  useEffect(() => {
    if (!saved.data) return;
    const byIndex = new Map(saved.data.slots.map((slot) => [slot.slotIndex, slot]));
    setSlots(Array.from({ length: saved.data.bracketSize }, (_, index) => byIndex.get(index) ?? null));
  }, [saved.data]);

  async function materialize() {
    if (current) return current;
    const hours = Number(duration);
    const created = await createTournament(name.trim() || "Untitled tournament", size, Number.isFinite(hours) && hours > 0 ? hours * 60 : 1440);
    setCurrent(created);
    await queryClient.invalidateQueries({ queryKey: ["arena", "mine"] });
    return created;
  }

  async function persist(nextSlots = slots) {
    const target = await materialize();
    await setTournamentSlots(target.id, nextSlots.flatMap((book, slotIndex) => book ? [{ slotIndex, book }] : []));
    await queryClient.invalidateQueries({ queryKey: ["arena", target.id, "seed"] });
    return target;
  }

  async function seedBook(book: Record<string, unknown>, slotIndex: number) {
    setBusy(true);
    setError(null);
    try {
      const lookup = seedCoverLookup(book);
      const cover = lookup ? await resolveCover(book) : null;
      const next = [...slots];
      next[slotIndex] = toSeedBook(book, cover);
      setSlots(next);
      setSlotToAssign(null);
      await persist(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't assign that book.");
    } finally {
      setBusy(false);
    }
  }

  async function randomFill() {
    setBusy(true);
    setError(null);
    try {
      const target = await materialize();
      const books = library.data?.data?.books ?? [];
      const pool = await Promise.all(books.map(async (book) => toSeedBook(book, seedCoverLookup(book) ? await resolveCover(book) : null)));
      await randomFillTournament(target.id, pool);
      const refreshed = await fetchTournament(target.id, "owner-seed");
      const byIndex = new Map(refreshed.slots.map((slot) => [slot.slotIndex, slot]));
      setSlots(Array.from({ length: refreshed.bracketSize }, (_, index) => byIndex.get(index) ?? null));
      await queryClient.invalidateQueries({ queryKey: ["arena", target.id, "seed"] });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't fill the bracket.");
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const target = await persist();
      await startTournament(target.id);
      await queryClient.invalidateQueries({ queryKey: ["arena"] });
      onStarted(target.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't start the tournament.");
    } finally {
      setBusy(false);
    }
  }

  const books = library.data?.data?.books ?? [];
  const assigned = new Set(slots.flatMap((book) => book ? [book.key] : []));
  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Button label="Back" variant="secondary" onPress={onClose} />
        <Text accessibilityRole="header" {...dynamicType} style={[typography.title, styles.grow, { color: colors.text }]}>Seed tournament</Text>
      </View>
      {!current ? (
        <View style={styles.form}>
          <Input label="Tournament name" value={name} onChangeText={setName} maxLength={200} />
          <Text {...dynamicType} style={[typography.body, { color: colors.text }]}>Bracket size</Text>
          <View style={styles.row}>{[4, 8, 16, 32, 64].map((value) => <Button key={value} label={String(value)} variant={size === value ? "primary" : "secondary"} onPress={() => { setSize(value); setSlots(Array.from({ length: value }, () => null)); }} />)}</View>
          <Input label="Round duration (hours)" keyboardType="decimal-pad" value={duration} onChangeText={setDuration} />
        </View>
      ) : null}
      {error ? <Toast visible message={error} tone="error" /> : null}
      <View style={styles.actions}>
        <Button label="Random fill" variant="secondary" loading={busy} disabled={!books.length} onPress={randomFill} />
        <Button label="Save progress" variant="secondary" loading={busy} onPress={() => void persist().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Couldn't save."))} />
        <Button label="Start" loading={busy} disabled={slots.some((slot) => !slot)} onPress={start} />
      </View>
      {library.isPending ? <Skeleton height={120} /> : library.isError ? <ErrorState body="Your library couldn't be loaded." actionLabel="Retry" onAction={() => void library.refetch()} /> : (
        <FlatList
          data={slots}
          keyExtractor={(_, index) => String(index)}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<EmptyState title="No slots" />}
          renderItem={({ item, index }) => (
            <Pressable accessibilityRole="button" accessibilityLabel={item ? `Slot ${index + 1}, ${item.title}. Change book` : `Assign slot ${index + 1}`} onPress={() => setSlotToAssign(index)} style={[styles.slot, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>Slot {index + 1}</Text>
              <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.grow, { color: colors.text }]}>{item?.title ?? "Empty — tap to assign"}</Text>
            </Pressable>
          )}
        />
      )}
      <Sheet visible={slotToAssign !== null} title={`Choose book for slot ${(slotToAssign ?? 0) + 1}`} onClose={() => setSlotToAssign(null)}>
        <FlatList
          data={books.filter((book) => !assigned.has(toSeedBook(book, null).key))}
          keyExtractor={(book) => toSeedBook(book, null).key}
          style={styles.picker}
          ListEmptyComponent={<EmptyState title="No available books" body="Every available book is already assigned." />}
          renderItem={({ item }) => <Pressable disabled={busy} onPress={() => void seedBook(item, slotToAssign!)} style={styles.pickRow}><Text numberOfLines={1} {...dynamicType} style={[typography.body, { color: colors.text }]}>{String(item.Title ?? "Untitled")}</Text></Pressable>}
        />
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: spacing.lg, gap: spacing.md },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  grow: { flex: 1 },
  form: { gap: spacing.sm },
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  list: { gap: spacing.sm, paddingBottom: spacing.huge },
  slot: { minHeight: 52, borderWidth: 1, borderRadius: radii.md, padding: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.md },
  picker: { maxHeight: 420 },
  pickRow: { minHeight: 48, justifyContent: "center", paddingVertical: spacing.sm },
});
