import { Alert } from "react-native";
import { Stack } from "expo-router";
import { saveFailureMessage } from "@scripta/shared";
import { LibraryStyleView } from "@/features/library/components/LibraryStyleView";
import { useLibrary } from "@/features/library/hooks/useLibrary";
import { attemptUpdate } from "@/features/library/lib/attemptUpdate";
import { Screen } from "@/ui";

export default function LibraryStyleRoute() {
  const { data: library, updateLibrary } = useLibrary();

  return (
    <Screen top={false}>
      <Stack.Screen options={{ title: "Library style" }} />
      <LibraryStyleView
        savedStyle={library?.data.style}
        previewBooks={library?.data.books ?? []}
        onSave={(next) =>
          void attemptUpdate(
            () => updateLibrary((data) => ({ ...data, style: next })),
            (error) => Alert.alert(saveFailureMessage(error, "Couldn't save the style change.")),
          )
        }
      />
    </Screen>
  );
}
