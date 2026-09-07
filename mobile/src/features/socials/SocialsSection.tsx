import { useCallback, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { Button, Input, Sheet } from "../../ui";
import { minimumTouchTarget, radii, spacing, typography, useTheme } from "../../ui/theme";
import { startSocialConnect, type SocialProvider, type SocialStatus } from "./api";
import { useSocials } from "./useSocials";

const LABELS: Record<SocialProvider, string> = { x: "X", instagram: "Instagram", threads: "Threads", tiktok: "TikTok", bluesky: "Bluesky" };

export function SocialsSection() {
  const { colors } = useTheme();
  const { data = [], isPending, refetch, connectBluesky, disconnect } = useSocials();
  const [busy, setBusy] = useState<SocialProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blueskyOpen, setBlueskyOpen] = useState(false);
  const [handle, setHandle] = useState("");
  const [appPassword, setAppPassword] = useState("");

  useFocusEffect(useCallback(() => { void refetch(); }, [refetch]));

  async function enable(provider: SocialProvider) {
    setError(null);
    if (provider === "bluesky") {
      setBlueskyOpen(true);
      return;
    }
    setBusy(provider);
    try {
      await startSocialConnect(provider);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't start that connection.");
    } finally {
      setBusy(null);
    }
  }

  function confirmDisconnect(status: SocialStatus) {
    Alert.alert(`Disconnect ${LABELS[status.provider]}?`, "Scripta will delete the stored access token.", [
      { text: "Cancel", style: "cancel" },
      { text: "Disconnect", style: "destructive", onPress: () => {
        setBusy(status.provider);
        disconnect(status.provider).catch((reason) => setError(reason instanceof Error ? reason.message : "Couldn't disconnect that account.")).finally(() => setBusy(null));
      } },
    ]);
  }

  async function submitBluesky() {
    setBusy("bluesky");
    setError(null);
    try {
      await connectBluesky(handle.trim(), appPassword);
      setBlueskyOpen(false);
      setAppPassword("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't connect that Bluesky account.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.heading, { color: colors.text }]}>Socials</Text>
      <Text style={[typography.caption, { color: colors.textDim }]}>Connect accounts for sharing. OAuth connections finish in your browser; return here when complete.</Text>
      {isPending ? <Text style={[typography.body, { color: colors.textDim }]}>Loading…</Text> : data.map((status) => (
        <View key={status.provider} style={[styles.row, { opacity: status.enabled ? 1 : 0.5 }]}>
          <View style={styles.grow}>
            <Text style={[typography.body, { color: colors.text, fontWeight: "600" }]}>{LABELS[status.provider]}</Text>
            <Text style={[typography.caption, { color: colors.textDim }]}>{!status.enabled ? "Not configured on this server" : status.connected ? `Connected${status.handle ? ` as ${status.handle}` : ""}` : "Not connected"}</Text>
          </View>
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: status.connected, disabled: !status.enabled || busy === status.provider }}
            disabled={!status.enabled || busy === status.provider}
            onPress={() => status.connected ? confirmDisconnect(status) : void enable(status.provider)}
            style={[styles.switch, { backgroundColor: status.connected ? colors.accent : colors.border }]}
          >
            <View style={[styles.thumb, { alignSelf: status.connected ? "flex-end" : "flex-start" }]} />
          </Pressable>
        </View>
      ))}
      {error ? <Text accessibilityRole="alert" style={[typography.caption, { color: colors.danger }]}>{error}</Text> : null}
      <Sheet visible={blueskyOpen} title="Connect Bluesky" onClose={() => setBlueskyOpen(false)}>
        <View style={styles.form}>
          <Text style={[typography.caption, { color: colors.textDim }]}>Use an app password from Bluesky Settings, not your account password.</Text>
          <Input label="Handle" value={handle} onChangeText={setHandle} autoCapitalize="none" />
          <Input label="App password" value={appPassword} onChangeText={setAppPassword} secureTextEntry autoCapitalize="none" />
          <Button label="Connect" loading={busy === "bluesky"} disabled={!handle.trim() || !appPassword} onPress={() => void submitBluesky()} />
        </View>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { borderWidth: 1, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.md },
  heading: { ...typography.title, fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: minimumTouchTarget },
  grow: { flex: 1 },
  switch: { width: 48, height: 28, borderRadius: radii.full, padding: 3, justifyContent: "center" },
  thumb: { width: 22, height: 22, borderRadius: radii.full, backgroundColor: "white" },
  form: { gap: spacing.md, paddingTop: spacing.sm },
});
