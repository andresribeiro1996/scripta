import { useCallback, useMemo, useState } from "react";
import {
  ALL_STAT_METRICS,
  BLOCK_TYPE_LABELS,
  bookKey,
  resolveHomeBlock,
  createBlockCandidate,
  createDuplicateCandidate,
  type BlockType,
  type MuralBlock,
} from "@scripta/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button, EmptyState, ErrorState, IconButton, Input, Screen, Sheet, Toast } from "../../ui";
import { spacing, typography, useTheme } from "../../ui/theme";
import { fetchGalleryImages } from "../gallery/api";
import { useLibrary } from "../library/hooks/useLibrary";
import { fetchTierlists } from "../tierlists/api";
import { changeBlockLayout } from "./layout";
import { MuralCanvas } from "./MuralCanvas";
import { fetchMural, updateMural } from "./api";
import { MURALS_QUERY_KEY } from "./useMurals";

const BLOCK_TYPES = Object.keys(BLOCK_TYPE_LABELS) as BlockType[];

export function MuralEditorScreen({ id }: { id: string }) {
  const { colors } = useTheme();
  const router = useRouter();
  const client = useQueryClient();
  const muralQuery = useQuery({ queryKey: ["murals", id], queryFn: () => fetchMural(id), retry: false });
  const { data: library } = useLibrary();
  const gallery = useQuery({ queryKey: ["gallery"], queryFn: fetchGalleryImages });
  const tierlists = useQuery({ queryKey: ["tierlists"], queryFn: fetchTierlists });
  const [name, setName] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<MuralBlock[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [picking, setPicking] = useState<"book" | "image" | "tierlist" | null>(null);
  const [search, setSearch] = useState("");
  const [quoteBook, setQuoteBook] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mural = muralQuery.data;
  const currentBlocks = blocks ?? mural?.blocks ?? [];
  const currentName = name ?? mural?.name ?? "Mural";
  const selected = currentBlocks.find((block) => block.id === selectedId) ?? null;
  const books = library?.data.books ?? [];
  const needle = search.trim().toLowerCase();
  const filteredBooks = needle ? books.filter((book) => `${book.Title ?? ""} ${book.Attribution ?? ""}`.toLowerCase().includes(needle)) : books;

  useFocusEffect(useCallback(() => {
    void muralQuery.refetch().then(({ data }) => {
      if (!data) return;
      setName(data.name);
      setBlocks(data.blocks);
    });
  }, [muralQuery.refetch]));

  const draftMural = useMemo(() => mural ? { ...mural, name: currentName, blocks: currentBlocks } : null, [mural, currentName, currentBlocks]);

  function updateSelected(transform: (block: MuralBlock) => MuralBlock) {
    if (!selected) return;
    setBlocks(currentBlocks.map((block) => block.id === selected.id ? transform(block) : block));
  }

  function add(type: BlockType) {
    const block = createBlockCandidate(type, currentBlocks);
    setBlocks([...currentBlocks, block]);
    setSelectedId(block.id);
    setAdding(false);
  }

  async function save() {
    if (!mural) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await updateMural(mural.id, { name: currentName.trim() || mural.name, blocks: currentBlocks, updatedAt: mural.updatedAt });
      client.setQueryData(["murals", id], updated);
      client.setQueryData<typeof updated[]>(MURALS_QUERY_KEY, (items = []) => items.map((item) => item.id === updated.id ? updated : item));
      void client.invalidateQueries({ queryKey: ["home"] });
      setName(updated.name);
      setBlocks(updated.blocks);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't save this mural.");
    } finally {
      setBusy(false);
    }
  }

  if (muralQuery.isPending) return <View style={styles.center}><Text>Loading mural…</Text></View>;
  if (muralQuery.isError || !mural || !draftMural) return <ErrorState title="Mural unavailable" body="It may have been deleted." actionLabel="Back" onAction={() => router.back()} />;

  return (
    <Screen top={false} style={styles.screen}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: currentName || "Mural",
          headerRight: () => <IconButton accessibilityLabel="Save mural" name="confirm" onPress={() => void save()} />,
        }}
      />
      <View style={styles.nameRow}><Input label="Mural name" value={currentName} onChangeText={setName} /></View>
      {error ? <Toast visible message={error} tone="error" /> : null}
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.canvasScroll}>
        <MuralCanvas mural={draftMural} books={books} groups={library?.data.groups ?? []} images={gallery.data ?? []} tierlists={tierlists.data ?? []} editable selectedBlockId={selectedId} onSelectBlock={setSelectedId} onLayoutChange={(blockId, layout) => setBlocks(changeBlockLayout(currentBlocks, blockId, layout))} />
      </ScrollView>
      <View style={[styles.dock, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Button label="Add block" onPress={() => setAdding(true)} />
        {selected ? <><Button label="Configure" variant="secondary" onPress={() => setPicking(selected.type === "image" ? "image" : selected.type === "tierlist" ? "tierlist" : selected.type === "spotlight" || selected.type === "shelf" || selected.type === "quote" || selected.type === "quoteCollection" ? "book" : null)} /><Button label="Duplicate" variant="secondary" onPress={() => setBlocks([...currentBlocks, createDuplicateCandidate(selected, currentBlocks)])} /><Button label="Delete" variant="destructive" onPress={() => { setBlocks(currentBlocks.filter((block) => block.id !== selected.id)); setSelectedId(null); }} /></> : null}
      </View>
      <Sheet visible={adding} title="Add block" onClose={() => setAdding(false)}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheet}>{BLOCK_TYPES.map((type) => <Button key={type} label={BLOCK_TYPE_LABELS[type]} variant="secondary" onPress={() => add(type)} />)}</ScrollView></Sheet>
      <Sheet visible={selected !== null && picking === null} title="Block settings" onClose={() => setSelectedId(null)}>
        {selected ? <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheet}>
          {selected.type === "shelf" ? <>
            <Text style={{ color: colors.text }}>Shelf source</Text>
            <Button label="Pick books (keep the current selection)" variant="secondary" onPress={() => updateSelected((block) => block.type === "shelf" ? { ...block, collectionId: undefined, bookKeys: (resolveHomeBlock(block, books, library?.data.groups ?? [], "") as typeof block).bookKeys } : block)} />
            {(library?.data.groups ?? []).filter((group) => group.type === "collection").map((group) => <Button key={group.id} label={`Follow ${group.name}`} variant="secondary" onPress={() => updateSelected((block) => block.type === "shelf" ? { ...block, collectionId: group.id, bookKeys: [] } : block)} />)
            }
            {selected.collectionId ? <Text style={{ color: colors.textDim }}>Following a collection. Leave the title blank to use its name.</Text> : null}
          </> : null}
          {selected.type === "quote" ? <><Button label="Rediscover a passage" variant="secondary" onPress={() => updateSelected((block) => block.type === "quote" ? { ...block, mode: "rediscover", bookKey: "", highlightId: "" } : block)} /><Text style={{ color: colors.textDim }}>Only known book passages are rediscovered. Choose books below to pin a specific highlight instead.</Text></> : null}
          {selected.type === "text" ? <><Input label="Heading" value={selected.heading} onChangeText={(heading) => updateSelected((block) => ({ ...block, heading } as MuralBlock))} /><Input label="Body" value={selected.body} multiline onChangeText={(body) => updateSelected((block) => ({ ...block, body } as MuralBlock))} /></> : null}
          {selected.type === "shelf" || selected.type === "quoteCollection" ? <Input label="Title" value={selected.title} onChangeText={(title) => updateSelected((block) => ({ ...block, title } as MuralBlock))} /> : null}
          {selected.type === "spotlight" || selected.type === "image" ? <Input label="Caption" value={selected.caption ?? ""} onChangeText={(caption) => updateSelected((block) => ({ ...block, caption } as MuralBlock))} /> : null}
          {selected.type === "stats" ? <View style={styles.sheet}>{ALL_STAT_METRICS.map((metric) => <Pressable accessibilityLabel={metric} accessibilityRole="checkbox" accessibilityState={{ checked: selected.metrics.includes(metric) }} key={metric} onPress={() => updateSelected((block) => block.type === "stats" ? { ...block, metrics: block.metrics.includes(metric) ? block.metrics.filter((item) => item !== metric) : [...block.metrics, metric] } : block)}><Text style={[typography.body, { color: selected.metrics.includes(metric) ? colors.accent : colors.text }]}>✓ {metric}</Text></Pressable>)}</View> : null}
          <Text style={[typography.caption, { color: colors.textDim }]}>Position x{selected.layout.x}, y{selected.layout.y}; size {selected.layout.w}×{selected.layout.h}</Text>
          <View style={styles.row}><Button label="←" accessibilityLabel="Move block left" variant="secondary" onPress={() => setBlocks(changeBlockLayout(currentBlocks, selected.id, { x: selected.layout.x - 1 }))} /><Button label="→" accessibilityLabel="Move block right" variant="secondary" onPress={() => setBlocks(changeBlockLayout(currentBlocks, selected.id, { x: selected.layout.x + 1 }))} /><Button label="↑" accessibilityLabel="Move block up" variant="secondary" onPress={() => setBlocks(changeBlockLayout(currentBlocks, selected.id, { y: selected.layout.y - 1 }))} /><Button label="↓" accessibilityLabel="Move block down" variant="secondary" onPress={() => setBlocks(changeBlockLayout(currentBlocks, selected.id, { y: selected.layout.y + 1 }))} /></View>
          <View style={styles.row}><Button label="Narrower" variant="secondary" onPress={() => setBlocks(changeBlockLayout(currentBlocks, selected.id, { w: selected.layout.w - 1 }))} /><Button label="Wider" variant="secondary" onPress={() => setBlocks(changeBlockLayout(currentBlocks, selected.id, { w: selected.layout.w + 1 }))} /><Button label="Shorter" variant="secondary" onPress={() => setBlocks(changeBlockLayout(currentBlocks, selected.id, { h: selected.layout.h - 1 }))} /><Button label="Taller" variant="secondary" onPress={() => setBlocks(changeBlockLayout(currentBlocks, selected.id, { h: selected.layout.h + 1 }))} /></View>
          {selected.type === "spotlight" || (selected.type === "shelf" && !selected.collectionId) || selected.type === "quote" || selected.type === "quoteCollection" ? <Button label="Choose books" onPress={() => setPicking("book")} /> : null}
          {selected.type === "image" ? <Button label="Choose image" onPress={() => setPicking("image")} /> : null}
          {selected.type === "tierlist" ? <Button label="Choose tier list" onPress={() => setPicking("tierlist")} /> : null}
        </ScrollView> : null}
      </Sheet>
      <Sheet visible={picking !== null} title={quoteBook ? "Choose a passage" : `Choose ${picking ?? "content"}`} onClose={() => { setPicking(null); setQuoteBook(null); }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheet}>
          {quoteBook ? <><Button label="Back to books" variant="secondary" onPress={() => setQuoteBook(null)} />{(Array.isArray(quoteBook.highlights) ? quoteBook.highlights : []).filter((highlight) => highlight && typeof highlight === "object" && typeof highlight.BookmarkID === "string").map((highlight) => <Button key={String(highlight.BookmarkID)} label={String(highlight.Text ?? highlight.Annotation ?? "Untitled passage")} variant="secondary" onPress={() => {
            const ref = { bookKey: bookKey(quoteBook), highlightId: String(highlight.BookmarkID) };
            updateSelected((block) => block.type === "quote" ? { ...block, ...ref, mode: undefined } : block.type === "quoteCollection" ? { ...block, quotes: block.quotes.some((quote) => quote.bookKey === ref.bookKey && quote.highlightId === ref.highlightId) ? block.quotes : [...block.quotes, ref] } : block);
            setQuoteBook(null); setPicking(null);
          }} />)}{!Array.isArray(quoteBook.highlights) || quoteBook.highlights.length === 0 ? <Text style={{ color: colors.text }}>No saved passages in this book.</Text> : null}</> : null}
          {picking === "book" && !quoteBook ? <><Input label="Search books" value={search} onChangeText={setSearch} autoCapitalize="none" autoCorrect={false} clearButtonMode="while-editing" returnKeyType="search" />{filteredBooks.map((book) => <Button key={bookKey(book)} label={String(book.Title ?? "Untitled")} variant="secondary" onPress={() => { if (selected?.type === "quote" || selected?.type === "quoteCollection") { setQuoteBook(book); return; } updateSelected((block) => {
            const key = bookKey(book);
            if (block.type === "spotlight") return { ...block, bookKey: key };
            if (block.type === "shelf") return { ...block, collectionId: undefined, bookKeys: block.bookKeys.includes(key) ? block.bookKeys.filter((item) => item !== key) : [...block.bookKeys, key] };
            return block;
          }); if (selected?.type !== "shelf") setPicking(null); }} />)}</> : null}
          {picking === "image" ? (gallery.data ?? []).map((image) => <Pressable accessibilityLabel={`Choose ${image.filename}`} accessibilityRole="button" key={image.id} onPress={() => { updateSelected((block) => block.type === "image" ? { ...block, imageId: image.id } : block); setPicking(null); }}><Text style={[typography.body, { color: colors.text }]}>{image.filename}</Text></Pressable>) : null}
          {picking === "tierlist" ? (tierlists.data ?? []).map((tierlist) => <Button key={tierlist.id} label={tierlist.name} variant="secondary" onPress={() => { updateSelected((block) => block.type === "tierlist" ? { ...block, tierlistId: tierlist.id } : block); setPicking(null); }} />) : null}
          {picking && ((picking === "book" && filteredBooks.length === 0) || (picking === "image" && !gallery.data?.length) || (picking === "tierlist" && !tierlists.data?.length)) ? <EmptyState title="Nothing available" /> : null}
        </ScrollView>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {},
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  nameRow: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  canvasScroll: { paddingHorizontal: spacing.sm, paddingBottom: 120 },
  dock: { position: "absolute", left: 0, right: 0, bottom: 0, borderTopWidth: 1, padding: spacing.sm, flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  sheet: { gap: spacing.sm, paddingBottom: spacing.xl },
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
});
