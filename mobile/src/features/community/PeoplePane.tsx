import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FlatList, StyleSheet, View } from "react-native";
import { Text } from "../../ui/Text";
import { EmptyState, ErrorState, Input, Toast, dynamicType, spacing, typography, useTheme } from "../../ui";
import type { PersonResult, SuggestedReader } from "@scripta/shared/community";
import { useDebouncedValue } from "../library/lib/debounce";
import { fetchSuggestedPeople, searchPeople } from "./api";
import { PersonRow } from "./PersonRow";
import { useFollowToggle } from "./useFollowToggle";
import { useT } from "../../i18n";

export function PeoplePane() {
  const t = useT();
  const { colors } = useTheme();
  const [query, setQuery] = useState("");
  const { busyId, error, toggle } = useFollowToggle();
  const needle = useDebouncedValue(query.trim(), 300);
  const people = useQuery({
    queryKey: ["community", "people", "search", needle],
    queryFn: () => searchPeople(needle),
    enabled: needle.length > 0,
    retry: false,
  });
  const suggested = useQuery({
    queryKey: ["community", "people", "suggested"],
    queryFn: fetchSuggestedPeople,
    enabled: needle.length === 0,
    retry: false,
  });
  const results: (PersonResult | SuggestedReader)[] = (needle.length > 0 ? people.data : suggested.data) ?? [];

  return (
    <>
      <View style={styles.page}>
        {error ? <Toast visible message={error} tone="error" /> : null}
        <FlatList
          data={results}
          keyExtractor={(item) => item.user.userId}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <>
              <Input
                label={t("community.searchPeople")}
                value={query}
                onChangeText={setQuery}
                placeholder={t("community.searchByUsername")}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
              />
              {needle.length === 0 && results.length > 0 ? (
                <Text accessibilityRole="header" {...dynamicType} style={[typography.caption, styles.suggestionsCaption, { color: colors.textDim }]}>
                  {t("book.readersYouMightLike")}
                </Text>
              ) : null}
            </>
          }
          ListEmptyComponent={
            needle.length === 0 && suggested.isError ? (
              <ErrorState title={t("community.suggestionsLoadFailed")} actionLabel={t("shell.retry")} onAction={() => void suggested.refetch()} />
            ) : needle.length > 0 && people.isError ? (
              <ErrorState title={t("community.searchFailed")} actionLabel={t("shell.retry")} onAction={() => void people.refetch()} />
            ) : needle.length > 0 && !people.isPending ? (
              <EmptyState title={t("community.noPeopleTitle")} body={t("community.noPeopleBody")} />
            ) : (
              <EmptyState title={t("community.findPeople")} body={t("community.findPeopleBody")} />
            )
          }
          renderItem={({ item }) => <PersonRow person={item} busy={busyId === item.user.userId} onToggleFollow={() => void toggle(item)} />}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: spacing.lg },
  list: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.huge, flexGrow: 1 },
  suggestionsCaption: { marginTop: spacing.sm },
});
