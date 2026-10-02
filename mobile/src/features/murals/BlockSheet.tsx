import { BLOCK_TYPE_LABELS, type MuralBlock } from "@scripta/shared";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Keyboard, Platform, StyleSheet, useWindowDimensions, View } from "react-native";
import { FormScroll, Segmented, Sheet } from "../../ui";
import { spacing } from "../../ui/theme";

export type SheetTab = "content" | "style" | "layout";

export function BlockSheet({ block, visible, tab, onTabChange, onClose, preview, content, style, layout }: {
  block: MuralBlock | null;
  visible: boolean;
  tab: SheetTab | null;
  onTabChange: (tab: SheetTab) => void;
  onClose: () => void;
  preview: ReactNode;
  content: ReactNode | null;
  style: ReactNode | null;
  layout: ReactNode;
}) {
  const { height } = useWindowDimensions();
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
    { value: "layout", label: "Layout" },
  ];
  const wanted = tab ?? lastTab.current;
  const current = tabs.find((item) => item.value === wanted)?.value ?? "layout";
  return (
    <Sheet visible={visible} title={block ? BLOCK_TYPE_LABELS[block.type] : ""} onClose={onClose}>
      <View style={[styles.frame, { height: Math.round(height * 0.8), flexShrink: 1 }]}>
        {keyboardShown ? null : preview}
        <Segmented options={tabs} value={current} onChange={onTabChange} accessibilityLabel="Block settings" />
        <FormScroll contentContainerStyle={styles.body}>{current === "content" ? content : current === "style" ? style : layout}</FormScroll>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  frame: { gap: spacing.md },
  body: { paddingBottom: spacing.xl },
});
