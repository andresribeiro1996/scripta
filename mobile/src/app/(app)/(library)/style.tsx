import { Stack } from "expo-router";
import { saveFailureMessage } from "@scripta/shared";
import { LibraryStyleView } from "@/features/library/components/LibraryStyleView";
import { useLibrary } from "@/features/library/hooks/useLibrary";
import { attemptUpdate } from "@/features/library/lib/attemptUpdate";
import { Screen, useToast } from "@/ui";

export default function LibraryStyleRoute() {
  const { data: library, updateLibrary } = useLibrary();
  const { show } = useToast();

  return (
    <Screen top={false}>
      <Stack.Screen options={{ title: "Library style" }} />
      <LibraryStyleView
        savedStyle={library?.data.style}
        previewBooks={library?.data.books ?? []}
        onSave={(next) =>
          void attemptUpdate(
            () => updateLibrary((data) => ({ ...data, style: next })),
            (error) => show(saveFailureMessage(error, "Couldn't save the style change."), "error"),
          )
        }
      />
    </Screen>
  );
}
