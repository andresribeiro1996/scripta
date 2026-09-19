import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { DEFAULT_FEED_SETTINGS, type FeedCategory, type FeedSettings } from "@scripta/shared/community";
import { Button, Dialog, Toast, spacing } from "../../ui";
import { updateFeedSettings } from "./api";

const FEED_SETTING_ROWS: Array<{ key: FeedCategory; label: string }> = [
  { key: "publications", label: "Publications" },
  { key: "reading", label: "Reading activity" },
  { key: "votes", label: "Votes" },
  { key: "follows", label: "Follows" },
];

export function FeedSettingsDialog({ visible, settings, onClose }: { visible: boolean; settings: FeedSettings; onClose: () => void }) {
  const [local, setLocal] = useState<FeedSettings>(DEFAULT_FEED_SETTINGS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

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
        {error ? <Toast visible message="Could not save settings." tone="error" /> : null}
        <Button label="Save" loading={busy} onPress={() => void save()} />
      </View>
    </Dialog>
  );
}

const styles = StyleSheet.create({
  gap: { gap: spacing.md },
});
