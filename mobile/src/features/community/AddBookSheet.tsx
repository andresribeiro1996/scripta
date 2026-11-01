import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { router, useGlobalSearchParams, usePathname, useSegments } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "../../ui/Text";
import { localDay, saveFailureMessage, searchResultByline, toRecommendation } from "@scripta/shared";
import { useAuth } from "../../core/auth";
import { Button, Sheet, Toast, dynamicType, minimumTouchTarget, spacing, typography, useTheme } from "../../ui";
import { BookCover } from "../arena/BookCover";
import { FinishedScreen } from "../library/FinishedScreen";
import { addBookToLibrary } from "../library/api/client";
import { LIBRARY_QUERY_KEY, useLibrary } from "../library/hooks/useLibrary";
import { ownedEntry } from "../search/searchModel";
import { pathWithQuery } from "../auth/navigation";
import { workPath } from "../works/workPath";
import { useLocale, useT, type MessageKey } from "../../i18n";

const STATUS_VALUES = [0, 1, 2] as const;

export function AddBookSheet({
  book,
  onClose,
}: {
  book: { title: string; author: string; isbn?: string | null; coverUrl?: string | null; year?: number | null; publisher?: string | null; workId?: string };
  onClose: () => void;
}) {
  const locale = useLocale();
  const t = useT();
  const { colors } = useTheme();
  const { user } = useAuth();
  const pathname = usePathname();
  const params = useGlobalSearchParams();
  const segments = useSegments();
  const queryClient = useQueryClient();
  const library = useLibrary({ enabled: !!user });
  const existing = ownedEntry({ Title: book.title, Attribution: book.author, ISBN: book.isbn }, library.data?.data.books ?? []);
  const currentStatus = existing ? Number(existing.ReadStatus ?? 0) : null;
  const [busyStatus, setBusyStatus] = useState<0 | 1 | 2 | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);
  const [finished, setFinished] = useState<Record<string, unknown> | null>(null);

  if (!user) {
    return (
      <Sheet visible title={t("addBook.addToLibrary")} onClose={onClose}>
        <View style={styles.signedOut}>
          <Text {...dynamicType} style={[typography.body, { color: colors.textDim, textAlign: "center" }]}>{t("community.addToLibrarySignIn")}</Text>
          <Button label={t("shell.signIn")} onPress={() => router.push({ pathname: "/(public)/login", params: { returnTo: pathWithQuery(pathname, params) } } as never)} />
        </View>
      </Sheet>
    );
  }

  async function handleAdd(readStatus: 0 | 1 | 2) {
    setBusyStatus(readStatus);
    setToast(null);
    try {
      const { key, updated } = await addBookToLibrary({ ...toRecommendation(book, readStatus), day: localDay() });
      void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEY });
      if (readStatus === 2) {
        const { data, error: reloadError } = await library.refetch();
        if (reloadError) {
          setToast({ message: t("community.addedFinishStepFailed"), tone: "error" });
          setTimeout(onClose, 1600);
          return;
        }
        const added = data?.data.books.find((entry) => entry.ContentID === key);
        if (added) {
          setFinished(added);
          return;
        }
      }
      setToast({ message: updated ? t("community.updatedInLibrary") : t("community.addedToLibrary"), tone: "success" });
      setTimeout(onClose, 1600);
    } catch (error) {
      setToast({ message: saveFailureMessage(error, t("book.addBookFailed"), locale), tone: "error" });
    } finally {
      setBusyStatus(null);
    }
  }

  if (finished) {
    return (
      <Sheet visible title={t("shell.finished")} onClose={onClose}>
        <FinishedScreen book={finished} before={null} onClose={onClose} />
      </Sheet>
    );
  }

  const workId = book.workId;
  return (
    <Sheet visible title={existing ? t("community.updateStatus") : t("addBook.addToLibrary")} onClose={onClose}>
      <View style={styles.book}>
        <BookCover cover={book.coverUrl ?? null} title={book.title} width={96} height={138} />
        <View style={styles.text}>
          <Text numberOfLines={2} {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>{book.title}</Text>
          <Text numberOfLines={2} {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{searchResultByline({ authors: [book.author], publisher: book.publisher ?? null, year: book.year ?? null })}</Text>
        </View>
      </View>
      <Text {...dynamicType} style={[typography.caption, styles.strong, { color: colors.textDim }]}>{existing ? t("community.moveItTo") : t("community.addAs")}</Text>
      <View style={styles.actions}>
        {STATUS_OPTIONS.map((option) => (
          <Button
            key={option.value}
            label={t(option.labelKey)}
            variant={option.value === currentStatus ? "primary" : "secondary"}
            loading={busyStatus === option.value}
            disabled={busyStatus !== null}
            onPress={() => void handleAdd(option.value)}
          />
        ))}
      </View>
      {workId ? (
        <Pressable
          accessibilityRole="link"
          onPress={() => {
            onClose();
            router.push(workPath(workId, segments) as never);
          }}
          style={styles.link}
        >
          <Text {...dynamicType} style={[typography.body, styles.strong, { color: colors.text, textDecorationLine: "underline" }]}>{t("community.seeBookPage")}</Text>
        </Pressable>
      ) : null}
      {toast ? <Toast visible message={toast.message} tone={toast.tone} /> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  signedOut: { gap: spacing.md, paddingVertical: spacing.lg },
  book: { flexDirection: "row", gap: spacing.md, paddingVertical: spacing.md },
  text: { flex: 1, gap: spacing.xs, justifyContent: "center" },
  actions: { gap: spacing.sm, paddingTop: spacing.sm },
  strong: { fontWeight: "700" },
  link: { minHeight: minimumTouchTarget, justifyContent: "center", alignSelf: "flex-start" },
});
