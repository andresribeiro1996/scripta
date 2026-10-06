import { useEffect, useRef, useState } from "react";
import { Keyboard, Platform, StyleSheet, View } from "react-native";
import {
  CARD_GAP_RANGE, CARD_MIN_WIDTH_RANGE, CONTENT_MAX_WIDTH_RANGE, CONTENT_PADDING_RANGE, DEFAULT_LIBRARY_STYLE,
  resolveLibraryStyle, type LibraryStyleSettings,
} from "@scripta/shared";
import { Button, FormScroll, Segmented } from "../../../ui";
import { Text } from "../../../ui/Text";
import { radii, spacing, typography, useTheme } from "../../../ui/theme";
import { useDebouncedCallback } from "../lib/debounce";
import { BookCard } from "./BookCard";
import { BookWrapGrid } from "./BookWrapGrid";
import { useLibraryGridColumns } from "./LibraryGrid";
import { PerCardStyleFields } from "./PerCardStyleFields";
import { Caption, ColorSwatchRow, Section, StepperRow } from "./StyleControls";

const PREVIEW_BOOKS: Array<Record<string, unknown>> = [
  { ContentID: "preview-1", Title: "The Secret Garden", Attribution: "Frances Hodgson Burnett", ReadStatus: 1, highlights: [] },
  { ContentID: "preview-2", Title: "A Room of One's Own", Attribution: "Virginia Woolf", ReadStatus: 2, highlights: [] },
  { ContentID: "preview-3", Title: "The Odyssey", Attribution: "Homer", ReadStatus: 0, highlights: [] },
  { ContentID: "preview-4", Title: "Persuasion", Attribution: "Jane Austen", ReadStatus: 0, highlights: [] },
];
const TABS = [{ value: "cards", label: "Cards" }, { value: "layout", label: "Layout" }, { value: "canvas", label: "Canvas" }] as const;

export function CardStylePreview({ books, style, layout = false }: { books: Array<Record<string, unknown>>; style: LibraryStyleSettings; layout?: boolean }) {
  const { colors } = useTheme();
  const { contentWidth } = useLibraryGridColumns(style);
  const [gridHeight, setGridHeight] = useState(160);
  const [keyboardShown, setKeyboardShown] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", () => setKeyboardShown(true));
    const hide = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () => setKeyboardShown(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  if (keyboardShown) return null;
  const shown = (books.length ? books : PREVIEW_BOOKS).slice(0, layout ? 4 : 2);
  const gridWidth = contentWidth + style.contentPaddingX * 2;
  const scale = Math.min(1, 160 / Math.max(1, gridHeight));
  return (
    <View style={{ gap: spacing.sm }}>
      <Caption>{`${layout ? "Grid" : "Card"} preview${books.length ? "" : " · sample books"}`}</Caption>
      {layout ? <View style={{ alignSelf: "center", width: gridWidth * scale, height: gridHeight * scale }}>
        <View onLayout={(event) => setGridHeight(event.nativeEvent.layout.height)} style={{ position: "absolute", width: gridWidth, backgroundColor: style.backgroundColor ?? colors.background, paddingHorizontal: style.contentPaddingX, paddingVertical: style.contentPaddingY, transform: [{ scale }], transformOrigin: "top left" }}>
          <BookWrapGrid books={shown} style={style} renderBook={(book) => <BookCard book={book} style={style} onPress={() => {}} />} />
        </View>
      </View> : <View style={[styles.preview, { backgroundColor: style.backgroundColor ?? colors.background }]}>
        {shown.map((book, index) => <View key={String(book.ContentID ?? index)} style={{ width: 96 }}><BookCard book={book} style={style} onPress={() => {}} /></View>)}
      </View>}
    </View>
  );
}

export function LibraryStyleView({ savedStyle, previewBooks, onSave }: {
  savedStyle: LibraryStyleSettings | undefined;
  previewBooks: Array<Record<string, unknown>>;
  onSave: (style: LibraryStyleSettings) => void;
}) {
  const { colors } = useTheme();
  const [tab, setTab] = useState<(typeof TABS)[number]["value"]>("cards");
  const [draft, setDraft] = useState<LibraryStyleSettings>(() => resolveLibraryStyle(savedStyle));
  const syncedRef = useRef(false);
  const debounced = useDebouncedCallback((next: LibraryStyleSettings) => onSave(next), 400);
  useEffect(() => {
    if (!syncedRef.current && savedStyle !== undefined) {
      setDraft(resolveLibraryStyle(savedStyle));
      syncedRef.current = true;
    }
  }, [savedStyle]);

  function applyDraft(next: LibraryStyleSettings) {
    setDraft(next);
    debounced.schedule(next);
  }
  function saveNow(next: LibraryStyleSettings) {
    setDraft(next);
    debounced.cancel();
    onSave(next);
  }

  return (
    <View style={styles.screen}>
      <Text style={[typography.caption, { color: colors.textDim }]}>Applies to Library, Series and Collections. Book and series styles take priority.</Text>
      <Segmented options={TABS} value={tab} onChange={setTab} accessibilityLabel="Library style settings" />
      <CardStylePreview books={previewBooks} style={draft} layout={tab === "layout"} />
      <FormScroll key={tab} contentContainerStyle={styles.content}>
        {tab === "cards" ? <PerCardStyleFields draft={draft} canvasColor={draft.backgroundColor ?? colors.background} onApply={(patch) => applyDraft({ ...draft, ...patch })} onSaveNow={(patch) => saveNow({ ...draft, ...patch })} /> : null}
        {tab === "layout" ? <>
          <Section title="Layout">
            <StepperRow label="Card size" value={draft.cardMinWidth} range={CARD_MIN_WIDTH_RANGE} onChange={(cardMinWidth) => applyDraft({ ...draft, cardMinWidth })} />
            <StepperRow label="Between cards" value={draft.cardGap} range={CARD_GAP_RANGE} onChange={(cardGap) => applyDraft({ ...draft, cardGap })} />
            <StepperRow label="Between rows" value={draft.rowGap} range={CARD_GAP_RANGE} onChange={(rowGap) => applyDraft({ ...draft, rowGap })} />
          </Section>
        </> : null}
        {tab === "canvas" ? <Section title="Canvas">
          <ColorSwatchRow label="Background" value={draft.backgroundColor} defaultColor={colors.background} onChange={(backgroundColor) => saveNow({ ...draft, backgroundColor })} />
          <StepperRow label="Side padding" value={draft.contentPaddingX} range={CONTENT_PADDING_RANGE} onChange={(contentPaddingX) => applyDraft({ ...draft, contentPaddingX })} />
          <StepperRow label="Top & bottom padding" value={draft.contentPaddingY} range={CONTENT_PADDING_RANGE} onChange={(contentPaddingY) => applyDraft({ ...draft, contentPaddingY })} />
          <StepperRow label="Content width" value={draft.contentMaxWidth} range={CONTENT_MAX_WIDTH_RANGE} onChange={(contentMaxWidth) => applyDraft({ ...draft, contentMaxWidth })} />
          <Caption>Content width applies on wider screens.</Caption>
        </Section> : null}
        <Button label="Reset library style" variant="secondary" onPress={() => saveNow(DEFAULT_LIBRARY_STYLE)} />
      </FormScroll>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: spacing.lg, gap: spacing.md },
  content: { gap: spacing.xl, paddingBottom: spacing.huge },
  preview: { flexDirection: "row", justifyContent: "center", gap: spacing.md, padding: spacing.sm, borderRadius: radii.lg },
});
