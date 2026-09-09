// Mirrors frontend's components/BookDetailSheet.tsx — cover, title/
// author/status, the Style/Cover/mark-as-read actions, and the highlight
// list.

import { ScrollView, StyleSheet, Text, View } from "react-native";
import { nextReadStatus, statusLabel } from "@scripta/shared";
import { Button, Sheet } from "../../../ui/components";
import { spacing, typography, useTheme } from "../../../ui/theme";
import { CoverImage } from "./CoverImage";

export function BookDetailSheet({
  book,
  onOpenStyle,
  onOpenCoverPicker,
  onSetStatus,
  onClose,
}: {
  book: Record<string, unknown> | null;
  onOpenStyle: (book: Record<string, unknown>) => void;
  onOpenCoverPicker: (book: Record<string, unknown>) => void;
  onSetStatus: (book: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  if (!book) return null;

  const highlights = Array.isArray(book.highlights)
    ? (book.highlights as Array<Record<string, unknown>>).filter((h) => String(h.Text ?? "").trim() !== "")
    : [];
  const percent = typeof book.___PercentRead === "number" ? Math.round(book.___PercentRead) : null;

  return (
    <Sheet visible title="Book details" onClose={onClose}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.xl }}>
        <View style={styles.header}>
          <View style={[styles.cover, { backgroundColor: colors.border }]}>
            <CoverImage book={book} />
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

        <View style={styles.actions}>
          <Button label="Style" variant="secondary" onPress={() => onOpenStyle(book)} />
          <Button label="Cover" variant="secondary" onPress={() => onOpenCoverPicker(book)} />
          <Button label={`Mark as ${statusLabel(nextReadStatus(book.ReadStatus))}`} variant="secondary" onPress={() => onSetStatus(book)} />
        </View>

        <View>
          <Text style={[typography.title, { color: colors.text, fontWeight: "700", marginBottom: spacing.sm }]}>
            Highlights{highlights.length > 0 ? ` (${highlights.length})` : ""}
          </Text>
          {highlights.length === 0 && <Text style={[typography.body, { color: colors.textDim }]}>No highlights yet.</Text>}
          <View style={{ gap: spacing.md }}>
            {highlights.map((h, i) => (
              <View key={String(h.BookmarkID ?? i)} style={[styles.highlight, { borderColor: colors.border }]}>
                <Text style={[typography.body, { color: colors.text, fontStyle: "italic" }]}>{String(h.Text)}</Text>
                {String(h.Annotation ?? "").trim() !== "" && (
                  <Text style={[typography.caption, { color: colors.textDim, marginTop: spacing.xs }]}>{String(h.Annotation)}</Text>
                )}
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", gap: spacing.lg },
  cover: { width: 96, aspectRatio: 2 / 3, borderRadius: 8, overflow: "hidden" },
  headerText: { flex: 1, justifyContent: "center" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  highlight: { borderLeftWidth: 2, paddingLeft: spacing.md },
});
