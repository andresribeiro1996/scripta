import { router } from "expo-router";
import { StyleSheet, View } from "react-native";
import { EmptyState } from "../ui";
import { spacing, useTheme } from "../ui/theme";
import { useT } from "../i18n";

export default function NotFoundRoute() {
  const t = useT();
  const { colors } = useTheme();
  return <View style={[styles.screen, { backgroundColor: colors.background }]}><EmptyState title={t("shell.notFoundTitle")} body={t("shell.notFoundBody")} actionLabel={t("shell.notFoundAction")} onAction={() => router.replace("/")} /></View>;
}

const styles = StyleSheet.create({ screen: { flex: 1, padding: spacing.lg } });
