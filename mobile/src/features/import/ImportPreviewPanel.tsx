import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "../../ui/Text";
import { Button, ErrorState, Skeleton } from "../../ui/components";
import { spacing, typography, useTheme } from "../../ui/theme";
import { useT } from "../../i18n";
import { uploadImportPreview } from "./api";
import type { ImportFilePicker, ImportPreview } from "./types";

export function ImportPreviewPanel({ pickFile }: { pickFile: ImportFilePicker }) {
  const { colors } = useTheme();
  const t = useT();
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
      setError(cause instanceof Error ? cause.message : t("addBook.importFailed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Button label={t("addBook.importChooseFile")} loading={loading} onPress={() => void chooseFile()} />
      {loading ? <><Skeleton height={18} /><Skeleton height={18} width="70%" /></> : null}
      {error ? <ErrorState title={t("addBook.importFailedTitle")} body={error} actionLabel={t("shell.tryAgain")} onAction={() => void chooseFile()} /> : null}
      {preview ? (
        <View style={[styles.preview, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Text style={[typography.title, { color: colors.text }]}>{t("library.readyToImport")}</Text>
          <Text style={[typography.body, { color: colors.textDim }]}>{t("addBook.importBooksFound", { count: preview.data.books.length })}</Text>
          {preview.warnings.map((warning) => <Text key={warning} style={[typography.caption, { color: colors.danger }]}>{warning}</Text>)}
          {preview.data.books.slice(0, 3).map((book, index) => (
            <Text key={`${String(book.ContentID ?? book.Title ?? "book")}-${index}`} numberOfLines={1} style={[typography.body, { color: colors.text }]}>
              {String(book.Title ?? t("library.untitled"))}
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
