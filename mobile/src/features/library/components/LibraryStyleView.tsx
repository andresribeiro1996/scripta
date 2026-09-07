// Mirrors frontend's pages/LibraryStylePage.tsx — full library-wide style
// editor (layout, appearance, border, content, text, canvas) plus a live
// preview. Rendered as an in-tab view (LibraryScreen.tsx's own `view`
// state), not a separate Expo Router route — see this task's handoff
// notes for why (avoiding edits to (app)/_layout.tsx's central Tabs,
// which this task doesn't own).

import { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import {
  CARD_GAP_RANGE,
  CARD_MIN_WIDTH_RANGE,
  CONTENT_MAX_WIDTH_RANGE,
  CONTENT_PADDING_RANGE,
  DEFAULT_LIBRARY_STYLE,
  resolveLibraryStyle,
  type LibraryStyleSettings,
  type PerCardStyle,
} from "@scripta/shared";
import { Button } from "../../../ui/components";
import { spacing, typography, useTheme } from "../../../ui/theme";
import { useDebouncedCallback } from "../lib/debounce";
import { BookCard } from "./BookCard";
import { PerCardStyleFields } from "./PerCardStyleFields";
import { ColorSwatchRow, Section, StepperRow } from "./StyleControls";

const SAMPLE_COVER = "https://covers.openlibrary.org/b/id/240727-M.jpg";

const PREVIEW_BOOKS: Array<Record<string, unknown>> = [
  { ContentID: "preview-1", Title: "Sample Book One", Attribution: "A. Author", ReadStatus: 1, ___PercentRead: 55, highlights: [], _coverUrl: SAMPLE_COVER },
  { ContentID: "preview-2", Title: "Sample Book Two", Attribution: "B. Author", ReadStatus: 2, ___PercentRead: 100, highlights: [{ BookmarkID: "p1" }], _coverUrl: SAMPLE_COVER },
  { ContentID: "preview-3", Title: "Sample Book Three (no cover)", Attribution: "C. Author", ReadStatus: 0, ___PercentRead: 0, highlights: [] },
  { ContentID: "preview-4", Title: "Sample Book Four (no cover)", Attribution: "D. Author", ReadStatus: 1, ___PercentRead: 20, highlights: [] },
];

export function LibraryStyleView({
  savedStyle,
  previewBooks,
  onSave,
}: {
  savedStyle: LibraryStyleSettings | undefined;
  /** The first few of the account's own books, for a truer preview — the
   *  web version does the same, falling back to placeholders only for an
   *  empty library. */
  previewBooks: Array<Record<string, unknown>>;
  onSave: (style: LibraryStyleSettings) => void;
}) {
  const { colors } = useTheme();
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

  const shownPreview = previewBooks.length > 0 ? previewBooks.slice(0, 4) : PREVIEW_BOOKS;

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={[typography.heading, { color: colors.text }]}>Library style</Text>
      <Text style={[typography.body, { color: colors.textDim, marginTop: spacing.xs, marginBottom: spacing.lg }]}>
        Applies across Library, Series, and Collections. A series can override its own card appearance from its own
        style settings, taking priority over these for that series' cards.
      </Text>

      <Section title="Card layout">
        <StepperRow label="Card size" value={draft.cardMinWidth} range={CARD_MIN_WIDTH_RANGE} onChange={(v) => applyDraft({ ...draft, cardMinWidth: v })} />
        <StepperRow label="Spacing between cards" value={draft.cardGap} range={CARD_GAP_RANGE} onChange={(v) => applyDraft({ ...draft, cardGap: v })} />
        <StepperRow label="Spacing between rows" value={draft.rowGap} range={CARD_GAP_RANGE} onChange={(v) => applyDraft({ ...draft, rowGap: v })} />
      </Section>

      <View style={{ height: spacing.md }} />

      <PerCardStyleFields
        draft={draft}
        onApply={(patch) => applyDraft({ ...draft, ...patch })}
        onSaveNow={(patch) => saveNow({ ...draft, ...patch })}
        themeBorderColor={colors.border}
      />

      <View style={{ height: spacing.md }} />

      <Section title="Library canvas">
        <ColorSwatchRow
          label="Custom background color"
          value={draft.backgroundColor}
          defaultColor={colors.background}
          onEnable={() => saveNow({ ...draft, backgroundColor: colors.background })}
          onChange={(color) => applyDraft({ ...draft, backgroundColor: color })}
          onDisable={() => saveNow({ ...draft, backgroundColor: null })}
        />
        <StepperRow
          label="Content width"
          value={draft.contentMaxWidth}
          range={CONTENT_MAX_WIDTH_RANGE}
          onChange={(v) => applyDraft({ ...draft, contentMaxWidth: v })}
        />
        <StepperRow
          label="Padding around books (sides)"
          value={draft.contentPaddingX}
          range={CONTENT_PADDING_RANGE}
          onChange={(v) => applyDraft({ ...draft, contentPaddingX: v })}
        />
        <StepperRow
          label="Padding around books (top/bottom)"
          value={draft.contentPaddingY}
          range={CONTENT_PADDING_RANGE}
          onChange={(v) => applyDraft({ ...draft, contentPaddingY: v })}
        />
      </Section>

      <View style={{ height: spacing.lg }} />
      <Button label="Reset all to defaults" variant="secondary" onPress={() => saveNow(DEFAULT_LIBRARY_STYLE)} />

      <Text style={[typography.title, { color: colors.textDim, marginTop: spacing.xl, marginBottom: spacing.sm }]}>
        Preview{previewBooks.length === 0 ? " (sample books — your library is empty)" : ""}
      </Text>
      {/* A plain wrapped row, not LibraryGrid's FlatList — only ever 4
          items, and nesting a virtualized list inside this screen's own
          ScrollView would trip RN's "VirtualizedLists should never be
          nested inside plain ScrollViews with the same orientation"
          warning for no benefit at this size. */}
      <View
        style={[
          styles.previewFrame,
          { borderColor: colors.border, backgroundColor: draft.backgroundColor ?? undefined, gap: draft.rowGap, padding: draft.contentPaddingX },
        ]}
      >
        {shownPreview.map((book, i) => (
          <View key={String(book.ContentID ?? i)} style={{ width: `${100 / Math.min(shownPreview.length, 2) - 4}%` }}>
            <BookCard book={book} onPress={() => {}} style={draft} />
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.huge },
  previewFrame: { flexDirection: "row", flexWrap: "wrap", borderWidth: 1, borderStyle: "dashed", borderRadius: 12, overflow: "hidden" },
});
