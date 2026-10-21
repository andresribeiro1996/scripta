import { Image } from "expo-image";
import { StyleSheet, View } from "react-native";
import type { QuizPreview } from "@scripta/shared";
import type { PublishedContent } from "@scripta/shared/community";
import { API_URL } from "../../core/config";
import { Icon, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { Text } from "../../ui/Text";
import { CoverImage } from "../library/components/CoverImage";
import { coverUrlForApi } from "../library/lib/coverUrl";
import type { RowCover } from "./DiscoverRow";

export function GameTicketArt({ kind, covers, ladder, preview, color }: { kind: PublishedContent["kind"]; covers: RowCover[]; ladder?: string[]; preview?: QuizPreview; color: string }) {
  const { colors } = useTheme();
  if (kind === "quiz") {
    return <View style={styles.quiz} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      {preview?.type === "cover_title" ? <>
        <Image source={{ uri: coverUrlForApi(preview.prompt, API_URL) }} contentFit="cover" blurRadius={18} style={[styles.mysteryCover, { backgroundColor: colors.border }]} />
        <Text allowFontScaling={false} style={[styles.question, styles.questionOverlay, { color: colors.text, backgroundColor: colors.surface }]}>?</Text>
      </> : preview ? <>
        <Icon name={preview.type === "title_cover" ? "book" : "quote"} size={22} color={color} />
        <Text numberOfLines={5} {...dynamicType} style={[typography.caption, styles.clue, { color: colors.text }]}>{preview.prompt}</Text>
      </> : <Text allowFontScaling={false} style={[styles.question, { color }]}>?</Text>}
      <View style={styles.answers}>{["A", "B", "C"].map((answer) => <Text key={answer} allowFontScaling={false} style={[styles.answer, { color, borderColor: color }]}>{answer}</Text>)}</View>
    </View>;
  }
  if (kind === "tournament") {
    return <View style={styles.matchup} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Cover cover={covers[0] ?? null} rotate={-7} />
      <Text allowFontScaling={false} style={[styles.versus, { color }]}>VS</Text>
      <Cover cover={covers[1] ?? null} rotate={7} />
    </View>;
  }
  return <View style={styles.tiers} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
    <View style={styles.ladder}>{(ladder?.length ? ladder : [color, color, color]).slice(0, 5).map((tier, index) => <View key={index} style={[styles.lane, { backgroundColor: tier, width: 70 - index * 7 }]} />)}</View>
    <View style={styles.fan}>{(covers.length ? covers.slice(0, 3) : [null]).map((cover, index, fan) => <View key={index} style={[styles.fanCover, { left: 5 + index * 18 + (3 - fan.length) * 9 }]}><Cover cover={cover} rotate={(index - (fan.length - 1) / 2) * 7} /></View>)}</View>
  </View>;
}

function Cover({ cover, rotate }: { cover: RowCover | null; rotate: number }) {
  const { colors } = useTheme();
  return <View style={[styles.cover, { backgroundColor: colors.surface, borderColor: colors.border, transform: [{ rotate: `${rotate}deg` }] }]}>
    {typeof cover === "string" ? <Image source={{ uri: coverUrlForApi(cover, API_URL) }} contentFit="cover" style={StyleSheet.absoluteFill} /> : cover ? <CoverImage book={cover} /> : <Icon name="book" size={20} color={colors.textDim} />}
  </View>;
}

const styles = StyleSheet.create({
  cover: { width: 34, height: 50, borderRadius: 3, borderWidth: 1, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  tiers: { width: 80, gap: spacing.md, alignItems: "center" },
  ladder: { gap: 3, alignSelf: "flex-start", marginLeft: spacing.xs },
  lane: { height: 5, borderRadius: 2 },
  fan: { height: 58, width: 80 },
  fanCover: { position: "absolute", top: spacing.xs },
  matchup: { alignItems: "center", gap: spacing.xs, paddingVertical: spacing.md },
  versus: { fontSize: 12, fontWeight: "700", letterSpacing: 1 },
  quiz: { width: "100%", alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.sm, paddingVertical: spacing.lg, gap: spacing.sm },
  mysteryCover: { width: 54, height: 80, borderRadius: radii.sm, transform: [{ rotate: "-6deg" }] },
  question: { fontSize: 32, lineHeight: 38, minWidth: 38, textAlign: "center", borderRadius: radii.sm },
  questionOverlay: { position: "absolute", top: 38 },
  clue: { textAlign: "center", fontStyle: "italic" },
  answers: { flexDirection: "row", gap: spacing.xs },
  answer: { fontSize: 9, lineHeight: 14, width: 17, textAlign: "center", borderWidth: 1, borderRadius: 3 },
});
