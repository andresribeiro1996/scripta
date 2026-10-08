import { useCallback, useMemo, useRef, useState } from "react";
import { THEME_IDS, themes, type ThemeId } from "@scripta/shared/themes";
import {
  BLOCK_TYPES,
  blockLabel,
  bookKey,
  compactMuralBlocks,
  createBlockCandidate,
  createDuplicateCandidate,
  isConfigurable,
  muralThemeId,
  moveMuralBlock,
  resolveBlockStyle,
  toggleMuralBlockExpansion,
  type BlockStyle,
  type BlockType,
  type Mural,
  type MuralBlock,
} from "@scripta/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { AccessibilityInfo, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, { useAnimatedReaction, useAnimatedRef, useAnimatedScrollHandler, useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { Text } from "../../ui/Text";
import { Button, Dialog, EditorHeading, EmptyState, ErrorState, Fab, HeaderActions, Icon, IconButton, Input, SaveStateButton, Sheet, Toast } from "../../ui";
import { BookPickerList } from "../library/components/BookPickerList";
import { ThemeGrid } from "../../ui/ThemeGrid";
import { MuralThemeScope, radii, spacing, typography } from "../../ui/theme";
import { MuralScreen } from "./MuralScreen";
import { fetchGalleryImages } from "../gallery/api";
import { useLibrary } from "../library/hooks/useLibrary";
import { fetchTierlists } from "../tierlists/api";
import { changeBlockLayout, MURAL_ROW_HEIGHT } from "./layout";
import { BlockActionBar, type BlockAction } from "./BlockActionBar";
import { BlockSheet, type SheetTab } from "./BlockSheet";
import { ContentTab, type PickerKind } from "./ContentTab";
import { LayoutTab } from "./LayoutTab";
import { BlockPreview, MuralCanvas, NO_GROUPS } from "./MuralCanvas";
import { MuralShareSheet } from "./MuralShareSheet";
import { StyleTab } from "./StyleTab";
import { fetchMural, shareMural, unshareMural, updateMural } from "./api";
import { MURALS_QUERY_KEY, withGrownBlocks } from "./useMurals";
import { useAuth } from "../../core/auth";
import { API_URL } from "../../core/config";

