import { useState } from "react";
import { router, useGlobalSearchParams, usePathname } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { localDay } from "@scripta/shared";
import { useAuth } from "../../core/auth";
import { Button, Sheet, Toast, dynamicType, spacing, typography, useTheme } from "../../ui";
import { BookCover } from "../arena/BookCover";
import { addBookToLibrary } from "../library/api/client";
import { toRecommendation } from "../library/lib/recommendation";
import { pathWithQuery } from "../auth/navigation";

const STATUS_OPTIONS: ReadonlyArray<{ value: 0 | 1 | 2; label: string }> = [
  { value: 0, label: "To read" },
  { value: 1, label: "Reading" },
  { value: 2, label: "Finished" },
];

export function AddBookSheet({
  book,
  onClose,
}: {
  book: { title: string; author: string; isbn?: string | null; coverUrl?: string | null };
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const pathname = usePathname();
  const params = useGlobalSearchParams();
  const [busyStatus, setBusyStatus] = useState<0 | 1 | 2 | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);

  if (!user) {
    return (
      <Sheet visible title="Add to library" onClose={onClose}>
        <View style={styles.signedOut}>
          <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>Sign in to add books to your library.</Text>
          <Button label="Sign in" onPress={() => router.push({ pathname: "/(public)/login", params: { returnTo: pathWithQuery(pathname, params) } } as never)} />
        </View>
      </Sheet>
    );
  }

  async function handleAdd(readStatus: 0 | 1 | 2) {
    setBusyStatus(readStatus);
    setToast(null);
    try {
      const { updated } = await addBookToLibrary({ ...toRecommendation(book, readStatus), day: localDay() });
      setToast({ message: updated ? "Updated in your library." : "Added to your library.", tone: "success" });
      setTimeout(onClose, 1600);
    } catch {
      setToast({ message: "Could not add the book.", tone: "error" });
    } finally {
      setBusyStatus(null);
    }
  }

  return (
    <Sheet visible title="Add to library" onClose={onClose}>
      <View style={styles.book}>
        <BookCover cover={book.coverUrl ?? null} title={book.title} width={96} height={138} />
        <View style={styles.text}>
          <Text numberOfLines={2} {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>{book.title}</Text>
          <Text numberOfLines={2} {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{book.author}</Text>
        </View>
      </View>
      <View style={styles.actions}>
        {STATUS_OPTIONS.map((option) => (
          <Button
            key={option.value}
            label={option.label}
            variant="secondary"
            loading={busyStatus === option.value}
            disabled={busyStatus !== null}
            onPress={() => void handleAdd(option.value)}
          />
        ))}
      </View>
      {toast ? <Toast visible message={toast.message} tone={toast.tone} /> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  signedOut: { gap: spacing.md, paddingVertical: spacing.lg, alignItems: "center" },
  book: { flexDirection: "row", gap: spacing.md, paddingVertical: spacing.md },
  text: { flex: 1, gap: spacing.xs, justifyContent: "center" },
  actions: { gap: spacing.sm, paddingTop: spacing.sm },
  strong: { fontWeight: "700" },
});
