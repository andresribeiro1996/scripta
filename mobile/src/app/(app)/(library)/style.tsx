import { useState } from "react";
import { Stack } from "expo-router";
import { saveFailureMessage } from "@scripta/shared";
import { LibraryStyleView } from "@/features/library/components/LibraryStyleView";
import { useLibrary } from "@/features/library/hooks/useLibrary";
import { attemptUpdate } from "@/features/library/lib/attemptUpdate";
import { Screen } from "@/ui";
import { Text } from "@/ui/Text";
import { spacing, typography, useTheme } from "@/ui/theme";
import { getLocale } from "../../../i18n";

export default function LibraryStyleRoute() {
  const { data: library, updateLibrary } = useLibrary();
  const { colors } = useTheme();
  const [error, setError] = useState<string | null>(null);

  return (
    <Screen top={false}>
      <Stack.Screen options={{ title: "Library style" }} />
      {error ? <Text accessibilityRole="alert" style={[typography.caption, { color: colors.danger, padding: spacing.md }]}>{error}</Text> : null}
      <LibraryStyleView
        savedStyle={library?.data.style}
        previewBooks={library?.data.books ?? []}
        onSave={(next) => {
          setError(null);
          void attemptUpdate(
            () => updateLibrary((data) => ({ ...data, style: next })),
            (failure) => setError(saveFailureMessage(failure, "Couldn't save the style change.", getLocale())),
          );
        }}
      />
    </Screen>
  );
}
