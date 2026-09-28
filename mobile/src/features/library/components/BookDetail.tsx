// Mirrors frontend's components/BookDetailSheet.tsx — cover, title/
// author/status, the Style/Cover actions, the status control, and the
// highlight list.

import { Alert, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "../../../ui/Text";
import { statusLabel, type FinishRating, type ReadStatus } from "@scripta/shared";
import { Button, Segmented } from "../../../ui/components";
import { spacing, typography, useTheme } from "../../../ui/theme";
import { CoverImage } from "./CoverImage";
import { FeelingChips } from "./FeelingChips";

function confirmDeleteNote(onConfirm: () => void) {
  Alert.alert("Delete this note?", "This can't be undone.", [
    { text: "Cancel", style: "cancel" },
    { text: "Delete", style: "destructive", onPress: onConfirm },
  ]);
}

const STATUS_OPTIONS = [
  { value: "0", label: statusLabel(0) },
  { value: "1", label: statusLabel(1) },
  { value: "2", label: statusLabel(2) },
] as const;
type StatusValue = (typeof STATUS_OPTIONS)[number]["value"];

export function BookDetail({
  book,
  onOpenStyle,
  onOpenCoverPicker,
  onSetStatus,
  onSetRating,
  onDeleteNote,
  onClose,
}: {
  book: Record<string, unknown> | null;
  onOpenStyle: (book: Record<string, unknown>) => void;
  onOpenCoverPicker: (book: Record<string, unknown>) => void;
  onSetStatus: (book: Record<string, unknown>, status: ReadStatus) => void | Promise<void>;
  onSetRating: (book: Record<string, unknown>, rating: FinishRating) => void;
  onDeleteNote: (book: Record<string, unknown>, bookmarkId: string) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  if (!book) return null;

  const highlights = Array.isArray(book.highlights)
    ? (book.highlights as Array<Record<string, unknown>>).filter((h) => String(h.Text ?? "").trim() !== "")
    : [];
  const percent = typeof book.___PercentRead === "number" ? Math.round(book.___PercentRead) : null;

  return (
    <>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.xl }}>
        <View style={styles.header}>
          <View style={[styles.cover, { backgroundColor: colors.border }]}>
            <CoverImage book={book} size="full" />
          </View>
          <View style={styles.headerText}>
            <Text style={[typography.heading, { color: colors.text }]} numberOfLines={2}>
              {String(book.Title ?? "Untitled")}
            </Text>
            <Text style={[typography.body, { color: colors.textDim, marginTop: 2 }]}>{String(book.Attribution ?? "Unknown author")}</Text>
            <Text style={[typography.body, { color: colors.accent, marginTop: spacing.sm, fontWeight: "600" }]}>
              {statusLabel(book.ReadStatus)}
              {percent !== null && percent > 0 ? ` · ${percent}% read` : ""}
            </Text>
          </View>
        </View>

        <Segmented
          accessibilityLabel="Reading status"
          options={STATUS_OPTIONS}
          value={String(book.ReadStatus === 1 || book.ReadStatus === 2 ? book.ReadStatus : 0) as StatusValue}
          onChange={(value) => onSetStatus(book, Number(value) as ReadStatus)}
        />

        {book.ReadStatus === 2 ? (
          <View style={{ gap: spacing.sm }}>
            <Text style={[typography.title, { color: colors.text }]}>How it landed</Text>
            <FeelingChips value={typeof book.Rating === "number" ? book.Rating : null} onChange={(rating) => onSetRating(book, rating)} />
          </View>
        ) : null}

        <View style={styles.actions}>
          <Button label="Style" variant="secondary" onPress={() => onOpenStyle(book)} />
          <Button label="Cover" variant="secondary" onPress={() => onOpenCoverPicker(book)} />
        </View>

        <View>
          <Text style={[typography.title, { color: colors.text, fontWeight: "700", marginBottom: spacing.sm }]}>
            Highlights{highlights.length > 0 ? ` (${highlights.length})` : ""}
          </Text>
          {highlights.length === 0 && <Text style={[typography.body, { color: colors.textDim }]}>No highlights yet.</Text>}
          <View style={{ gap: spacing.md }}>
            {highlights.map((h, i) => {
              const bookmarkId = String(h.BookmarkID ?? "");
              const isNote = bookmarkId.startsWith("note:");
              return (
                <View key={bookmarkId || i} style={[styles.highlight, { borderColor: colors.border }]}>
                  <Text style={[typography.body, { color: colors.text, fontStyle: "italic" }]}>{String(h.Text)}</Text>
                  {String(h.Annotation ?? "").trim() !== "" && (
                    <Text style={[typography.caption, { color: colors.textDim, marginTop: spacing.xs }]}>{String(h.Annotation)}</Text>
                  )}
                  {isNote && (
                    <Text
                      accessibilityRole="button"
                      onPress={() => confirmDeleteNote(() => onDeleteNote(book, bookmarkId))}
                      style={[typography.caption, { color: colors.danger, fontWeight: "700", marginTop: spacing.xs }]}
                    >
                      Delete
                    </Text>
                  )}
                </View>
              );
            })}
          </View>
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", gap: spacing.lg },
  cover: { width: 96, aspectRatio: 2 / 3, borderRadius: 8, overflow: "hidden" },
  headerText: { flex: 1, justifyContent: "center" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  highlight: { borderLeftWidth: 2, paddingLeft: spacing.md },
});
