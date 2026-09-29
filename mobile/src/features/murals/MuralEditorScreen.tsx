import { useCallback, useMemo, useState } from "react";
import {
  BLOCK_TYPE_LABELS,
  bookKey,
  createBlockCandidate,
  createDuplicateCandidate,
  type BlockType,
  type Mural,
  type MuralBlock,
} from "@scripta/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { AccessibilityInfo, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { Text } from "../../ui/Text";
import { Button, EmptyState, ErrorState, IconButton, Input, Screen, Sheet, Toast } from "../../ui";
import { spacing, typography, useTheme } from "../../ui/theme";
import { fetchGalleryImages } from "../gallery/api";
import { useLibrary } from "../library/hooks/useLibrary";
import { fetchTierlists } from "../tierlists/api";
import { changeBlockLayout } from "./layout";
import { BlockActionBar, type BlockAction } from "./BlockActionBar";
import { BlockSheet, type SheetTab } from "./BlockSheet";
import { ContentTab, hasContentFields, type PickerKind } from "./ContentTab";
import { LayoutTab } from "./LayoutTab";
import { BlockPreview, MuralCanvas } from "./MuralCanvas";
import { MuralShareSheet } from "./MuralShareSheet";
import { fetchMural, shareMural, unshareMural, updateMural } from "./api";
import { MURALS_QUERY_KEY } from "./useMurals";
import { useAuth } from "../../core/auth";
import { API_URL } from "../../core/config";

const BLOCK_TYPES = Object.keys(BLOCK_TYPE_LABELS) as BlockType[];