export function MuralEditorScreen({ id }: { id: string }) {
  const { user } = useAuth();
  const router = useRouter();
  const client = useQueryClient();
  const muralQuery = useQuery({ queryKey: ["murals", id], queryFn: () => fetchMural(id), select: withGrownBlocks, retry: false });
  const libraryQuery = useLibrary();
  const { data: library } = libraryQuery;
  const gallery = useQuery({ queryKey: ["gallery"], queryFn: fetchGalleryImages });
  const tierlists = useQuery({ queryKey: ["tierlists"], queryFn: fetchTierlists });
  const [name, setName] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemeId | null>(null);
  const [themeOpen, setThemeOpen] = useState(false);
  const [blocks, setBlocks] = useState<MuralBlock[] | null>(null);
  const [history, setHistory] = useState<MuralBlock[][]>([]);
  const scrollRef = useAnimatedRef<ScrollView>();
  const pendingScroll = useRef<number | null>(null);
  const scrollOffset = useSharedValue(0);
  const contentHeight = useSharedValue(0);
  const bottomInset = useSharedValue(88);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [canvasTop, setCanvasTop] = useState(0);
  const [dockHeight, setDockHeight] = useState(88);
  const [dragging, setDragging] = useState(false);
  const [scrolling, setScrolling] = useState(false);
  const scrollActive = useSharedValue(false);
  const blockToolsHidden = dragging || scrolling;
  const onDragChange = useCallback((active: boolean) => {
    setDragging(active);
    bottomInset.set(active ? 0 : dockHeight + spacing.md);
  }, [bottomInset, dockHeight]);
  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => { scrollOffset.set(event.contentOffset.y); },
    onBeginDrag: () => scrollActive.set(true),
    onEndDrag: () => scrollActive.set(false),
    onMomentumBegin: () => scrollActive.set(true),
    onMomentumEnd: () => scrollActive.set(false),
  });
  useAnimatedReaction(() => scrollActive.get(), (active, previous) => {
    if (active !== previous) scheduleOnRN(setScrolling, active);
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetTab, setSheetTab] = useState<SheetTab | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [copiedStyle, setCopiedStyle] = useState<BlockStyle | null>(null);
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [nameError, setNameError] = useState<string | undefined>();
  const [picking, setPicking] = useState<PickerKind | null>(null);
  const [quoteBook, setQuoteBook] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [shareFor, setShareFor] = useState<Mural | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mural = muralQuery.data;
  const currentBlocks = blocks ?? mural?.blocks ?? [];
  const currentName = name ?? mural?.name ?? "Mural";
  const currentTheme = theme ?? muralThemeId(mural?.theme);
  const colors = themes[currentTheme].colors;
  const selected = currentBlocks.find((block) => block.id === selectedId) ?? null;
  const books = library?.data.books ?? [];
  const groups = library?.data.groups ?? NO_GROUPS;
  const { width: windowWidth } = useWindowDimensions();
  const profile = user?.username ? { username: user.username, avatarUrl: user.avatarId ? `${API_URL}/auth/avatar/${user.avatarId}/file` : null } : undefined;

  useFocusEffect(useCallback(() => {
    void muralQuery.refetch().then(({ data }) => {
      if (!data) return;
      setName(data.name);
      setTheme(data.theme);
      setBlocks(data.blocks);
      setHistory([]);
    });
  }, [muralQuery.refetch]));

  const draftMural = useMemo(() => mural ? { ...mural, name: currentName, theme: currentTheme, blocks: currentBlocks } : null, [mural, currentName, currentTheme, currentBlocks]);
  const unsaved = useMemo(() => !!mural && ((currentName.trim() || mural.name) !== mural.name || currentTheme !== muralThemeId(mural.theme) || JSON.stringify(currentBlocks) !== JSON.stringify(mural.blocks)), [mural, currentName, currentTheme, currentBlocks]);

  function updateSelected(transform: (block: MuralBlock) => MuralBlock) {
    if (!selected) return;
    changeBlocks(currentBlocks.map((block) => block.id === selected.id ? transform(block) : block));
  }

  function changeBlocks(next: MuralBlock[]) {
    next = compactMuralBlocks(next);
    if (next === currentBlocks || JSON.stringify(next) === JSON.stringify(currentBlocks)) return;
    setHistory((items) => [...items.slice(-19), currentBlocks]);
    setBlocks(next);
  }

  function undo() {
    const previous = history.at(-1);
    if (!previous || busy) return;
    setBlocks(previous);
    setHistory(history.slice(0, -1));
    setSelectedId(null);
    setSheetTab(null);
    AccessibilityInfo.announceForAccessibility("Last block change undone");
  }

  function toggleExpansion(axis: "w" | "h") {
    if (!selected || busy) return;
    const bottom = Math.floor((scrollOffset.get() + viewportHeight - dockHeight - spacing.sm - canvasTop) / MURAL_ROW_HEIGHT);
    const top = Math.max(0, Math.ceil((scrollOffset.get() - canvasTop) / MURAL_ROW_HEIGHT));
    const next = toggleMuralBlockExpansion(currentBlocks, selected.id, axis, bottom, top);
    if (next === currentBlocks) AccessibilityInfo.announceForAccessibility("No room to expand this block");
    else changeBlocks(next);
  }

  function add(type: BlockType) {
    const block = createBlockCandidate(type, currentBlocks);
    changeBlocks([...currentBlocks, block]);
    setSelectedId(block.id);
    setSheetTab(isConfigurable(type) ? "content" : null);
    setAdding(false);
    const bottom = canvasTop + (block.layout.y + block.layout.h) * MURAL_ROW_HEIGHT;
    if (bottom > scrollOffset.get() + viewportHeight - dockHeight - spacing.md) {
      pendingScroll.current = bottom + dockHeight + spacing.md - viewportHeight;
      flushScroll(contentHeight.get());
    }
  }

  function flushScroll(height: number) {
    const y = pendingScroll.current;
    if (y === null || height < y + viewportHeight) return;
    pendingScroll.current = null;
    scrollRef.current?.scrollTo({ y, animated: true });
  }

  function cacheMural(updated: Mural) {
    client.setQueryData(["murals", id], updated);
    client.setQueryData<Mural[]>(MURALS_QUERY_KEY, (items = []) => items.map((item) => item.id === updated.id ? updated : item));
    void client.invalidateQueries({ queryKey: ["home"] });
  }

  async function persist() {
    const updated = await updateMural(id, { name: currentName.trim() || mural!.name, theme: currentTheme, blocks: currentBlocks, updatedAt: mural!.updatedAt });
    cacheMural(updated);
    setName(updated.name);
    setTheme(updated.theme);
    setBlocks(updated.blocks);
    setHistory([]);
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
    { key: "edit", label: "Edit", accessibilityLabel: "Edit block content, style and size", icon: "edit", tone: "accent", onPress: () => setSheetTab(isConfigurable(selected.type) ? "content" : "style") },
    { key: "more", label: "More", accessibilityLabel: "More block actions", icon: "more", onPress: () => setActionsOpen(true) },
    { key: "done", label: "Done", accessibilityLabel: "Deselect block", icon: "confirm", onPress: () => { setSelectedId(null); setSheetTab(null); } },
  ] : [];
  const moreActions: Array<BlockAction & { disabled?: boolean }> = selected ? [
    { key: "top", label: "Move to top", icon: "moveToTop", disabled: selected.layout.y === 0, onPress: () => {
      changeBlocks(moveMuralBlock(currentBlocks, selected.id, { ...selected.layout, y: 0 }));
      setActionsOpen(false);
      scrollRef.current?.scrollTo({ y: 0, animated: false });
      AccessibilityInfo.announceForAccessibility("Block moved to top");
    } },
    { key: "duplicate", label: "Duplicate", icon: "duplicate", onPress: () => {
      const copy = createDuplicateCandidate(selected, currentBlocks);
      changeBlocks([...currentBlocks, copy]); setSelectedId(copy.id); setActionsOpen(false);
    } },
    { key: "delete", label: "Delete", icon: "delete", onPress: () => {
      changeBlocks(currentBlocks.filter((block) => block.id !== selected.id)); setSelectedId(null); setSheetTab(null); setActionsOpen(false);
    } },
  ] : [];

  return (
    <MuralScreen theme={currentTheme}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: "",
          headerLargeTitleEnabled: false,
          headerRight: () => dragging ? null : <MuralThemeScope theme={currentTheme}><HeaderActions>
            <SaveStateButton busy={busy} unsaved={unsaved} onPress={() => void save()} />
            <IconButton framed accessibilityLabel="Mural theme" name="theme" onPress={() => setThemeOpen(true)} />
            <IconButton framed accessibilityLabel="Share mural" name="share" onPress={() => setShareFor(draftMural)} />
          </HeaderActions></MuralThemeScope>,
        }}
      />
      {error ? <Toast visible message={error} tone="error" /> : null}
      <Animated.ScrollView ref={scrollRef} onLayout={(event) => setViewportHeight(event.nativeEvent.layout.height)} onScroll={onScroll} scrollEventThrottle={16} onContentSizeChange={(_width, height) => { contentHeight.set(height); flushScroll(height); }} keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.canvasScroll, { paddingBottom: Math.max(120, dockHeight + spacing.md) }]}>
        <EditorHeading name={currentName} accessibilityLabel={`Rename mural, ${currentName}`} onRename={() => { setDraftName(currentName); setNameError(undefined); setRenaming(true); }} />
        <Text style={[typography.caption, styles.dragHelp, { color: colors.textDim }]}>Hold a block to drag. Move to an edge to scroll.</Text>
        <View onLayout={(event) => setCanvasTop(event.nativeEvent.layout.y)}><MuralCanvas mural={draftMural} books={books} groups={groups} images={gallery.data ?? []} tierlists={tierlists.data ?? []} profile={profile} editable={!busy} onDragChange={onDragChange} dragScroll={{ ref: scrollRef, offset: scrollOffset, contentHeight, bottomInset }} selectedBlockId={selectedId} onSelectBlock={(blockId) => { setSelectedId(blockId); if (blockId === null) setSheetTab(null); }} onLayoutChange={(blockId, layout) => {
          const next = moveMuralBlock(currentBlocks, blockId, layout);
          if (next === currentBlocks) AccessibilityInfo.announceForAccessibility("Can't move there");
          else changeBlocks(next);
        }} /></View>
      </Animated.ScrollView>
      {selected ? <View pointerEvents={blockToolsHidden ? "none" : "auto"} accessibilityElementsHidden={blockToolsHidden} importantForAccessibility={blockToolsHidden ? "no-hide-descendants" : "auto"} onLayout={(event) => { const height = event.nativeEvent.layout.height; setDockHeight(height); if (!dragging) bottomInset.set(height + spacing.md); }} style={[styles.dock, { opacity: blockToolsHidden ? 0 : 1, backgroundColor: colors.surface, borderColor: colors.border }]}><BlockActionBar actions={blockActions} disabled={busy} /></View> : !dragging ? <Fab label="Add" accessibilityLabel="Add block" onPress={() => setAdding(true)} /> : null}
      {history.length && !blockToolsHidden ? <View style={[styles.undo, { bottom: selected ? dockHeight + spacing.md : spacing.md }]}><Button label="Undo" variant="secondary" disabled={busy} onPress={undo} /></View> : null}
      <Dialog visible={renaming} title="Rename mural" onClose={() => setRenaming(false)}>
        <View style={styles.dialog}><Input label="Mural name" value={draftName} error={nameError} onChangeText={(text) => { setDraftName(text); setNameError(undefined); }} /><Button label="Done" onPress={() => { const trimmed = draftName.trim(); if (!trimmed) { setNameError("Name can't be empty"); return; } setName(trimmed); setRenaming(false); }} /></View>
      </Dialog>
      <MuralShareSheet mural={shareFor} books={books} groups={groups} images={gallery.data ?? []} tierlists={tierlists.data ?? []} profile={profile} draft={unsaved} contentReady={!libraryQuery.isPending && !gallery.isPending && !tierlists.isPending} contentError={libraryQuery.error?.message ?? gallery.error?.message ?? tierlists.error?.message ?? undefined} onRetryContent={() => { void libraryQuery.refetch(); void gallery.refetch(); void tierlists.refetch(); }} onClose={() => setShareFor(null)} onEnableLink={async () => {
        if (shareFor === null) return;
        if (unsaved) setShareFor(await persist());
        const updated = await shareMural(id);
        cacheMural(updated);
        setShareFor(updated);
        return updated.shareUrl ?? undefined;
      }} onDisableLink={async () => {
        const updated = await unshareMural(id);
        cacheMural(updated);
        setShareFor({ ...updated, name: currentName, theme: currentTheme, blocks: currentBlocks });
      }} />
      <Sheet visible={themeOpen} title="Theme" onClose={() => setThemeOpen(false)}><ScrollView contentContainerStyle={styles.sheet}><ThemeGrid options={THEME_IDS} value={currentTheme} onChange={(next) => { setTheme(next); setThemeOpen(false); }} /></ScrollView></Sheet>
      <Sheet visible={adding} title="Add block" onClose={() => setAdding(false)}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheet}>{BLOCK_TYPES.map((type) => <Button key={type} label={blockLabel(type)} variant="secondary" onPress={() => add(type)} />)}</ScrollView></Sheet>
      <Sheet visible={selected !== null && actionsOpen} title={selected ? `${blockLabel(selected.type)} actions` : "Block actions"} onClose={() => setActionsOpen(false)}>
        <View>
          {moreActions.map((action) => {
            const disabled = busy || action.disabled;
            const color = action.key === "delete" ? colors.danger : colors.text;
            return <View key={action.key}>
              {action.key === "delete" ? <View style={[styles.actionDivider, { backgroundColor: colors.border }]} /> : null}
              <Pressable accessibilityRole="button" accessibilityLabel={action.label} accessibilityState={{ disabled: Boolean(disabled) }} disabled={disabled} onPress={action.onPress} style={({ pressed }) => [styles.actionRow, { opacity: disabled ? 0.55 : 1, backgroundColor: pressed ? colors.surfacePressed : "transparent" }]}>
                <Icon name={action.icon} color={color} size={22} />
                <Text style={[typography.body, { color }]}>{action.label}</Text>
              </Pressable>
            </View>;
          })}
        </View>
      </Sheet>
      <BlockSheet
        block={selected}
        visible={selected !== null && sheetTab !== null && picking === null}
        tab={sheetTab}
        onTabChange={setSheetTab}
        onClose={() => setSheetTab(null)}
        preview={(maxHeight) => selected ? <BlockPreview theme={currentTheme} block={selected} canvasWidth={windowWidth - spacing.sm * 2} maxHeight={maxHeight} books={books} images={gallery.data ?? []} tierlists={tierlists.data ?? []} profile={profile} groups={groups} /> : null}
        content={selected && isConfigurable(selected.type) ? <ContentTab block={selected} books={books} groups={groups} images={gallery.data ?? []} tierlists={tierlists.data ?? []} update={updateSelected} onPick={setPicking} /> : null}
        style={selected ? <StyleTab
          style={resolveBlockStyle(selected.style)}
          palette={themes[currentTheme].colors}
          onChange={(style) => updateSelected((block) => ({ ...block, style }))}
          onReset={() => updateSelected((block) => { const next = { ...block }; delete next.style; return next; })}
          onCopy={() => setCopiedStyle(resolveBlockStyle(selected.style))}
          onPaste={() => { if (copiedStyle) updateSelected((block) => ({ ...block, style: copiedStyle })); }}
          canPaste={copiedStyle !== null}
        /> : null}
        layout={selected ? <LayoutTab block={selected} blocks={currentBlocks} disabled={busy} onToggleExpansion={toggleExpansion} onChange={(patch) => changeBlocks(changeBlockLayout(currentBlocks, selected.id, patch))} /> : null}
      />
      <Sheet visible={picking !== null} title={quoteBook ? "Choose a passage" : `Choose ${picking ?? "content"}`} onClose={() => { setPicking(null); setQuoteBook(null); }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheet}>
          {quoteBook ? <><Button label="Back to books" variant="secondary" onPress={() => setQuoteBook(null)} />{(Array.isArray(quoteBook.highlights) ? quoteBook.highlights : []).filter((highlight) => highlight && typeof highlight === "object" && typeof highlight.BookmarkID === "string").map((highlight) => <Button key={String(highlight.BookmarkID)} label={String(highlight.Text ?? highlight.Annotation ?? "Untitled passage")} variant="secondary" onPress={() => {
            const ref = { bookKey: bookKey(quoteBook), highlightId: String(highlight.BookmarkID) };
            updateSelected((block) => block.type === "quote" ? { ...block, ...ref, mode: undefined } : block.type === "quoteCollection" ? { ...block, quotes: block.quotes.some((quote) => quote.bookKey === ref.bookKey && quote.highlightId === ref.highlightId) ? block.quotes : [...block.quotes, ref] } : block);
            setQuoteBook(null); setPicking(null);
          }} />)}{!Array.isArray(quoteBook.highlights) || quoteBook.highlights.length === 0 ? <Text style={{ color: colors.text }}>No saved passages in this book.</Text> : null}</> : null}
          {picking === "book" && !quoteBook ? <BookPickerList
  books={books}
  label="Search books"
  isSelected={selected?.type === "shelf" ? (book) => selected.bookKeys.includes(bookKey(book)) : undefined}
  onSelect={(book) => {
    if (selected?.type === "quote" || selected?.type === "quoteCollection") { setQuoteBook(book); return; }
    updateSelected((block) => {
      const key = bookKey(book);
      if (block.type === "spotlight") return { ...block, bookKey: key };
      if (block.type === "shelf") return { ...block, collectionId: undefined, bookKeys: block.bookKeys.includes(key) ? block.bookKeys.filter((item) => item !== key) : [...block.bookKeys, key] };
      return block;
    });
    if (selected?.type !== "shelf") setPicking(null);
  }}
/> : null}
          {picking === "image" ? (gallery.data ?? []).map((image) => <Pressable accessibilityLabel={`Choose ${image.filename}`} accessibilityRole="button" key={image.id} onPress={() => { updateSelected((block) => block.type === "image" ? { ...block, imageId: image.id } : block); setPicking(null); }}><Text style={[typography.body, { color: colors.text }]}>{image.filename}</Text></Pressable>) : null}
          {picking === "tierlist" ? (tierlists.data ?? []).map((tierlist) => <Button key={tierlist.id} label={tierlist.name} variant="secondary" onPress={() => { updateSelected((block) => block.type === "tierlist" ? { ...block, tierlistId: tierlist.id } : block); setPicking(null); }} />) : null}
          {picking && ((picking === "book" && books.length === 0) || (picking === "image" && !gallery.data?.length) || (picking === "tierlist" && !tierlists.data?.length)) ? <EmptyState title="Nothing available" /> : null}
        </ScrollView>
      </Sheet>
    </MuralScreen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  canvasScroll: { paddingHorizontal: spacing.sm, paddingTop: spacing.md, paddingBottom: 120 },
  dock: { position: "absolute", left: spacing.sm, right: spacing.sm, bottom: spacing.sm, borderWidth: 1, borderRadius: radii.xl, padding: spacing.xs, flexDirection: "row" },
  dragHelp: { paddingHorizontal: spacing.sm, marginBottom: spacing.md },
  undo: { position: "absolute", left: spacing.md },
  dialog: { gap: spacing.md },
  sheet: { gap: spacing.sm, paddingBottom: spacing.xl },
  actionRow: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radii.lg },
  actionDivider: { height: StyleSheet.hairlineWidth, marginVertical: spacing.sm },
});
