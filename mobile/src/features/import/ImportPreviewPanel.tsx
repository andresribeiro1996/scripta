import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button, ErrorState, Skeleton } from "../../ui/components";
import { spacing, typography, useTheme } from "../../ui/theme";
import { uploadImportPreview } from "./api";
import type { ImportFilePicker, ImportPreview } from "./types";

export function ImportPreviewPanel({ pickFile }: { pickFile: ImportFilePicker }) {
  const { colors } = useTheme();
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function chooseFile() {
    setError(null);
    setLoading(true);
    try {
      const file = await pickFile();
      if (!file) return;
      setPreview(await uploadImportPreview(file));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't preview that import.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Button label="Choose library file" loading={loading} onPress={() => void chooseFile()} />
      {loading ? <><Skeleton height={18} /><Skeleton height={18} width="70%" /></> : null}
      {error ? <ErrorState title="Couldn't preview import" body={error} actionLabel="Try again" onAction={() => void chooseFile()} /> : null}
      {preview ? (
        <View style={[styles.preview, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Text style={[typography.title, { color: colors.text }]}>Ready to import</Text>
          <Text style={[typography.body, { color: colors.textDim }]}>{preview.data.books.length} books found</Text>
          {preview.warnings.map((warning) => <Text key={warning} style={[typography.caption, { color: colors.danger }]}>{warning}</Text>)}
          {preview.data.books.slice(0, 3).map((book, index) => (
            <Text key={`${String(book.ContentID ?? book.Title ?? "book")}-${index}`} numberOfLines={1} style={[typography.body, { color: colors.text }]}>
              {String(book.Title ?? "Untitled")}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.md },
  preview: { borderWidth: 1, borderRadius: 12, padding: spacing.lg, gap: spacing.sm }
});
