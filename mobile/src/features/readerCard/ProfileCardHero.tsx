import { useId, useMemo, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop, SvgXml } from "react-native-svg";
import { cardRatio, readerCardShine, renderReaderCard, resolvePrint, type IdentityKey, type ReaderCardBase } from "@scripta/shared";
import { cardFontFamily, dynamicType, Skeleton, spacing, typography, useTheme } from "../../ui";
import { Text } from "../../ui/Text";
import { useT } from "../../i18n";
import { ReaderGlyph } from "../community/ReaderGlyph";
import { CARD_MONO_FAMILY, CARD_SCRIPT_FAMILY } from "../../ui/fontAssets";
import { CardShine } from "../murals/CardShine";
import { PLATE_RATIO, ReaderCardImage } from "../murals/ReaderCardImage";
import { readerCardXml } from "../murals/readerCardXml";
import { ReaderCardViewer } from "../murals/ReaderCardViewer";
import { backdropXml } from "./backdropXml";

const BACKDROP_OPACITY = 1;
const CARD_WIDTH_SHARE = 0.55;
const CARD_WIDTH_MAX = 220;

const heroCardWidth = (width: number) => Math.min(width * CARD_WIDTH_SHARE, CARD_WIDTH_MAX);

export function ProfileCardBackdrop({ input }: { input: ReaderCardBase }) {
  const { colors, mode } = useTheme();
  const fadeId = useId().replace(/\W/g, "");
  const backdrop = useMemo(
    () => backdropXml(readerCardXml(renderReaderCard({ ...input, print: resolvePrint(input.style.print, mode === "dark") }), { serif: cardFontFamily("playfairDisplay"), sans: cardFontFamily("sans"), mono: CARD_MONO_FAMILY, script: CARD_SCRIPT_FAMILY })),
    [input, mode],
  );
  return (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
      <SvgXml xml={backdrop} width="100%" height="100%" style={[StyleSheet.absoluteFill, styles.backdrop]} />
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" viewBox="0 0 1 1" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id={fadeId} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.background} stopOpacity={0} />
            <Stop offset="0.55" stopColor={colors.background} stopOpacity={0} />
            <Stop offset="1" stopColor={colors.background} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect width="1" height="1" fill={`url(#${fadeId})`} />
      </Svg>
    </View>
  );
}

export function ProfileCardHero({ input, width, withBackdrop = true, badge, onEdit, children }: { input: ReaderCardBase; width: number; withBackdrop?: boolean; badge?: ReactNode; onEdit?: () => void; children?: ReactNode }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const cardWidth = heroCardWidth(width);
  const cardHeight = cardWidth * cardRatio(input.crop);
  const shine = readerCardShine(input.style.finish);
  return (
    <View style={[styles.hero, { width }]}>
      {withBackdrop ? <ProfileCardBackdrop input={input} /> : null}
      <View style={styles.band}>
        <View style={{ width: cardWidth, height: cardHeight }}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("readerCard.openCard")} onPress={() => setOpen(true)}>
            <ReaderCardImage input={input} width={cardWidth} />
            {shine ? <CardShine kind={shine} width={cardWidth} height={cardHeight} live={false} /> : null}
          </Pressable>
          {badge ? <View style={styles.badge}>{badge}</View> : null}
        </View>
      </View>
      {children ? <View style={styles.children}>{children}</View> : null}
      {open ? <ReaderCardViewer input={input} onClose={() => setOpen(false)} onEdit={onEdit ? () => { setOpen(false); onEdit(); } : undefined} /> : null}
    </View>
  );
}

export function ProfileHeroIdentity({ username, glyph, finished }: { username: string; glyph?: IdentityKey; finished?: number }) {
  const t = useT();
  const { colors } = useTheme();
  return (
    <View style={styles.identity}>
      <View style={styles.nameRow}>
        <Text numberOfLines={1} {...dynamicType} style={[typography.heading, styles.name, { color: colors.text }]}>{username}</Text>
        <ReaderGlyph identity={glyph} />
      </View>
      {finished === undefined ? null : <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{t("readerCard.booksRead", { count: finished })}</Text>}
    </View>
  );
}

export function ProfileCardSkeleton({ width }: { width: number }) {
  const cardWidth = heroCardWidth(width);
  return (
    <View style={[styles.hero, { width }]}>
      <View style={styles.band}>
        <Skeleton width={cardWidth} height={cardWidth * PLATE_RATIO} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { gap: spacing.md, overflow: "hidden", paddingTop: spacing.xl, paddingBottom: spacing.md },
  band: { alignItems: "center" },
  badge: { position: "absolute", right: -spacing.md, bottom: -spacing.md },
  backdrop: { opacity: BACKDROP_OPACITY },
  children: { paddingHorizontal: spacing.lg, gap: spacing.md, alignItems: "center" },
  identity: { alignItems: "center", gap: spacing.xs, maxWidth: "100%" },
  nameRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, maxWidth: "100%" },
  name: { flexShrink: 1, fontFamily: cardFontFamily("sans"), fontWeight: "700" },
});
