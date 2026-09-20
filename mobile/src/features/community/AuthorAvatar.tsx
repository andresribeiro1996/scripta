import { router } from "expo-router";
import { Image } from "expo-image";
import { StyleSheet, Text, View } from "react-native";
import { dynamicType, radii, typography, useTheme } from "../../ui";

export function AuthorAvatar({ username, avatarUrl, size }: { username: string; avatarUrl: string | null; size?: number }) {
  const { colors } = useTheme();
  const shape = size === undefined ? styles.avatar : { width: size, height: size, borderRadius: radii.full };
  if (avatarUrl) {
    return <Image source={{ uri: avatarUrl }} contentFit="cover" style={shape} />;
  }
  // The monogram is the whole content of a fallback avatar, so it scales with
  // it — caption-sized initials in a 72px circle read as a mistake.
  const initial = size !== undefined && size >= 48 ? typography.heading : size !== undefined && size >= 36 ? typography.title : typography.caption;
  return (
    <View style={[shape, styles.avatarFallback, { backgroundColor: colors.accentSoft }]}>
      <Text {...dynamicType} style={[initial, { color: colors.accent }]}>
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
