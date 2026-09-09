// The unified "Import library" / "Sync Goodreads" entry point — mirrors
// frontend's fileImport.ts dispatch (sniff, then route) at the FILE-TYPE
// level rather than the byte level: a `.json` picks the on-device path
// (lib/localImport.ts — it's already LibraryData, no server round trip,
// per this task's brief), everything else (KoboReader.sqlite, Goodreads
// CSV, StoryGraph CSV) goes through Task 4B's
// POST /library/import/preview (features/import/api.ts's
// uploadImportPreview, consumed as-is — not modified, per this task's
// handoff note about that skeleton). Either path ends at the same
// preview-then-confirm step, then the caller's onMerge runs the normal
// merge/order/series-seed pipeline (lib/mergeAndSave.ts) and one save.
//
// Also backs "Sync Goodreads" (frontend's SyncGoodreadsModal) — same
// flow, this app has no separate modal for it, just different opening
// copy from LibraryScreen's action menu.

import { useState } from "react";
import { File } from "expo-file-system";
import { ScrollView, Text, View } from "react-native";
import type { LibraryData } from "@scripta/shared";
import { Button, ErrorState, Skeleton } from "../../../ui/components";
import { spacing, typography, useTheme } from "../../../ui/theme";
import { uploadImportPreview } from "../../import/api";
import { parseLibraryJson } from "../lib/localImport";

export function ImportForm({
  title = "Import library",
  onMerge,
  onClose,
}: {
  title?: string;
  /** Runs the merge/save pipeline; rejects on failure so this sheet can
   *  show it and stay open. */
  onMerge: (data: LibraryData) => Promise<void>;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [preview, setPreview] = useState<LibraryData | null>(null);
  const [merging, setMerging] = useState(false);

  async function handleChoose() {
    setError(null);
    setWarnings([]);
    setPreview(null);
    const result = await File.pickFileAsync({ mimeTypes: "*/*" });
    if (result.canceled) return;
    const file = result.result;
    setBusy(true);
    try {
      if (file.name.toLowerCase().endsWith(".json")) {
        setPreview(parseLibraryJson(await file.text()));
      } else {
        const uploaded = await uploadImportPreview(file);
        setPreview(uploaded.data);
        setWarnings(uploaded.warnings);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't read that file.");
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm() {
    if (!preview) return;
    setMerging(true);
    setError(null);
    try {
      await onMerge(preview);
      setPreview(null);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the imported library.");
    } finally {
      setMerging(false);
    }
  }

  return (
    <>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xl }}>
        <Text style={[typography.body, { color: colors.textDim }]}>
          A <Text style={{ fontWeight: "700" }}>library.json</Text> from the exporter CLI, a{" "}
          <Text style={{ fontWeight: "700" }}>KoboReader.sqlite</Text> straight off your device, a Goodreads library CSV
          export, or a StoryGraph library CSV export. Matching books are merged with what's already here, not
          duplicated.
        </Text>
        <Button label={busy ? "Reading…" : "Choose a file…"} loading={busy} disabled={merging} onPress={() => void handleChoose()} />
        {busy && (
          <View style={{ gap: spacing.sm }}>
            <Skeleton height={18} />
            <Skeleton height={18} width="70%" />
          </View>
        )}
        {error && <ErrorState body={error} actionLabel="Choose another file" onAction={() => void handleChoose()} />}
        {warnings.map((w) => (
          <Text key={w} style={[typography.caption, { color: colors.danger }]}>
            {w}
          </Text>
        ))}
        {preview && (
          <View style={{ gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: spacing.lg }}>
            <Text style={[typography.title, { color: colors.text, fontWeight: "700" }]}>Ready to import</Text>
            <Text style={[typography.body, { color: colors.textDim }]}>{preview.books.length} book{preview.books.length === 1 ? "" : "s"} found</Text>
            {preview.books.slice(0, 5).map((book, i) => (
              <Text key={i} numberOfLines={1} style={[typography.body, { color: colors.text }]}>
                {String(book.Title ?? "Untitled")}
              </Text>
            ))}
            <Button label={merging ? "Importing…" : "Merge into my library"} loading={merging} onPress={() => void handleConfirm()} />
          </View>
        )}
      </ScrollView>
    </>
  );
}
