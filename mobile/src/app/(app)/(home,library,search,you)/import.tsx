import { router, Stack } from "expo-router";
import { ImportForm } from "@/features/library/components/ImportForm";
import { useLibraryActions } from "@/features/library/hooks/useLibraryActions";
import { Screen, SheetHeader } from "@/ui";

export default function ImportRoute() {
  const { merge } = useLibraryActions();
  const title = "Import library";
  return (
    <Screen top={false}>
      <Stack.Screen options={{ title, headerShown: false }} />
      <SheetHeader title={title} onClose={() => router.back()} />
      <ImportForm title={title} onMerge={merge} onClose={() => router.back()} />
    </Screen>
  );
}
