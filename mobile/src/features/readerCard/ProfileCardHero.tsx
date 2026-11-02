import { useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop, SvgXml } from "react-native-svg";
import { cardRatio, readerCardGround, readerCardShine, renderReaderCard, resolvePrint, type IdentityKey, type ReaderCardBase } from "@scripta/shared";
import { cardFontFamily, dynamicType, Skeleton, spacing, typography, useTheme } from "../../ui";
import { Text } from "../../ui/Text";
import { useT } from "../../i18n";
import { AuthorAvatar } from "../community/AuthorAvatar";
import { ReaderGlyph } from "../community/ReaderGlyph";
import { CARD_MONO_FAMILY, CARD_SCRIPT_FAMILY } from "../../ui/fontAssets";
import { CardShine } from "../murals/CardShine";
import { PLATE_RATIO, ReaderCardImage } from "../murals/ReaderCardImage";
import { readerCardXml } from "../murals/readerCardXml";
import { ReaderCardViewer } from "../murals/ReaderCardViewer";
import { backdropXml, viewBlurSupported } from "./backdropXml";

const TAP_SLOP = 10;
const BACKDROP_GROW = 0.16;
const BACKDROP_BLUR = 0.085;
const BACKDROP_SATURATE = 1.4;
const OVERLAY_TINT = 0.08;
const OVERLAY_FROM = 0.2;
const OVERLAY_TO = 0.98;
const CARD_WIDTH_SHARE = 0.55;
const CARD_WIDTH_MAX = 220;

const heroCardWidth = (width: number) => Math.min(width * CARD_WIDTH_SHARE, CARD_WIDTH_MAX);

export function ProfileCardBackdrop({ input }: { input: ReaderCardBase }) {
  const { colors, mode } = useTheme();
  const fadeId = useId().replace(/\W/g, "");
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const blurs = viewBlurSupported(Platform.OS, Platform.Version);
  const print = resolvePrint(input.style.print, mode === "dark");
  const ground = useMemo(() => (blurs ? null : readerCardGround({ ...input, print })), [blurs, input, print]);
  const backdrop = useMemo(
    () => (blurs ? backdropXml(readerCardXml(renderReaderCard({ ...input, print }), { serif: cardFontFamily("playfairDisplay"), sans: cardFontFamily("sans"), mono: CARD_MONO_FAMILY, script: CARD_SCRIPT_FAMILY })) : null),
    [blurs, input, print],
  );
  const grow = size ? -size.width * BACKDROP_GROW : 0;
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={(event) => setSize(event.nativeEvent.layout)}
      style={[StyleSheet.absoluteFill, styles.clip]}
    >
      {ground ? <View style={[StyleSheet.absoluteFill, { backgroundColor: ground }]} /> : size && backdrop ? (
        <View style={{ position: "absolute", top: grow, left: grow, width: size.width - 2 * grow, height: size.height - 2 * grow, filter: [{ blur: size.width * BACKDROP_BLUR }, { saturate: BACKDROP_SATURATE }] }}>
          <SvgXml xml={backdrop} width="100%" height="100%" />
        </View>
      ) : null}
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" viewBox="0 0 1 1" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id={fadeId} x1="0" y1="0" x2="0" y2="1">
            <Stop offset={OVERLAY_FROM} stopColor={colors.background} stopOpacity={0} />
            <Stop offset={OVERLAY_TO} stopColor={colors.background} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect width="1" height="1" fill="#000" fillOpacity={OVERLAY_TINT} />
        <Rect width="1" height="1" fill={`url(#${fadeId})`} />
      </Svg>
    </View>
  );
}

export function ProfileCardHero({ input, width, withBackdrop = true, badge, onEdit, children }: { input: ReaderCardBase; width: number; withBackdrop?: boolean; badge?: ReactNode; onEdit?: () => void; children?: ReactNode }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const pressX = useRef<number | null>(null);
  const cardWidth = heroCardWidth(width);
  const cardHeight = cardWidth * cardRatio(input.crop);
  const shine = readerCardShine(input.style.finish);
  return (
    <View style={[styles.hero, { width }]}>
      {withBackdrop ? <ProfileCardBackdrop input={input} /> : null}
      <View style={styles.band}>
        <View style={{ width: cardWidth, height: cardHeight }}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("readerCard.openCard")} onPressIn={(event) => { pressX.current = event.nativeEvent.pageX; }} onPress={(event) => { if (pressX.current === null || Math.abs(event.nativeEvent.pageX - pressX.current) < TAP_SLOP) setOpen(true); pressX.current = null; }}>
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

export function ProfileHeroIdentity({ username, avatarUrl, glyph, finished }: { username: string; avatarUrl: string | null; glyph?: IdentityKey; finished?: number }) {
  const t = useT();
  const { colors } = useTheme();
  return (
    <View style={styles.identity}>
      <View style={styles.nameRow}>
        <AuthorAvatar username={username} avatarUrl={avatarUrl} size={32} />
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
  clip: { overflow: "hidden" },
  children: { paddingHorizontal: spacing.lg, gap: spacing.md, alignItems: "center" },
  identity: { alignItems: "center", gap: spacing.xs, maxWidth: "100%" },
  nameRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, maxWidth: "100%" },
  name: { flexShrink: 1, fontFamily: cardFontFamily("sans"), fontWeight: "700" },
});
