import { useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { Button, Input } from "../../ui";
import { radii, spacing, typography, useTheme } from "../../ui/theme";
import { useAuth } from "../../core/auth";
import { API_URL } from "../../core/config";
import { SocialsSection } from "../socials";

export function SettingsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { user, setUsername, uploadAvatar, removeAvatar, signOut } = useAuth();
  const [draft, setDraft] = useState(user?.username ?? "");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pickAvatar() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError("Photo library access is off. Enable it in device Settings to change your picture.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 0.9 });
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return;
    await run(() => uploadAvatar({ uri: asset.uri, name: asset.fileName ?? `avatar-${Date.now()}.jpg`, mimeType: asset.mimeType ?? "image/jpeg" }));
  }

  async function run(action: () => Promise<void>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try { await action(); return true; }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Something went wrong."); return false; }
    finally { setBusy(false); }
  }

  function confirmSignOut() {
    Alert.alert("Sign out", "Sign out of Scripta on this device?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: () => void signOut().then(() => router.replace("/(public)/login")) },
    ]);
  }

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.page}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>Settings</Text>
      <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.heading, { color: colors.text }]}>Account</Text>
        <View style={styles.profile}>
          {user?.avatarId ? <Image source={{ uri: `${API_URL}/auth/avatar/${user.avatarId}/file` }} style={styles.avatar} /> : <View style={[styles.avatar, styles.initial, { backgroundColor: colors.accentSoft }]}><Text style={[styles.initialText, { color: colors.accent }]}>{(user?.username ?? user?.email ?? "S")[0]?.toUpperCase()}</Text></View>}
          <View style={styles.grow}>
            <Button label={busy ? "Working…" : "Change picture"} loading={busy} onPress={() => void pickAvatar()} />
            {user?.avatarId ? <Button label="Remove picture" variant="secondary" disabled={busy} onPress={() => void run(removeAvatar)} /> : null}
          </View>
        </View>
        <Text style={[typography.caption, { color: colors.textDim }]}>Email</Text>
        <Text style={[typography.body, { color: colors.text }]}>{user?.email}</Text>
        {editing ? <>
          <Input label="Username" value={draft} onChangeText={setDraft} autoCapitalize="none" autoCorrect={false} />
          <View style={styles.actions}><Button label="Cancel" variant="secondary" onPress={() => setEditing(false)} /><Button label="Save" loading={busy} disabled={draft.trim().length < 3} onPress={() => void run(() => setUsername(draft.trim())).then((saved) => { if (saved) setEditing(false); })} /></View>
        </> : <View style={styles.actions}><Text style={[typography.body, styles.grow, { color: colors.text }]}>@{user?.username}</Text><Button label="Change username" variant="secondary" onPress={() => setEditing(true)} /></View>}
        {error ? <Text accessibilityRole="alert" style={[typography.caption, { color: colors.danger }]}>{error}</Text> : null}
      </View>
      <Button label="Open gallery" variant="secondary" onPress={() => router.push("/gallery")} />
      <SocialsSection />
      <Button label="Sign out" variant="destructive" onPress={confirmSignOut} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.lg, paddingBottom: spacing.huge, gap: spacing.lg },
  title: { ...typography.heading, fontWeight: "700" },
  heading: { ...typography.title, fontWeight: "700" },
  section: { borderWidth: 1, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.md },
  profile: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  avatar: { width: 72, height: 72, borderRadius: radii.full },
  initial: { alignItems: "center", justifyContent: "center" },
  initialText: { fontSize: 28, fontWeight: "700" },
  grow: { flex: 1, gap: spacing.sm },
  actions: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
});
