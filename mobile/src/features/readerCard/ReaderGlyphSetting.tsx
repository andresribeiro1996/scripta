import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ownGlyphPreview, readerIdentity, saveFailureMessage, type Group } from "@scripta/shared";
import { DEFAULT_FEED_SETTINGS, type OwnProfile } from "@scripta/shared/community";
import { Toast, ToggleSwitch, minimumTouchTarget, spacing, typography, useTheme } from "../../ui";
import { Text } from "../../ui/Text";
import { fetchOwnProfile, updateFeedSettings } from "../community/api";
import { ReaderGlyph } from "../community/ReaderGlyph";

const OWN_PROFILE_KEY = ["community", "own-profile"] as const;
const LABEL = "Show my reader glyph next to my name";

export function ReaderGlyphSetting({ username, books, groups }: { username: string; books: Array<Record<string, unknown>>; groups: Group[] }) {
  const { colors } = useTheme();
  const client = useQueryClient();
  const { data: profile } = useQuery({ queryKey: OWN_PROFILE_KEY, queryFn: fetchOwnProfile });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = useMemo(() => ownGlyphPreview(readerIdentity(books, groups)), [books, groups]);
  const settings = profile?.feedSettings ?? DEFAULT_FEED_SETTINGS;
  const on = settings.readerGlyph ?? false;

  const toggle = async () => {
    if (!profile) return;
    setBusy(true);
    setError(null);
    client.setQueryData<OwnProfile>(OWN_PROFILE_KEY, { ...profile, feedSettings: { ...settings, readerGlyph: !on } });
    try {
      await updateFeedSettings({ ...settings, readerGlyph: !on });
      void client.invalidateQueries({ queryKey: ["community", "profile", username] });
    } catch (reason) {
      client.setQueryData<OwnProfile>(OWN_PROFILE_KEY, profile);
      setError(saveFailureMessage(reason, "Couldn't save the glyph setting."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.gap}>
      <View style={styles.row}>
        <Text style={[typography.body, styles.grow, { color: colors.text }]}>{LABEL}</Text>
        <ToggleSwitch accessibilityLabel={LABEL} value={on} disabled={!profile || busy} onValueChange={() => void toggle()} />
      </View>
      <View accessible accessibilityLabel={preview.line} style={styles.preview}>
        <ReaderGlyph identity={preview.glyph ?? undefined} />
        <Text style={[typography.caption, styles.grow, { color: colors.textDim }]}>{preview.line}</Text>
      </View>
      {profile && !profile.published ? <Text style={[typography.caption, { color: colors.textDim }]}>It shows once your shelf is published.</Text> : null}
      {error ? <Toast visible message={error} tone="error" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: minimumTouchTarget },
  preview: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  grow: { flex: 1 },
});
