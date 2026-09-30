import { useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "../../ui/Text";
import { ownGlyphPreview, readerIdentity } from "@scripta/shared";
import { DEFAULT_FEED_SETTINGS, type FeedCategory, type FeedSettings } from "@scripta/shared/community";
import { Button, Dialog, Toast, spacing, typography, useTheme } from "../../ui";
import { useLibrary } from "../library/hooks/useLibrary";
import { ReaderGlyph } from "./ReaderGlyph";
import { updateFeedSettings } from "./api";

const FEED_SETTING_ROWS: Array<{ key: FeedCategory; label: string }> = [
  { key: "publications", label: "Publications" },
  { key: "reading", label: "Reading activity" },
  { key: "votes", label: "Votes" },
  { key: "follows", label: "Follows" },
];

export function FeedSettingsDialog({ visible, settings, onClose }: { visible: boolean; settings: FeedSettings; onClose: () => void }) {
  const { colors } = useTheme();
  const { data: library } = useLibrary();
  const [local, setLocal] = useState<FeedSettings>(DEFAULT_FEED_SETTINGS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const preview = useMemo(
    () => ownGlyphPreview(readerIdentity(library?.data.books ?? [], library?.data.groups ?? [])),
    [library],
  );

  useEffect(() => {
    if (visible) {
      setLocal(settings);
      setError(false);
    }
  }, [visible, settings]);

  async function save() {
    setBusy(true);
    setError(false);
    try {
      await updateFeedSettings(local);
      onClose();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog visible={visible} title="Feed settings" onClose={onClose}>
      <View style={styles.gap}>
        {FEED_SETTING_ROWS.map(({ key, label }) => (
          <Button
            key={key}
            label={`${label}: ${local[key] ? "On" : "Off"}`}
            variant="secondary"
            onPress={() => setLocal((current) => ({ ...current, [key]: !current[key] }))}
          />
        ))}
        <Button
          label={`Show my reader glyph next to my name: ${local.readerGlyph ?? false ? "On" : "Off"}`}
          variant="secondary"
          onPress={() => setLocal((current) => ({ ...current, readerGlyph: !(current.readerGlyph ?? false) }))}
        />
        <View accessible accessibilityLabel={preview.line} style={styles.previewRow}>
          <ReaderGlyph identity={preview.glyph ?? undefined} />
          <Text style={[typography.caption, styles.previewLine, { color: colors.textDim }]}>{preview.line}</Text>
        </View>
        {error ? <Toast visible message="Could not save settings." tone="error" /> : null}
        <Button label="Save" loading={busy} onPress={() => void save()} />
      </View>
    </Dialog>
  );
}

const styles = StyleSheet.create({
  gap: { gap: spacing.md },
  previewRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  previewLine: { flexShrink: 1 },
});
