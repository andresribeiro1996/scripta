import { blockLabel, type MuralBlock } from "@scripta/shared";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Keyboard, Platform, StyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FormScroll, Segmented, Sheet } from "../../ui";
import { minimumTouchTarget, spacing, typography } from "../../ui/theme";

export type SheetTab = "content" | "style" | "layout";

export function BlockSheet({ block, visible, tab, onTabChange, onClose, preview, content, style, layout }: {
  block: MuralBlock | null;
  visible: boolean;
  tab: SheetTab | null;
  onTabChange: (tab: SheetTab) => void;
  onClose: () => void;
  preview: (maxHeight: number) => ReactNode;
  content: ReactNode | null;
  style: ReactNode | null;
  layout: ReactNode;
}) {
  const { height, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const sheetHeight = Math.min(640, height * 0.9, height - insets.top - spacing.sm);
  const frameHeight = Math.max(0, sheetHeight - insets.bottom - spacing.xl * 2 - Math.max(minimumTouchTarget, typography.title.lineHeight * fontScale));
  const [keyboardShown, setKeyboardShown] = useState(false);
  const lastTab = useRef<SheetTab | null>(null);
  useEffect(() => {
    const ios = Platform.OS === "ios";
    const show = Keyboard.addListener(ios ? "keyboardWillShow" : "keyboardDidShow", () => setKeyboardShown(true));
    const hide = Keyboard.addListener(ios ? "keyboardWillHide" : "keyboardDidHide", () => setKeyboardShown(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  useEffect(() => {
    if (tab) lastTab.current = tab;
  }, [tab]);
  const tabs: Array<{ value: SheetTab; label: string }> = [
    ...(content ? [{ value: "content" as const, label: "Content" }] : []),
    ...(style ? [{ value: "style" as const, label: "Style" }] : []),
    { value: "layout", label: "Size" },
  ];
  const wanted = tab ?? lastTab.current;
  const current = tabs.find((item) => item.value === wanted)?.value ?? "layout";
  return (
    <Sheet visible={visible} title={block ? blockLabel(block.type) : ""} onClose={onClose}>
      <View style={[styles.frame, { height: frameHeight }]}>
        {keyboardShown || frameHeight < 320 * fontScale ? null : preview(Math.min(144, Math.round(frameHeight / 5)))}
        <Segmented options={tabs} value={current} onChange={onTabChange} accessibilityLabel="Block settings" />
        <FormScroll contentContainerStyle={styles.body}>{current === "content" ? content : current === "style" ? style : layout}</FormScroll>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  frame: { gap: spacing.md, flexShrink: 1 },
  body: { paddingBottom: spacing.xl },
});
