import { router } from "expo-router";
import { AddBookForm } from "@/features/library/components/AddBookForm";
import { useLibraryActions } from "@/features/library/hooks/useLibraryActions";
import { Screen } from "@/ui";

export default function AddBookRoute() {
  const { addBook } = useLibraryActions();
  return (
    <Screen top={false}>
      <AddBookForm onAdd={addBook} onClose={() => router.back()} />
    </Screen>
  );
}
