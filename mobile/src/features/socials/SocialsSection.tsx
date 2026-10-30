import { useCallback, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "../../ui/Text";
import { FontAwesome6 } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { Button, ConfirmDialog, Input, Sheet, ToggleSwitch } from "../../ui";
import { minimumTouchTarget, spacing, typography, useTheme } from "../../ui/theme";
import { startSocialConnect, type SocialProvider, type SocialStatus } from "./api";
import { PROVIDER_MARKS } from "./providerMark";
import { useSocials } from "./useSocials";

const LABELS: Record<SocialProvider, string> = { x: "X", instagram: "Instagram", threads: "Threads", tiktok: "TikTok", bluesky: "Bluesky" };

export function SocialsSection() {
  const { colors } = useTheme();
  const { data = [], isPending, refetch, connectBluesky, disconnect } = useSocials();
  const sorted = useMemo(() => [...data].sort((a, b) => Number(b.connected) - Number(a.connected)), [data]);
  const [busy, setBusy] = useState<SocialProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<SocialStatus | null>(null);
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
    setDisconnecting(null);
    setBusy(status.provider);
    disconnect(status.provider).catch((reason) => setError(reason instanceof Error ? reason.message : "Couldn't disconnect that account.")).finally(() => setBusy(null));
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
    <View style={styles.section}>
      <Text style={[typography.caption, { color: colors.textDim }]}>Connect accounts for sharing.</Text>
      {isPending ? <Text style={[typography.body, { color: colors.textDim }]}>Loading…</Text> : sorted.map((status, index) => {
        const mark = PROVIDER_MARKS[status.provider];
        return (
          <View key={status.provider} style={[styles.row, { opacity: status.enabled ? 1 : 0.5, borderBottomColor: colors.border, borderBottomWidth: index < sorted.length - 1 ? StyleSheet.hairlineWidth : 0 }]}>
            <View style={styles.logo}>
              <FontAwesome6 name={mark.glyph as never} brand size={22} color={mark.color ?? colors.text} />
            </View>
            <View style={styles.grow}>
              <Text style={[typography.body, { color: colors.text, fontWeight: "600" }]}>{LABELS[status.provider]}</Text>
              <Text style={[typography.caption, { color: status.enabled && status.connected ? colors.accent : colors.textDim }]}>{!status.enabled ? "Not configured on this server" : status.connected ? `Connected${status.handle ? ` as ${status.handle}` : ""}` : "Not connected"}</Text>
            </View>
            <ToggleSwitch
              accessibilityLabel={LABELS[status.provider]}
              value={status.connected}
              disabled={!status.enabled || busy === status.provider}
              onValueChange={() => status.connected ? setDisconnecting(status) : void enable(status.provider)}
            />
          </View>
        );
      })}
      {error ? <Text accessibilityRole="alert" style={[typography.caption, { color: colors.danger }]}>{error}</Text> : null}
      <ConfirmDialog visible={disconnecting !== null} title={`Disconnect ${disconnecting ? LABELS[disconnecting.provider] : ""}?`} body="Atmyshelf will delete the stored access token." confirmLabel="Disconnect" destructive onConfirm={() => disconnecting && confirmDisconnect(disconnecting)} onCancel={() => setDisconnecting(null)} />
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
  section: { gap: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: minimumTouchTarget },
  logo: { width: 28, alignItems: "center" },
  grow: { flex: 1 },
  form: { gap: spacing.md, paddingTop: spacing.sm },
});
