import { BLOCK_TYPE_LABELS, type MuralBlock } from "@scripta/shared";
import type { ReactNode } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
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
  const tabs: Array<{ value: SheetTab; label: string }> = [
    ...(content ? [{ value: "content" as const, label: "Content" }] : []),
    ...(style ? [{ value: "style" as const, label: "Style" }] : []),
    { value: "layout", label: "Layout" },
  ];
  const current = tabs.some((item) => item.value === tab) ? tab! : "layout";
  return (
    <Sheet visible={visible} title={block ? BLOCK_TYPE_LABELS[block.type] : ""} onClose={onClose}>
      <View style={[styles.frame, { height: Math.round(height * 0.7) }]}>
        {preview}
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
