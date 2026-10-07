import { router, Stack } from "expo-router";
import { AddBookForm } from "@/features/library/components/AddBookForm";
import { useLibraryActions } from "@/features/library/hooks/useLibraryActions";
import { Screen, SheetHeader } from "@/ui";

export default function AddBookRoute() {
  const { addBook } = useLibraryActions();
  return (
    <Screen top={false}>
      <Stack.Screen options={{ headerShown: false }} />
      <SheetHeader title="Add a book" onClose={() => router.back()} />
      <AddBookForm onAdd={addBook} onClose={() => router.back()} />
    </Screen>
  );
}
