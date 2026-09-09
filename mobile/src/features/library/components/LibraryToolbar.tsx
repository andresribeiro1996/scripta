// Mirrors frontend's components/LibraryToolbar.tsx — search + status
// filter + sort, condensed for a phone-width screen (segmented pickers
// instead of the web's <select> dropdowns).

import { StyleSheet, TextInput, View } from "react-native";
import { SORT_OPTIONS, STATUS_FILTER_OPTIONS, type SortKey, type StatusFilter } from "@scripta/shared";
import { minimumTouchTarget, radii, spacing, typography, useTheme } from "../../../ui/theme";
import { SelectRow } from "./StyleControls";

export function LibraryToolbar({
  query,
  onQueryChange,
  status,
  onStatusChange,
  sort,
  onSortChange,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  status: StatusFilter;
  onStatusChange: (value: StatusFilter) => void;
  sort: SortKey;
  onSortChange: (value: SortKey) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.container}>
      <TextInput
        accessibilityLabel="Search your library"
        allowFontScaling
        autoCapitalize="none"
        autoCorrect={false}
        // iOS's inline clear affordance; Android has no equivalent prop, so
        // the field is cleared there by selecting and deleting.
        clearButtonMode="while-editing"
        onChangeText={onQueryChange}
        placeholder="Search title or author"
        placeholderTextColor={colors.textDim}
        returnKeyType="search"
        selectionColor={colors.accent}
        style={[styles.search, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
        value={query}
      />
      <SelectRow label="Status" value={status} options={STATUS_FILTER_OPTIONS} onChange={onStatusChange} />
      <SelectRow label="Sort" value={sort} options={SORT_OPTIONS} onChange={onSortChange} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.sm },
  search: { minHeight: minimumTouchTarget, borderWidth: 1, borderRadius: radii.md, paddingHorizontal: spacing.md, ...typography.input },
});