export function MuralEditorScreen({ id }: { id: string }) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const router = useRouter();
  const client = useQueryClient();
  const muralQuery = useQuery({ queryKey: ["murals", id], queryFn: () => fetchMural(id), retry: false });
  const libraryQuery = useLibrary();
  const { data: library } = libraryQuery;
  const gallery = useQuery({ queryKey: ["gallery"], queryFn: fetchGalleryImages });
  const tierlists = useQuery({ queryKey: ["tierlists"], queryFn: fetchTierlists });
  const [name, setName] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<MuralBlock[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetTab, setSheetTab] = useState<SheetTab | null>(null);
  const [adding, setAdding] = useState(false);
  const [picking, setPicking] = useState<PickerKind | null>(null);
  const [search, setSearch] = useState("");
  const [quoteBook, setQuoteBook] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [shareFor, setShareFor] = useState<Mural | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mural = muralQuery.data;
  const currentBlocks = blocks ?? mural?.blocks ?? [];
  const currentName = name ?? mural?.name ?? "Mural";
  const selected = currentBlocks.find((block) => block.id === selectedId) ?? null;
  const books = library?.data.books ?? [];
  const groups = library?.data.groups ?? [];
  const { width: windowWidth } = useWindowDimensions();
  const profile = user?.username ? { username: user.username, avatarUrl: user.avatarId ? `${API_URL}/auth/avatar/${user.avatarId}/file` : null } : undefined;
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
    setSheetTab(hasContentFields(type) ? "content" : null);
    setAdding(false);
  }

  function cacheMural(updated: Mural) {
    client.setQueryData(["murals", id], updated);
    client.setQueryData<Mural[]>(MURALS_QUERY_KEY, (items = []) => items.map((item) => item.id === updated.id ? updated : item));
    void client.invalidateQueries({ queryKey: ["home"] });
  }

  async function persist() {
    const updated = await updateMural(id, { name: currentName.trim() || mural!.name, blocks: currentBlocks, updatedAt: mural!.updatedAt });
    cacheMural(updated);
    setName(updated.name);
    setBlocks(updated.blocks);
    return updated;
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await persist();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't save this mural.");
    } finally {
      setBusy(false);
    }
  }

  if (muralQuery.isPending) return <View style={styles.center}><Text>Loading mural…</Text></View>;
  if (muralQuery.isError || !mural || !draftMural) return <ErrorState title="Mural unavailable" body="It may have been deleted." actionLabel="Back" onAction={() => router.back()} />;

  const blockActions: BlockAction[] = selected ? [
    { key: "done", label: "Done", icon: "confirm", onPress: () => setSelectedId(null) },
    ...(hasContentFields(selected.type) ? [{ key: "edit", label: "Edit", icon: "edit" as const, onPress: () => setSheetTab("content") }] : []),
    { key: "size", label: "Size", icon: "resize", onPress: () => setSheetTab("layout") },
    { key: "copy", label: "Copy", icon: "duplicate", onPress: () => { const copy = createDuplicateCandidate(selected, currentBlocks); setBlocks([...currentBlocks, copy]); setSelectedId(copy.id); } },
    { key: "delete", label: "Delete", icon: "delete", tone: "danger", onPress: () => { setBlocks(currentBlocks.filter((block) => block.id !== selected.id)); setSelectedId(null); } },
  ] : [];

  return (
    <Screen top={false} style={styles.screen}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: currentName || "Mural",
          headerRight: () => <IconButton framed accessibilityLabel="Save mural" label="Save" name="confirm" onPress={() => { if (!busy) void save(); }} />,
        }}
      />
      <View style={styles.nameRow}><Input label="Mural name" value={currentName} onChangeText={setName} /></View>
      {error ? <Toast visible message={error} tone="error" /> : null}
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.canvasScroll}>
        <MuralCanvas mural={draftMural} books={books} groups={groups} images={gallery.data ?? []} tierlists={tierlists.data ?? []} profile={profile} editable selectedBlockId={selectedId} onSelectBlock={(blockId) => { setSelectedId(blockId); if (blockId === null) setSheetTab(null); }} onLayoutChange={(blockId, layout) => {
          const next = changeBlockLayout(currentBlocks, blockId, layout);
          if (next === currentBlocks) AccessibilityInfo.announceForAccessibility("Can't move there");
          else setBlocks(next);
        }} />
      </ScrollView>
      <View style={[styles.dock, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {selected ? <BlockActionBar actions={blockActions} /> : <>
          <Button label="Add block" onPress={() => setAdding(true)} />
          <Button label="Share" variant="secondary" onPress={() => setShareFor(draftMural)} />
        </>}
      </View>
      <MuralShareSheet mural={shareFor} books={books} groups={groups} images={gallery.data ?? []} tierlists={tierlists.data ?? []} profile={profile} draft={shareFor !== null && (shareFor.name !== mural.name || shareFor.blocks !== mural.blocks)} contentReady={!libraryQuery.isPending && !gallery.isPending && !tierlists.isPending} contentError={libraryQuery.error?.message ?? gallery.error?.message ?? tierlists.error?.message ?? undefined} onRetryContent={() => { void libraryQuery.refetch(); void gallery.refetch(); void tierlists.refetch(); }} onClose={() => setShareFor(null)} onEnableLink={async () => {
        if (shareFor === null) return;
        if (shareFor.name !== mural.name || shareFor.blocks !== mural.blocks) setShareFor(await persist());
        const updated = await shareMural(id);
        cacheMural(updated);
        setShareFor(updated);
        return updated.shareUrl ?? undefined;
      }} onDisableLink={async () => {
        const updated = await unshareMural(id);
        cacheMural(updated);
        setShareFor({ ...updated, name: currentName, blocks: currentBlocks });
      }} />
      <Sheet visible={adding} title="Add block" onClose={() => setAdding(false)}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheet}>{BLOCK_TYPES.map((type) => <Button key={type} label={BLOCK_TYPE_LABELS[type]} variant="secondary" onPress={() => add(type)} />)}</ScrollView></Sheet>
      <BlockSheet
        block={selected}
        visible={selected !== null && sheetTab !== null && picking === null}
        tab={sheetTab}
        onTabChange={setSheetTab}
        onClose={() => setSheetTab(null)}
        preview={selected ? <BlockPreview block={selected} canvasWidth={windowWidth - spacing.sm * 2} maxHeight={200} books={books} images={gallery.data ?? []} tierlists={tierlists.data ?? []} profile={profile} groups={groups} /> : null}
        content={selected && hasContentFields(selected.type) ? <ContentTab block={selected} books={books} groups={groups} images={gallery.data ?? []} tierlists={tierlists.data ?? []} update={updateSelected} onPick={setPicking} /> : null}
        style={null}
        layout={selected ? <LayoutTab block={selected} blocks={currentBlocks} onChange={(patch) => setBlocks(changeBlockLayout(currentBlocks, selected.id, patch))} /> : null}
      />
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
});
