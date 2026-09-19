import { router } from "expo-router";
import { Image } from "expo-image";
import { StyleSheet, Text, View } from "react-native";
import { dynamicType, radii, typography, useTheme } from "../../ui";

export function AuthorAvatar({ username, avatarUrl }: { username: string; avatarUrl: string | null }) {
  const { colors } = useTheme();
  if (avatarUrl) {
    return <Image source={{ uri: avatarUrl }} contentFit="cover" style={styles.avatar} />;
  }
  return (
    <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: colors.accentSoft }]}>
      <Text {...dynamicType} style={[typography.caption, { color: colors.accent }]}>
        {username.slice(0, 1).toUpperCase()}
      </Text>
    </View>
  );
}

export function openProfile(username: string) {
  router.push(`/u/${username}` as never);
}

const styles = StyleSheet.create({
  avatar: { width: 28, height: 28, borderRadius: radii.full },
  avatarFallback: { alignItems: "center", justifyContent: "center" },
});
