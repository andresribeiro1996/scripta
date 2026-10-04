import { useState } from "react";
import { Alert, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { bookKey, markDistinct, saveFailureMessage, statusLabel } from "@scripta/shared";
import { Text } from "../../../ui/Text";
import { Button, ModalBody } from "../../../ui/components";
import { radii, spacing, typography, useTheme } from "../../../ui/theme";
import { mergeLibraryBooks } from "../api/client";
import type { LibraryDocument } from "../api/types";
import { LIBRARY_QUERY_KEY, useLibrary } from "../hooks/useLibrary";
import { CoverImage } from "./CoverImage";

export function DuplicatesSheetBody({ groups, library }: { groups: string[][]; library: LibraryDocument }) {
  const { colors } = useTheme();
  const { updateLibrary, saver } = useLibrary();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const byKey = new Map(library.data.books.map((book) => [bookKey(book), book] as const));

  async function run(action: () => Promise<unknown>, failure: string) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      console.error(error);
      void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEY });
      Alert.alert(saveFailureMessage(error, failure));
    } finally {
      setBusy(false);
    }
  }

  const merge = (group: string[]) =>
    run(async () => {
      await saver.merge((expectedUpdatedAt, signal) => mergeLibraryBooks(group[0]!, group.slice(1), expectedUpdatedAt ?? library.updatedAt, signal));
    }, "Couldn't merge these books.");

  const keepApart = (group: string[]) => run(() => updateLibrary((data) => markDistinct(data, group)), "Couldn't save that.");

  return (
    <ModalBody>
      <View style={{ gap: spacing.lg }}>
        {groups.map((group) => (
          <View key={group.join("|")} style={{ gap: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, padding: spacing.md }}>
            {group.map((key) => {
              const book = byKey.get(key);
              if (!book) return null;
              return (
                <View key={key} style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
                  <View style={{ width: 48, aspectRatio: 2 / 3, overflow: "hidden", borderRadius: radii.sm, backgroundColor: colors.border }}>
                    <CoverImage book={book} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={[typography.body, { color: colors.text }]}>{String(book.Title ?? "Untitled")}</Text>
                    <Text numberOfLines={1} style={[typography.caption, { color: colors.textDim }]}>{String(book.Attribution ?? "")}</Text>
                    <Text style={[typography.caption, { color: colors.textDim }]}>{[book.ISBN ? `ISBN ${String(book.ISBN)}` : null, statusLabel(book.ReadStatus)].filter(Boolean).join(" · ")}</Text>
                  </View>
                </View>
              );
            })}
            <Button label="Merge" disabled={busy} onPress={() => void merge(group)} />
            <Button label="Not the same" variant="secondary" disabled={busy} onPress={() => void keepApart(group)} />
          </View>
        ))}
      </View>
    </ModalBody>
  );
}
