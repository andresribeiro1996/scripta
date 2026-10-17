import { BottomSheet, RNHostView } from "@expo/ui";
import { router } from "expo-router";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, spacing, typography, useTheme } from "../../../ui";
import { Text } from "../../../ui/Text";

export function AddBookOptionsSheet({ onClose }: { onClose: () => void }) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  return (
    <BottomSheet isPresented onDismiss={onClose} showDragIndicator={false} containerColor={colors.surface} scrimColor={colors.scrim} contentPadding={0}>
      <RNHostView matchContents>
        <View style={{ width: Math.min(width, 560), padding: spacing.xl, paddingBottom: Math.max(insets.bottom, spacing.xl) }}>
          <Text accessibilityRole="header" style={[typography.title, styles.title, { color: colors.text }]}>Add a book</Text>
          {([
            { icon: "search", title: "Search by title", hint: "Find it by title or author", href: "/add-book" },
            { icon: "scan", title: "Scan barcode", hint: "Point the camera at the ISBN on the back", href: "/add-book?scan=1" },
          ] as const).map((option) => (
            <Pressable key={option.icon} accessibilityRole="button" accessibilityLabel={option.title} accessibilityHint={option.hint} onPress={() => { onClose(); router.push(option.href as never); }} style={({ pressed }) => [styles.row, pressed ? { backgroundColor: colors.surfacePressed } : null]}>
              <Icon name={option.icon} color={colors.accent} size={24} />
              <View style={styles.copy}>
                <Text style={[typography.input, { color: colors.text }]}>{option.title}</Text>
                <Text style={[typography.body, { color: colors.textDim }]}>{option.hint}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      </RNHostView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  title: { fontWeight: "700", paddingBottom: spacing.md },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.lg, paddingVertical: spacing.lg },
  copy: { flex: 1, gap: spacing.xs },
});
