import { useCallback, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { bookKey, eligiblePassages, pinPassage, resolveHomeBlock, resolveQuote, resolveQuoteCollection, resolveShelfBooks, type MuralBlock } from "@scripta/shared";
import { Button, EmptyState, ErrorState, Input, Screen, Sheet } from "../../ui";
import { spacing, useTheme } from "../../ui/theme";
import { useLibrary } from "../library/hooks/useLibrary";
import { fetchGalleryImages } from "../gallery/api";
import { fetchTierlists } from "../tierlists/api";
import { BlockContent, MuralCanvas } from "./MuralCanvas";
import { updateMural } from "./api";
import { useHome } from "./useHome";
import { useMurals } from "./useMurals";

export function HomeScreen() {
  const router = useRouter();
  const client = useQueryClient();
  const { colors } = useTheme();
  const home = useHome();
  const library = useLibrary();
  const murals = useMurals();
  const gallery = useQuery({ queryKey: ["gallery"], queryFn: fetchGalleryImages });
  const tierlists = useQuery({ queryKey: ["tierlists"], queryFn: fetchTierlists });
  const [query, setQuery] = useState("");
  const [choosing, setChoosing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));
  const [offsets, setOffsets] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useFocusEffect(useCallback(() => { setDay(new Date().toISOString().slice(0, 10)); setOffsets({}); void home.refetch(); void murals.refetch(); }, [home.refetch, murals.refetch]));
  const mural = home.data ? murals.data?.find((item) => item.id === home.data?.id) ?? home.data : null;
  const books = library.data?.data.books ?? [];
  const groups = library.data?.data.groups ?? [];
  const blocks = mural?.blocks.map((block) => resolveHomeBlock(block, books, groups, day, offsets[block.id] ?? 0)) ?? [];
  const selected = blocks.find((block) => block.id === selectedId);
  const original = mural?.blocks.find((block) => block.id === selectedId);
  const selectedBooks = selected?.type === "shelf" ? resolveShelfBooks(selected, books) : selected?.type === "currentlyReading" ? books.filter((book) => book.ReadStatus === 1) : selected?.type === "spotlight" ? books.filter((book) => bookKey(book) === selected.bookKey) : [];
  const quotes = selected?.type === "quoteCollection" ? resolveQuoteCollection(selected, books) : selected?.type === "quote" ? [resolveQuote(selected, books)].filter((quote) => quote !== null) : [];

  async function choose(choice: string | boolean) {
    try { await home.choose(choice); setChoosing(false); } catch { }
  }
  async function keep() {
    if (!mural || !original || !selected) return;
    setSaving(true);
    setError(null);
    try {
      const pinned = pinPassage(original, selected, books);
      const updated = await updateMural(mural.id, { blocks: mural.blocks.map((block) => block.id === pinned.id ? pinned : block), updatedAt: mural.updatedAt });
      client.setQueryData(["home"], updated);
      client.setQueryData(["murals", updated.id], updated);
      await client.invalidateQueries({ queryKey: ["murals"] });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Couldn't keep this passage."); }
    finally { setSaving(false); }
  }
  function openBlock(block: MuralBlock) {
    if (block.type === "spotlight" && books.some((book) => bookKey(book) === block.bookKey)) router.push(`/book/${encodeURIComponent(block.bookKey)}` as never);
    else setSelectedId(block.id);
  }
  return <Screen top={false}>
    <Stack.Screen options={{ title: "Home", headerShown: true }} />
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Input label="Search your library" value={query} onChangeText={setQuery} returnKeyType="search" onSubmitEditing={() => router.push({ pathname: "/library", params: { q: query } } as never)} />
      <View style={styles.actions}>
        <Button label="Search" variant="secondary" onPress={() => router.push({ pathname: "/library", params: { q: query } } as never)} />
        <Button label="Add book" variant="secondary" onPress={() => router.push("/add-book" as never)} />
        <Button label="Import" variant="secondary" onPress={() => router.push("/import" as never)} />
        {mural ? <Button label="Edit home" onPress={() => router.push(`/murals/${mural.id}` as never)} /> : null}
        <Button label="Choose mural" variant="secondary" onPress={() => setChoosing(true)} />
      </View>
      {error || home.choiceError ? <Text accessibilityRole="alert" style={{ color: colors.danger }}>{error ?? home.choiceError?.message}</Text> : null}
      {home.isPending || library.isPending ? <ActivityIndicator accessibilityLabel="Loading home" /> : home.isError || library.isError ? <ErrorState body="Couldn't load your home." actionLabel="Retry" onAction={() => { void home.refetch(); void library.refetch(); }} /> : <>
        {!books.length ? <EmptyState title="Bring your books into Scripta" body="Import your library or add a book to begin." /> : null}
        {mural ? <MuralCanvas mural={{ ...mural, blocks }} books={books} images={gallery.data ?? []} tierlists={tierlists.data ?? []} onSelectBlock={(id) => { const block = blocks.find((item) => item.id === id); if (block) openBlock(block); }} /> : <EmptyState title="Make yourself at home" body="Start with an editable reading space, or choose one of your murals." actionLabel={home.choosing ? "Creating…" : "Create my home"} onAction={home.choosing ? undefined : () => void choose(eligiblePassages(books).length > 0)} />}
      </>}
      {gallery.isError || tierlists.isError ? <ErrorState body="Some mural content couldn't load." actionLabel="Retry" onAction={() => { void gallery.refetch(); void tierlists.refetch(); }} /> : null}
    </ScrollView>
    <Sheet visible={choosing} title="Choose your home mural" onClose={() => setChoosing(false)}><ScrollView contentContainerStyle={styles.page}>
      {home.choiceError ? <Text accessibilityRole="alert" style={{ color: colors.danger }}>{home.choiceError.message}</Text> : null}
      {murals.isPending ? <ActivityIndicator /> : murals.isError ? <ErrorState actionLabel="Retry" onAction={() => void murals.refetch()} /> : murals.data?.length ? murals.data.map((item) => <Button key={item.id} label={item.name} disabled={home.choosing} variant="secondary" onPress={() => void choose(item.id)} />) : <Text style={{ color: colors.text }}>No murals yet. Create your home to get started.</Text>}
    </ScrollView></Sheet>
    <Sheet visible={Boolean(selected)} title="Your mural" onClose={() => setSelectedId(null)}><ScrollView contentContainerStyle={styles.page}>
      {selectedBooks.map((book) => <Button key={bookKey(book)} label={String(book.Title ?? "Untitled")} variant="secondary" onPress={() => { setSelectedId(null); router.push(`/book/${encodeURIComponent(bookKey(book))}` as never); }} />)}
      {original?.type === "shelf" && original.collectionId ? <Button label="Open collection" onPress={() => { setSelectedId(null); router.push({ pathname: "/collections", params: { group: original.collectionId } } as never); }} /> : null}
      {quotes.map((quote, index) => <View key={index} style={{ gap: spacing.sm }}><Text style={{ color: colors.text, fontSize: 18 }}>{String(quote.highlight.Text)}</Text><Text style={{ color: colors.textDim }}>{String(quote.book.Title)} · {String(quote.book.Attribution ?? "")}</Text><Button label="Open book" variant="secondary" onPress={() => { setSelectedId(null); router.push(`/book/${encodeURIComponent(bookKey(quote.book))}` as never); }} /></View>)}
      {original?.type === "quote" && original.mode === "rediscover" ? <><Button label="Show another" variant="secondary" disabled={saving || !quotes.length} onPress={() => setOffsets({ ...offsets, [original.id]: (offsets[original.id] ?? 0) + 1 })} /><Button label="Keep this passage" disabled={saving || !quotes.length} onPress={() => void keep()} />{error ? <Text accessibilityRole="alert" style={{ color: colors.danger }}>{error}</Text> : null}</> : null}
      {selected?.type === "tierlist" ? <Button label="Open tier list" onPress={() => { setSelectedId(null); router.push(`/tierlist/${selected.tierlistId}` as never); }} /> : null}
      {selected && !selectedBooks.length && !quotes.length ? <View style={{ minHeight: 160 }}><BlockContent block={selected} books={books} images={gallery.data ?? []} tierlists={tierlists.data ?? []} /></View> : null}
      {mural ? <Button label="Edit this mural" variant="secondary" onPress={() => { setSelectedId(null); router.push(`/murals/${mural.id}` as never); }} /> : null}
    </ScrollView></Sheet>
  </Screen>;
}
const styles = StyleSheet.create({ page: { padding: spacing.md, gap: spacing.md }, actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm } });
