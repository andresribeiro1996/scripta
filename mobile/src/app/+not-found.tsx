import { router } from "expo-router";
import { StyleSheet, View } from "react-native";
import { Button, EmptyState } from "../ui";
import { spacing, useTheme } from "../ui/theme";

export default function NotFoundRoute() {
  const { colors } = useTheme();
  return <View style={[styles.screen, { backgroundColor: colors.background }]}><EmptyState title="Page not found" body="That link doesn't point to a Scripta screen." /><Button label="Go to Scripta" onPress={() => router.replace("/")} /></View>;
}

const styles = StyleSheet.create({ screen: { flex: 1, justifyContent: "center", padding: spacing.lg, gap: spacing.md } });
