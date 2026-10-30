import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useQuery } from "@tanstack/react-query";
import { Text } from "../../ui/Text";
import { useAuth } from "../../core/auth";
import { API_URL } from "../../core/config";
import { ActionSheet, Button, Icon, IconButton, Input, dynamicType, minimumTouchTarget, radii, spacing, typography, useTheme } from "../../ui";
import { AuthorAvatar } from "../community/AuthorAvatar";
import { fetchOwnProfile } from "../community/api";

const BADGE = 28;

export function ProfileHeader() {
  const { colors } = useTheme();
  const { user, setUsername, uploadAvatar, removeAvatar } = useAuth();
  const own = useQuery({ queryKey: ["community", "own-profile"], queryFn: fetchOwnProfile });
  const [draft, setDraft] = useState(user?.username ?? "");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const username = user?.username ?? "";
  const avatarUrl = user?.avatarId ? `${API_URL}/auth/avatar/${user.avatarId}/file` : null;
  const status = own.data ? `${own.data.published ? "Published" : "Private"} · ${user?.email}` : user?.email;

  async function run(action: () => Promise<void>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try { await action(); return true; }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Something went wrong."); return false; }
    finally { setBusy(false); }
  }

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

  function cancelEdit() {
    setError(null);
    setDraft(username);
    setEditing(false);
  }

  return (
    <View style={styles.profile}>
      <View>
        <AuthorAvatar username={username} avatarUrl={avatarUrl} size={96} />
        <ActionSheet
          title="Profile picture"
          groups={[[
            { label: "Change picture", icon: "image", onPress: () => void pickAvatar() },
            { label: "Remove picture", icon: "delete", destructive: true, onPress: () => void run(removeAvatar) },
          ]]}
        >
          {(open) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={avatarUrl ? "Edit picture" : "Add picture"}
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              hitSlop={(minimumTouchTarget - BADGE) / 2}
              onPress={avatarUrl ? open : () => void pickAvatar()}
              style={[styles.badge, { backgroundColor: colors.surface, borderColor: colors.border, opacity: busy ? 0.55 : 1 }]}
            >
              <Icon name="camera" size={16} color={colors.textDim} />
            </Pressable>
          )}
        </ActionSheet>
      </View>
      {editing ? (
        <View style={styles.edit}>
          <Input label="Username" value={draft} onChangeText={setDraft} autoCapitalize="none" autoCorrect={false} />
          <View style={styles.actions}>
            <Button label="Cancel" variant="secondary" onPress={cancelEdit} />
            <Button label="Save" loading={busy} disabled={draft.trim().length < 3} onPress={() => void run(() => setUsername(draft.trim())).then((saved) => { if (saved) setEditing(false); })} />
          </View>
        </View>
      ) : (
        <View style={styles.nameRow}>
          <Text {...dynamicType} numberOfLines={1} style={[typography.title, styles.name, { color: colors.text }]}>@{username}</Text>
          <IconButton name="edit" accessibilityLabel="Change username" onPress={() => { setDraft(username); setEditing(true); }} />
        </View>
      )}
      <Text {...dynamicType} style={[typography.caption, styles.center, { color: colors.textDim }]}>{status}</Text>
      {error ? <Text accessibilityRole="alert" style={[typography.caption, styles.center, { color: colors.danger }]}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  profile: { alignItems: "center", gap: spacing.sm },
  center: { textAlign: "center" },
  badge: { position: "absolute", right: 0, bottom: 0, width: BADGE, height: BADGE, borderRadius: radii.full, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  nameRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, maxWidth: "100%" },
  name: { flexShrink: 1, textAlign: "center" },
  edit: { alignSelf: "stretch", gap: spacing.sm },
  actions: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
});
