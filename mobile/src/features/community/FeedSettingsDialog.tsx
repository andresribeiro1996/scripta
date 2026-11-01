import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "../../ui/Text";
import { DEFAULT_FEED_SETTINGS, type FeedCategory, type FeedSettings } from "@scripta/shared/community";
import { Button, Dialog, Toast, ToggleSwitch, minimumTouchTarget, spacing, typography, useTheme } from "../../ui";
import { updateFeedSettings } from "./api";
import { useT, type MobileMessages } from "../../i18n";

type MessageKey = Extract<keyof MobileMessages, string>;

const FEED_SETTING_ROWS: Array<{ key: FeedCategory; labelKey: MessageKey; captionKey: MessageKey }> = [
  { key: "publications", labelKey: "community.feedPublications", captionKey: "community.feedPublicationsCaption" },
  { key: "reading", labelKey: "community.feedReading", captionKey: "community.feedReadingCaption" },
  { key: "votes", labelKey: "community.feedVotes", captionKey: "community.feedVotesCaption" },
  { key: "follows", labelKey: "community.feedFollows", captionKey: "community.feedFollowsCaption" },
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
  const t = useT();
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
      setError(reason instanceof Error ? reason.message : t("community.feedSettingsSaveFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog visible={visible} title={t("community.feedSettings")} onClose={onClose}>
      <View style={styles.gap}>
        <Text style={[typography.caption, { color: colors.textDim }]}>{t("community.feedSettingsIntro")}</Text>
        {FEED_SETTING_ROWS.map(({ key, labelKey, captionKey }) => (
          <SettingRow
            key={key}
            label={t(labelKey)}
            caption={t(captionKey)}
            value={local[key]}
            onValueChange={() => setLocal((current) => ({ ...current, [key]: !current[key] }))}
          />
        ))}
        {error ? <Toast visible message={error} tone="error" /> : null}
        <Button label={t("shell.save")} loading={busy} onPress={() => void save()} />
      </View>
    </Dialog>
  );
}

const styles = StyleSheet.create({
  gap: { gap: spacing.md },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: minimumTouchTarget },
  grow: { flex: 1 },
});
