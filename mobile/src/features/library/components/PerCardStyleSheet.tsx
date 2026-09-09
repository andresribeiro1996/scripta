// Mirrors frontend's components/PerCardStylePanel.tsx — the "override
// this book/series' own card style" sheet, reused for both a book
// (BookDetailSheet's "Style" action) and a series (GroupsView's series
// settings menu). See @scripta/shared's Group.style / book._style for
// where each side persists.
//
// `customized`/`draft` seed from props only in their useState
// initializers, same as the web version's own useState — but unlike the
// web version (a fresh element tree every time PerCardStylePanel opens),
// this sheet stays mounted with `visible` toggling so the Sheet/Modal
// animates. Every call site MUST key this component on the target's id
// (see GroupsView.tsx/LibraryScreen.tsx) so switching targets forces a
// remount instead of showing the previous target's draft.

import { useState } from "react";
import { ScrollView, Text } from "react-native";
import { extractPerCardStyle, resolvePerCardStyle, type LibraryStyleSettings, type PerCardStyle } from "@scripta/shared";
import { Sheet } from "../../../ui/components";
import { spacing, typography, useTheme } from "../../../ui/theme";
import { useDebouncedCallback } from "../lib/debounce";
import { PerCardStyleFields } from "./PerCardStyleFields";
import { ToggleRow } from "./StyleControls";

export function PerCardStyleSheet({
  visible,
  name,
  priorityText,
  currentOverride,
  seedStyle,
  onSave,
  onClose,
}: {
  visible: boolean;
  name: string;
  priorityText: string;
  currentOverride: PerCardStyle | undefined;
  seedStyle: LibraryStyleSettings;
  onSave: (style: PerCardStyle | undefined) => void;
  onClose: () => void;
}) {
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
    <Sheet visible={visible} title={`Style for "${name}"`} onClose={onClose}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xl }}>
        <ToggleRow label="Custom style" checked={customized} onChange={toggleCustomized} />
        {!customized ? (
          <Text style={[typography.body, { color: colors.textDim }]}>Currently uses {priorityText} style. Turn this on to override it.</Text>
        ) : (
          <PerCardStyleFields draft={draft} onApply={applyPatch} onSaveNow={saveNowPatch} themeBorderColor={colors.border} />
        )}
      </ScrollView>
    </Sheet>
  );
}
