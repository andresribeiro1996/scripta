import { useQuery } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "../../ui/Text";
import { useAuth } from "../../core/auth";
import { API_URL } from "../../core/config";
import { IconButton, Screen, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { AuthorAvatar } from "../community/AuthorAvatar";
import { fetchOwnProfile } from "../community/api";
import { CARDS } from "./YouPreviews";

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
          <AuthorAvatar username={username} avatarUrl={avatarUrl} size={64} />
          <View style={styles.grow}>
            <Text {...dynamicType} numberOfLines={1} style={[typography.title, { color: colors.text }]}>@{username}</Text>
            {own.data ? (
              <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{own.data.published ? "Published" : "Private"}</Text>
            ) : null}
          </View>
        </View>
        <View style={styles.grid}>
          {CARDS.map((card) => (
            <Pressable
              key={card.href}
              accessibilityRole="button"
              accessibilityLabel={card.label}
              onPress={() => router.push(card.href as never)}
              style={({ pressed }) => [styles.card, { backgroundColor: pressed ? colors.surfacePressed : colors.surface, borderColor: colors.border }]}
            >
              <View style={[styles.preview, { backgroundColor: colors.accentSoft }]}>
                <card.Preview />
              </View>
              <Text {...dynamicType} style={[typography.body, styles.label, { color: colors.text }]}>{card.label}</Text>
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
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  card: { flexGrow: 1, flexBasis: "40%", borderWidth: 1, borderRadius: radii.lg, overflow: "hidden" },
  preview: { height: 132, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  label: { fontWeight: "600", textAlign: "center", padding: spacing.md },
});
