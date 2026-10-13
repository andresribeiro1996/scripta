import { useQuery } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "../../ui/Text";
import { useAuth } from "../../core/auth";
import { API_URL } from "../../core/config";
import { Icon, IconButton, Screen, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { AuthorAvatar } from "../community/AuthorAvatar";
import { fetchOwnProfile } from "../community/api";

const ROWS = [
  { label: "Your shelf", href: "/me" },
  { label: "Murals", href: "/murals" },
  { label: "Reader card", href: "/reader-card" },
  { label: "Gallery", href: "/gallery" },
] as const;

export function YouScreen() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const own = useQuery({ queryKey: ["community", "own-profile"], queryFn: fetchOwnProfile });
  const username = user?.username ?? "";
  const avatarUrl = user?.avatarId ? `${API_URL}/auth/avatar/${user.avatarId}/file` : null;

  return (
    <Screen top={false}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: "You",
          headerRight: () => <IconButton framed name="settings" label="Settings" accessibilityLabel="Settings" onPress={() => router.push("/settings" as never)} />,
        }}
      />
      <ScrollView contentContainerStyle={styles.page}>
        <View style={styles.profile}>
          <AuthorAvatar username={username} avatarUrl={avatarUrl} size={64} />
          <View style={styles.grow}>
            <Text {...dynamicType} numberOfLines={1} style={[typography.title, { color: colors.text }]}>@{username}</Text>
            {own.data ? (
              <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{own.data.published ? "Published" : "Private"}</Text>
            ) : null}
          </View>
        </View>
        <View style={[styles.rows, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {ROWS.map((row, index) => (
            <Pressable
              key={row.href}
              accessibilityRole="button"
              onPress={() => router.push(row.href as never)}
              style={({ pressed }) => [
                styles.row,
                index > 0 ? { borderTopWidth: 1, borderTopColor: colors.border } : null,
                pressed ? { backgroundColor: colors.surfacePressed } : null,
              ]}
            >
              <Text {...dynamicType} style={[typography.body, styles.rowLabel, { color: colors.text }]}>{row.label}</Text>
              <Icon name="chevronRight" size={18} color={colors.textDim} />
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.lg, gap: spacing.lg },
  profile: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  grow: { flex: 1, gap: spacing.xs },
  rows: { borderWidth: 1, borderRadius: radii.lg, overflow: "hidden" },
  row: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg },
  rowLabel: { flex: 1, fontWeight: "600" },
});
