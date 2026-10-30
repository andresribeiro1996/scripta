import { useQuery } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "../../ui/Text";
import { useAuth } from "../../core/auth";
import { API_URL } from "../../core/config";
import { Icon, IconButton, Screen, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { AuthorAvatar } from "../community/AuthorAvatar";
import { fetchOwnProfile } from "../community/api";

const CARDS = [
  { label: "Your shelf", href: "/me", icon: "shelf" },
  { label: "Murals", href: "/murals", icon: "murals" },
  { label: "Reader card", href: "/reader-card", icon: "readerCard" },
  { label: "Gallery", href: "/gallery", icon: "image" },
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
          headerRight: () => <IconButton name="settings" accessibilityLabel="Settings" onPress={() => router.push("/settings" as never)} />,
        }}
      />
      <ScrollView contentContainerStyle={styles.page}>
        <View style={styles.profile}>
          <AuthorAvatar username={username} avatarUrl={avatarUrl} size={96} />
          <Text {...dynamicType} numberOfLines={1} style={[typography.title, styles.center, { color: colors.text }]}>@{username}</Text>
          {own.data ? (
            <Text {...dynamicType} style={[typography.caption, styles.center, { color: colors.textDim }]}>{own.data.published ? "Published" : "Private"}</Text>
          ) : null}
        </View>
        <View style={styles.grid}>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          {CARDS.map((card) => (
            <Pressable
              key={card.href}
              accessibilityRole="button"
              accessibilityLabel={card.label}
              onPress={() => router.push(card.href as never)}
              style={({ pressed }) => [styles.cell, pressed ? { backgroundColor: colors.surfacePressed } : null]}
            >
              <Icon name={card.icon} size={44} color={colors.accent} />
              <Text {...dynamicType} style={[typography.body, styles.label, { color: colors.text }]}>{card.label}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.lg, gap: spacing.xl },
  profile: { alignItems: "center", gap: spacing.sm },
  center: { textAlign: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  divider: { position: "absolute", left: "50%", top: spacing.md, bottom: spacing.md, width: 1 },
  cell: { width: "50%", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xl, borderRadius: radii.lg },
  label: { alignSelf: "stretch", fontWeight: "600", textAlign: "center" },
});
