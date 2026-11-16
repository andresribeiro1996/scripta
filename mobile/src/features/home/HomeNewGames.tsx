import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Text } from "../../ui/Text";
import { Icon, Skeleton, dynamicType, minimumTouchTarget, radii, spacing, typography, useTheme } from "../../ui";
import { CoverFan, SLOT_HEIGHT, fanWidth } from "../community/CoverFan";
import { FAN_SIZE } from "../community/communityHome";
import { fetchDiscover } from "../community/api";
import { useAuth } from "../../core/auth";
import { useLocale, useT } from "../../i18n";
import { HomeSectionHeader } from "./HomeSectionHeader";
import { gamesBrowseHref, newGameRows } from "./homeModel";

export const NEW_GAMES_QUERY_KEY = ["home", "new-games"] as const;

export function HomeNewGames() {
  const locale = useLocale();
  const t = useT();
  const { colors } = useTheme();
  const router = useRouter();
  const { user } = useAuth();
  const { data, isPending } = useQuery({ queryKey: NEW_GAMES_QUERY_KEY, queryFn: () => fetchDiscover("all", "", 0), retry: false });
  const rows = newGameRows(data?.items ?? [], locale, user?.id ?? null);
  if (isPending) return <View style={styles.pending}><Skeleton height={64} /></View>;
  if (!rows.length) return null;
  return <View>
    <HomeSectionHeader title={t("community.homeNewGames")} linkLabel={t("community.homeSeeAllGames")} onLink={() => router.navigate(gamesBrowseHref(Date.now()) as never)} />
    <View style={styles.rows}>
      {rows.map((row) => {
        const color = row.content.kind === "quiz" ? colors.reference : row.content.kind === "tierlist" ? colors.success : colors.accent;
        const covers = row.content.covers.slice(0, FAN_SIZE);
        return <Pressable key={row.key} accessibilityRole="link" onPress={() => router.push(row.target as never)} style={[styles.row, { backgroundColor: colors.surface }]}>
          <View style={{ width: covers.length ? fanWidth(covers.length) : styles.iconTile.width, height: SLOT_HEIGHT }}>
            {covers.length ? <CoverFan covers={covers} inset={0} /> : <View style={[styles.iconTile, { backgroundColor: colors.accentSoft }]}><Icon name="arena" size={24} color={colors.accent} /></View>}
          </View>
          <View style={styles.text}>
            <Text numberOfLines={1} {...dynamicType} style={[typography.caption, { color }]}>{row.kind}</Text>
            <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>{row.name}</Text>
            <Text numberOfLines={1} {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{row.meta}</Text>
          </View>
          <Icon name="chevronRight" size={16} color={colors.textDim} />
        </Pressable>;
      })}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  pending: { marginHorizontal: spacing.md, marginTop: spacing.xl },
  rows: { marginHorizontal: spacing.md, gap: spacing.sm },
  row: { minHeight: minimumTouchTarget, flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radii.lg },
  text: { flex: 1, minWidth: 0 },
  strong: { fontWeight: "700" },
  iconTile: { width: 48, height: 72, borderRadius: radii.sm, alignItems: "center", justifyContent: "center" }
});
