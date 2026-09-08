import { useState } from "react";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { Redirect, router } from "expo-router";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useAuth } from "../core/auth";
import { API_URL } from "../core/config";
import { Button } from "../ui";
import { radii, spacing, typography, useTheme } from "../ui/theme";

export default function WelcomeAvatarRoute() {
  const { colors } = useTheme();
  const { ready, user, uploadAvatar } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!ready) return <View style={styles.center}><ActivityIndicator size="large" /></View>;
  if (!user) return <Redirect href="/login" />;

  async function choosePhoto() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError("Photo library access is off. Enable it in device Settings to add a picture.");
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
      setError(reason instanceof Error ? reason.message : "Couldn't upload that picture.");
    } finally {
      setBusy(false);
    }
  }

  return <View style={[styles.screen, { backgroundColor: colors.background }]}>
    <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>Make it yours</Text>
    <Text style={[typography.body, { color: colors.textDim }]}>Add a profile picture, or skip this for now.</Text>
    {user.avatarId ? <Image source={{ uri: `${API_URL}/auth/avatar/${user.avatarId}/file` }} style={styles.avatar} /> : <View style={[styles.avatar, styles.initial, { backgroundColor: colors.accentSoft }]}><Text style={[styles.initialText, { color: colors.accent }]}>{(user.username ?? user.email)[0]?.toUpperCase()}</Text></View>}
    {error ? <Text accessibilityRole="alert" style={[typography.caption, { color: colors.danger }]}>{error}</Text> : null}
    <Button label={user.avatarId ? "Choose a different photo" : "Choose a photo"} loading={busy} onPress={() => void choosePhoto()} />
    <Button label={user.avatarId ? "Continue" : "Skip for now"} variant="secondary" disabled={busy} onPress={() => router.replace("/")} />
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  title: { ...typography.heading, fontWeight: "700" },
  avatar: { width: 96, height: 96, borderRadius: radii.full },
  initial: { alignItems: "center", justifyContent: "center" },
  initialText: { fontSize: 36, fontWeight: "700" },
});
