import { useState } from "react";
import { useWindowDimensions, View } from "react-native";
import { Text } from "../../../ui/Text";
import { extractPerCardStyle, resolvePerCardStyle, type LibraryStyleSettings, type PerCardStyle } from "@scripta/shared";
import { FormScroll, Sheet } from "../../../ui/components";
import { spacing, typography, useTheme } from "../../../ui/theme";
import { useDebouncedCallback } from "../lib/debounce";
import { PerCardStyleFields } from "./PerCardStyleFields";
import { SelectRow } from "./StyleControls";
import { CardStylePreview } from "./LibraryStyleView";

type PerCardStyleProps = {
  name: string;
  inheritedFrom: string;
  currentOverride: PerCardStyle | undefined;
  seedStyle: LibraryStyleSettings;
  previewBook?: Record<string, unknown>;
  onSave: (style: PerCardStyle | undefined) => void;
  onClose: () => void;
};

export function PerCardStyleSheet({ visible, ...props }: PerCardStyleProps & { visible: boolean }) {
  const { height } = useWindowDimensions();
  return (
    <Sheet visible={visible} title={`Style for "${props.name}"`} onClose={props.onClose}>
      <View style={{ height: Math.round(height * 0.8), flexShrink: 1 }}><PerCardStyleForm {...props} /></View>
    </Sheet>
  );
}

export function PerCardStyleForm({
  name,
  inheritedFrom,
  currentOverride,
  seedStyle,
  onSave,
  previewBook,
}: PerCardStyleProps) {
  const { colors } = useTheme();
  const [customized, setCustomized] = useState(currentOverride !== undefined);
  const [draft, setDraft] = useState<PerCardStyle>(currentOverride ? resolvePerCardStyle(currentOverride) : extractPerCardStyle(seedStyle));
  const debounced = useDebouncedCallback((next: PerCardStyle) => onSave(next), 400);

  function applyPatch(patch: Partial<PerCardStyle>) {
    const next = { ...draft, ...patch };
    setDraft(next);
    if (customized) debounced.schedule(next);
  }

  function saveNowPatch(patch: Partial<PerCardStyle>) {
    const next = { ...draft, ...patch };
    setDraft(next);
    debounced.cancel();
    if (customized) onSave(next);
  }

  function toggleCustomized(checked: boolean) {
    setCustomized(checked);
    debounced.cancel();
    onSave(checked ? draft : undefined);
  }

  return (
    <View style={{ flex: 1, gap: spacing.md }}>
      <CardStylePreview books={previewBook ? [previewBook] : []} style={customized ? { ...seedStyle, ...draft } : seedStyle} />
      <FormScroll contentContainerStyle={{ gap: spacing.xl, paddingBottom: spacing.xl }}>
        <SelectRow label="Style source" value={customized ? "custom" : "inherited"} options={[{ value: "inherited", label: "Inherited" }, { value: "custom", label: "Custom" }]} onChange={(value) => toggleCustomized(value === "custom")} />
        <Text style={[typography.caption, { color: colors.textDim }]}>{customized ? `Custom style for “${name}” overrides ${inheritedFrom}.` : `Inherited from ${inheritedFrom}. Choose Custom to change it.`}</Text>
        {customized ? <PerCardStyleFields draft={draft} canvasColor={seedStyle.backgroundColor ?? colors.background} onApply={applyPatch} onSaveNow={saveNowPatch} /> : null}
      </FormScroll>
    </View>
  );
}
