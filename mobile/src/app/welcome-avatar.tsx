import { finishAuthNavigation } from "../features/auth/navigation";
import { useState } from "react";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { Redirect, router } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Text } from "../ui/Text";
import { useAuth } from "../core/auth";
import { API_URL } from "../core/config";
import { Button } from "../ui";
import { radii, spacing, typography, useTheme } from "../ui/theme";
import { useT } from "../i18n";

export default function WelcomeAvatarRoute() {
  const t = useT();
  const { colors } = useTheme();
  const { ready, user, uploadAvatar } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!ready) return <View style={styles.center}><ActivityIndicator size="large" /></View>;
  if (!user) return <Redirect href="/login" />;

  async function choosePhoto() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError(t("shell.photoAccessOffAdd"));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 0.9 });
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return;
    setBusy(true);
    setError(null);
    try {
      await uploadAvatar({ uri: asset.uri, name: asset.fileName ?? `avatar-${Date.now()}.jpg`, mimeType: asset.mimeType ?? "image/jpeg" });
    } catch (reason) {
      setError(reason instanceof TypeError ? t("shell.connectFailedShort") : reason instanceof Error ? reason.message : t("shell.uploadFailed"));
    } finally {
      setBusy(false);
    }
  }

  return <View style={[styles.screen, { backgroundColor: colors.background }]}>
    <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>{t("shell.makeItYours")}</Text>
    <Text style={[typography.body, { color: colors.textDim, alignSelf: "stretch", textAlign: "center" }]}>{user.avatarId ? t("shell.avatarHas") : t("shell.avatarNone")}</Text>
    {user.avatarId ? <Image source={{ uri: `${API_URL}/auth/avatar/${user.avatarId}/file` }} style={styles.avatar} /> : <View style={[styles.avatar, styles.initial, { backgroundColor: colors.accentSoft }]}><Text style={[styles.initialText, { color: colors.accent }]}>{(user.username ?? user.email)[0]?.toUpperCase()}</Text></View>}
    {error ? <Text accessibilityRole="alert" style={[typography.caption, { color: colors.danger }]}>{error}</Text> : null}
    {user.avatarId
      ? <View style={styles.actions}><Button label={t("shell.continue")} disabled={busy} onPress={() => router.replace(finishAuthNavigation() as never, { withAnchor: true })} /><Button label={t("shell.chooseDifferentPhoto")} variant="secondary" loading={busy} onPress={() => void choosePhoto()} /></View>
      : <View style={styles.actions}><Button label={t("shell.choosePhoto")} loading={busy} onPress={() => void choosePhoto()} /><Button label={t("shell.skipForNow")} variant="secondary" disabled={busy} onPress={() => router.replace(finishAuthNavigation() as never, { withAnchor: true })} /></View>}
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  actions: { alignSelf: "stretch", gap: spacing.md },
  title: { ...typography.heading, fontWeight: "700" },
  avatar: { width: 96, height: 96, borderRadius: radii.full },
  initial: { alignItems: "center", justifyContent: "center" },
  initialText: { fontSize: 36, fontWeight: "700" },
});
