import { router, Stack } from "expo-router";
import { ImportForm } from "@/features/library/components/ImportForm";
import { useLibraryActions } from "@/features/library/hooks/useLibraryActions";
import { useT } from "@/i18n";
import { Screen, SheetHeader } from "@/ui";

export default function ImportRoute() {
  const t = useT();
  const { merge } = useLibraryActions();
  const title = t("shell.importLibrary");
  return (
    <Screen top={false}>
      <Stack.Screen options={{ title, headerShown: false }} />
      <SheetHeader title={title} onClose={() => router.back()} />
      <ImportForm title={title} onMerge={merge} onClose={() => router.back()} />
    </Screen>
  );
}
