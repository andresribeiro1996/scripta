import { Modal, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { hasChosen, type ReaderCardBase } from "@scripta/shared";
import { Icon, minimumTouchTarget, radii, spacing, typography, useReducedMotion, useTheme } from "../../ui";
import { Text } from "../../ui/Text";
import { PLATE_RATIO } from "./ReaderCardImage";
import { ReaderCardTurner } from "./ReaderCardTurner";

const BACKDROP = "rgba(0, 0, 0, 0.7)";

export function ReaderCardViewer({ input, onClose, onEdit }: { input: ReaderCardBase; onClose: () => void; onEdit?: () => void }) {
  const { colors } = useTheme();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const width = Math.max(0, Math.min(screenWidth - spacing.xl * 2, (screenHeight - insets.top - insets.bottom - 160) / PLATE_RATIO));

  return (
    <Modal animationType={reduced ? "none" : "fade"} onRequestClose={onClose} statusBarTranslucent transparent visible>
      <View style={[styles.backdrop, { backgroundColor: BACKDROP, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <Pressable accessible={false} importantForAccessibility="no" onPress={onClose} style={StyleSheet.absoluteFill} />
        <View accessibilityViewIsModal style={styles.content}>
          <View style={[styles.bar, { width }]}>
            {onEdit && input.view === "owner" ? (
              <Pressable accessibilityRole="button" onPress={onEdit} style={[styles.pill, { backgroundColor: colors.surface }]}>
                <Text style={[typography.body, { color: colors.text }]}>Edit card</Text>
              </Pressable>
            ) : <View />}
            <Pressable accessibilityLabel="Close reader card" accessibilityRole="button" hitSlop={8} onPress={onClose} style={[styles.close, { backgroundColor: colors.surface }]}>
              <Icon name="close" color={colors.text} />
            </Pressable>
          </View>
          <ReaderCardTurner key={`${input.view}-${input.style.layout}-${hasChosen(input.card.chosen)}`} input={input} width={width} onScrim liveShine />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { alignItems: "center", gap: spacing.md },
  bar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  pill: { minHeight: minimumTouchTarget, paddingHorizontal: spacing.lg, borderRadius: radii.full, justifyContent: "center" },
  close: { minWidth: minimumTouchTarget, minHeight: minimumTouchTarget, borderRadius: radii.full, alignItems: "center", justifyContent: "center" },
});
