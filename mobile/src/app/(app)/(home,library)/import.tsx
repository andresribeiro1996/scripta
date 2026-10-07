import { router, Stack } from "expo-router";
import { ImportForm } from "@/features/library/components/ImportForm";
import { useLibrary } from "@/features/library/hooks/useLibrary";
import { useLibraryActions } from "@/features/library/hooks/useLibraryActions";
import { Screen } from "@/ui";

export default function ImportRoute() {
  const { data: library } = useLibrary();
  const { merge } = useLibraryActions();
  const hasBooks = (library?.data.books ?? []).length > 0;
  const title = hasBooks ? "Import more / sync Goodreads" : "Import library";
  return (
    <Screen top={false}>
      <Stack.Screen options={{ title }} />
      <ImportForm title={title} onMerge={merge} onClose={() => router.back()} />
    </Screen>
  );
}
