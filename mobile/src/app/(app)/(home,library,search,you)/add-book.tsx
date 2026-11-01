import { router, Stack, useLocalSearchParams } from "expo-router";
import { AddBookForm } from "@/features/library/components/AddBookForm";
import { useLibraryActions } from "@/features/library/hooks/useLibraryActions";
import { useT } from "@/i18n";
import { Screen, SheetHeader } from "@/ui";

export default function AddBookRoute() {
  const t = useT();
  const { addBook } = useLibraryActions();
  const { q, scan } = useLocalSearchParams<{ q?: string; scan?: string }>();
  return (
    <Screen top={false}>
      <Stack.Screen options={{ headerShown: false }} />
      <SheetHeader title={t("shell.addBook")} onClose={() => router.back()} />
      <AddBookForm onAdd={addBook} onClose={() => router.back()} initialQuery={q ?? ""} initialScanning={scan === "1"} />
    </Screen>
  );
}
