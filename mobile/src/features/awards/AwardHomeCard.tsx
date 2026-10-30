import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery } from "@tanstack/react-query";
import { router, useSegments } from "expo-router";
import { Text } from "../../ui/Text";
import { IconButton, dynamicType, minimumTouchTarget, radii, spacing, typography, useTheme } from "../../ui";
import { BookCover } from "../arena/BookCover";
import { useLibrary } from "../library/hooks/useLibrary";
import { fetchRecentAwards } from "../works/api";
import { seriesSearchHref, workPath } from "../works/workPath";
import { awardCardModel, awardKey, firstUndismissed } from "@scripta/shared";

export const RECENT_AWARDS_QUERY_KEY = ["recentAwards"] as const;

export function AwardHomeCard() {
  const { colors } = useTheme();
  const segments = useSegments();
  const library = useLibrary();
  const recent = useQuery({ queryKey: RECENT_AWARDS_QUERY_KEY, queryFn: fetchRecentAwards, retry: false });
  const announcements = recent.data?.announcements;
  const [dismissed, setDismissed] = useState<ReadonlySet<string> | null>(null);

  useEffect(() => {
    setDismissed(null);
    if (!announcements) return;
    let live = true;
    AsyncStorage.multiGet(announcements.map(awardKey)).then(
      (stored) => { if (live) setDismissed(new Set(stored.flatMap(([key, value]) => (value === null ? [] : [key])))); },
      (reason) => { console.warn("Couldn't read the award dismissals", reason); },
    );
    return () => { live = false; };
  }, [announcements]);

  const announcement = announcements && dismissed ? firstUndismissed(announcements, dismissed) : undefined;
  const model = announcement ? awardCardModel(announcement, library.data ?? null) : null;
  if (!model) return null;
  const { target } = model;
  const open = () => {
    if (target.kind === "work") router.push(workPath(target.id, segments) as never);
    else router.navigate(seriesSearchHref(target.query, Date.now(), "navigate") as never);
  };
  const dismiss = () => {
    setDismissed((current) => new Set(current).add(model.key));
    AsyncStorage.setItem(model.key, "1").catch((reason) => { console.warn("Couldn't save the award dismissal", reason); });
  };
  return (
    <View key={model.key} style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={[model.title, model.subtitle, model.shelfLine].filter(Boolean).join(", ")} onPress={open} style={styles.body}>
        {model.coverUrl ? <BookCover cover={model.coverUrl} title={model.subtitle} width={40} height={60} /> : null}
        <View style={styles.text}>
          <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>{model.title}</Text>
          <Text numberOfLines={2} {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{model.subtitle}</Text>
          {model.shelfLine ? <Text numberOfLines={1} {...dynamicType} style={[typography.caption, { color: colors.accent }]}>{model.shelfLine}</Text> : null}
        </View>
      </Pressable>
      <IconButton name="close" accessibilityLabel={`Dismiss ${model.title}`} onPress={dismiss} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", marginHorizontal: spacing.md, marginTop: spacing.lg, paddingLeft: spacing.md, paddingRight: spacing.xs, borderWidth: 1, borderRadius: radii.xl },
  body: { flex: 1, minWidth: 0, minHeight: minimumTouchTarget, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm },
  text: { flex: 1, minWidth: 0, gap: spacing.xs },
  strong: { fontWeight: "700" },
});
