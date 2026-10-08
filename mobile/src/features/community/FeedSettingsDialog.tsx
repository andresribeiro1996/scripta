import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "../../ui/Text";
import { DEFAULT_FEED_SETTINGS, type FeedCategory, type FeedSettings } from "@scripta/shared/community";
import { Button, Dialog, Toast, ToggleSwitch, minimumTouchTarget, spacing, typography, useTheme } from "../../ui";
import { updateFeedSettings } from "./api";

const FEED_SETTING_ROWS: Array<{ key: FeedCategory; label: string; caption: string }> = [
  { key: "publications", label: "Publications", caption: "Murals, tier lists, quizzes and tournaments" },
  { key: "reading", label: "Reading activity", caption: "Books you add or finish" },
  { key: "votes", label: "Votes", caption: "Games you vote in, shown by name" },
  { key: "follows", label: "Follows", caption: "Who you follow" },
];

function SettingRow({ label, caption, value, onValueChange }: { label: string; caption: string; value: boolean; onValueChange: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      <View style={styles.grow}>
        <Text style={[typography.body, { color: colors.text }]}>{label}</Text>
        <Text style={[typography.caption, { color: colors.textDim }]}>{caption}</Text>
      </View>
      <ToggleSwitch accessibilityLabel={label} value={value} onValueChange={onValueChange} />
    </View>
  );
}

export function FeedSettingsDialog({ visible, settings, onClose }: { visible: boolean; settings: FeedSettings; onClose: () => void }) {
  const { colors } = useTheme();
  const [local, setLocal] = useState<FeedSettings>(DEFAULT_FEED_SETTINGS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setLocal(settings);
      setError(null);
    }
  }, [visible, settings]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await updateFeedSettings(local);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save settings.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog visible={visible} title="Feed settings" onClose={onClose}>
      <View style={styles.gap}>
        <Text style={[typography.caption, { color: colors.textDim }]}>What other readers see in your profile activity.</Text>
        {FEED_SETTING_ROWS.map(({ key, label, caption }) => (
          <SettingRow
            key={key}
            label={label}
            caption={caption}
            value={local[key]}
            onValueChange={() => setLocal((current) => ({ ...current, [key]: !current[key] }))}
          />
        ))}
        {error ? <Toast visible message={error} tone="error" /> : null}
        <Button label="Save" loading={busy} onPress={() => void save()} />
      </View>
    </Dialog>
  );
}

const styles = StyleSheet.create({
  gap: { gap: spacing.md },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: minimumTouchTarget },
  grow: { flex: 1 },
});
