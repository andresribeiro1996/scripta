import { useMemo } from "react";
import { router, Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { readerCardInputOf } from "@scripta/shared";
import { isPermanentError } from "../../core/apiClient";
import { Button, dynamicType, ErrorState, Screen, Skeleton, spacing, typography, useTheme } from "../../ui";
import { Text } from "../../ui/Text";
import { useLocale, useT } from "../../i18n";
import { openProfile } from "../community/AuthorAvatar";
import { ProfileCardHero } from "../readerCard/ProfileCardHero";
import { fetchSharedCard } from "./api";

export function SharedCardScreen({ token }: { token: string }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const query = useQuery({ queryKey: ["shared-card", token], queryFn: () => fetchSharedCard(token), enabled: Boolean(token), retry: false });
  const input = useMemo(() => (query.data ? readerCardInputOf([], [], query.data.username, locale, query.data.readerCard) : null), [query.data, locale]);

  if (query.isPending) return <View style={[styles.center, { backgroundColor: colors.background }]}><Skeleton height={180} /></View>;
  if (query.isError || !input) {
    const permanent = isPermanentError(query.error);
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ErrorState body={t("readerCard.sharedInvalid")} actionLabel={permanent ? t("shell.notFoundAction") : t("shell.retry")} onAction={permanent ? () => router.replace("/") : () => void query.refetch()} />
      </View>
    );
  }
  return (
    <Screen top={false} bottom>
      <Stack.Screen options={{ headerShown: true, title: t("readerCard.title") }} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <ProfileCardHero input={input} width={width}>
          <Text {...dynamicType} style={[typography.heading, styles.strong, { color: colors.text }]}>{query.data!.username}</Text>
          {query.data!.profileVisible ? <Button label={t("book.openProfile", { username: query.data!.username })} onPress={() => openProfile(query.data!.username)} /> : null}
        </ProfileCardHero>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", padding: spacing.lg },
  scroll: { paddingBottom: spacing.huge },
  strong: { fontWeight: "700" },
});
