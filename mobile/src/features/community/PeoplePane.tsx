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

export function PeoplePane() {
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
                label="Search people"
                value={query}
                onChangeText={setQuery}
                placeholder="Search by username"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
              />
              {needle.length === 0 && results.length > 0 ? (
                <Text accessibilityRole="header" {...dynamicType} style={[typography.caption, styles.suggestionsCaption, { color: colors.textDim }]}>
                  Readers you might like
                </Text>
              ) : null}
            </>
          }
          ListEmptyComponent={
            needle.length === 0 && suggested.isError ? (
              <ErrorState title="Couldn't load suggestions." actionLabel="Retry" onAction={() => void suggested.refetch()} />
            ) : needle.length > 0 && people.isError ? (
              <ErrorState title="Couldn't search." actionLabel="Retry" onAction={() => void people.refetch()} />
            ) : needle.length > 0 && !people.isPending ? (
              <EmptyState title="No people found" body="Try another username." />
            ) : (
              <EmptyState title="Find people" body="Search a username to follow them." />
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
