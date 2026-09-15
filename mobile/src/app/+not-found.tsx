import { router } from "expo-router";
import { StyleSheet, View } from "react-native";
import { EmptyState } from "../ui";
import { spacing, useTheme } from "../ui/theme";

export default function NotFoundRoute() {
  const { colors } = useTheme();
  return <View style={[styles.screen, { backgroundColor: colors.background }]}><EmptyState title="Page not found" body="That link doesn't point to an Atmyshelf screen." actionLabel="Go to Atmyshelf" onAction={() => router.replace("/")} /></View>;
}

const styles = StyleSheet.create({ screen: { flex: 1, padding: spacing.lg } });
