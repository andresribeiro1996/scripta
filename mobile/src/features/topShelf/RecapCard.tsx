import { useEffect, useState } from "react";
import { Image } from "expo-image";
import { Pressable, StyleSheet, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { TopShelfRecapCard } from "@scripta/shared";
import { Text } from "../../ui/Text";
import { MARK_VIEWBOX } from "@scripta/shared/themes";
import { MarkRects, cardFontFamily, dynamicType, minimumTouchTarget, radii, spacing, typography } from "../../ui";
import { recapCta, recapNumber, recapTitle } from "./recapModel";

export const RECAP_COLORS = { gold: "#d9a54a", text: "#e8ece9", dim: "#9aa79f", border: "#5a4a24", deep: "#3d2f12", mid: "#1a2a22", base: "#0f1512" } as const;

const SERIF = cardFontFamily("serif");

function recapCovers(card: TopShelfRecapCard): Array<string | null> {
  if (card.kind === "book") return [card.book.coverUrl];
  if (card.kind === "hottestGame") return card.game.item.content.covers.slice(0, 3);
  return [];
}

function Background() {
  return (
    <Svg style={StyleSheet.absoluteFill} preserveAspectRatio="none">
      <Defs>
        <LinearGradient id="recapBg" x1="0.2" y1="0" x2="0.8" y2="1">
          <Stop offset="0" stopColor={RECAP_COLORS.deep} />
          <Stop offset="0.55" stopColor={RECAP_COLORS.mid} />
          <Stop offset="1" stopColor={RECAP_COLORS.base} />
        </LinearGradient>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#recapBg)" />
    </Svg>
  );
}

function Glow({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} style={styles.glow} pointerEvents="none">
      <Defs>
        <RadialGradient id="recapGlow" cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={RECAP_COLORS.gold} stopOpacity={0.4} />
          <Stop offset="1" stopColor={RECAP_COLORS.gold} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect width={size} height={size} fill="url(#recapGlow)" />
    </Svg>
  );
}

function CoverImage({ uri, title, width, onSettled }: { uri: string | null; title: string; width: number; onSettled: () => void }) {
  const [failed, setFailed] = useState(!uri);
  useEffect(() => { if (!uri) onSettled(); }, [uri, onSettled]);
  const box = { width, height: width * 1.5, borderRadius: radii.md, borderWidth: 1, borderColor: RECAP_COLORS.border };
  if (uri && !failed) return <Image source={uri} style={box} contentFit="cover" onLoad={onSettled} onError={() => { setFailed(true); onSettled(); }} />;
  return <View style={[box, styles.fallback]}><Text style={{ color: RECAP_COLORS.gold, fontFamily: SERIF, fontSize: width / 3 }}>{title.charAt(0)}</Text></View>;
}

export function RecapCard({ card, month, currentMonth, url, sharing = false, onOpen, onCoversReady }: { card: TopShelfRecapCard; month: string; currentMonth: string; url?: string | null; sharing?: boolean; onOpen?: () => void; onCoversReady?: () => void }) {
  const insets = useSafeAreaInsets();
  const covers = recapCovers(card);
  const [settled, setSettled] = useState(0);
  const onSettled = useState(() => () => setSettled((count) => count + 1))[0];
  useEffect(() => { if (settled >= covers.length) onCoversReady?.(); }, [settled, covers.length, onCoversReady]);
  const title = card.kind === "book" ? card.book.title : card.kind === "hottestGame" ? card.game.item.content.name : "";
  const subtitle = card.kind === "book" ? card.book.author : card.kind === "hottestGame" ? `by ${card.game.item.author.username}` : "";
  const [coverSpace, setCoverSpace] = useState<number | null>(null);
  const coverHeightCap = card.kind === "hottestGame" ? 120 : 255;
  const coverWidth = Math.max(1, Math.floor(Math.min(coverSpace ?? coverHeightCap, coverHeightCap) / 1.5));
  const summary = card.kind === "summary" || card.kind === "dailyChapter";
  const body = (
    <View style={styles.cover} onLayout={(event) => setCoverSpace(event.nativeEvent.layout.height)}>
      {summary ? null : <Glow size={coverWidth * 3.4} />}
      <View style={styles.coverRow}>
        {covers.map((uri, index) => <CoverImage key={`${index}-${uri}`} uri={uri} title={title} width={coverWidth} onSettled={onSettled} />)}
      </View>
    </View>
  );
  const numbersText = <Text {...dynamicType} style={[summary ? styles.summaryNumbers : styles.number, { fontFamily: SERIF }]}>{recapNumber(card)}</Text>;
  const numbers = card.kind === "dailyChapter" && onOpen ? <Pressable accessibilityRole="button" accessibilityHint="Opens today's Daily Chapter" onPress={onOpen} style={styles.numbersPress}>{numbersText}</Pressable> : numbersText;
  return (
    <View style={[styles.card, sharing ? styles.sharing : styles.full, { paddingTop: sharing ? spacing.xxxl : insets.top + 64, paddingBottom: sharing ? spacing.lg : insets.bottom + spacing.xxxl }]}>
      <Background />
      <View style={[styles.main, sharing && styles.mainSharing]}>
        <Text numberOfLines={2} {...dynamicType} style={[typography.body, styles.label]}>{recapTitle(card, month)}</Text>
        {summary ? null : onOpen ? <Pressable accessibilityRole="button" accessibilityLabel={`Open ${title}`} onPress={onOpen} style={styles.coverPress}>{body}</Pressable> : body}
        {summary ? null : <View style={styles.titles}>
          <Text numberOfLines={3} style={[styles.title, { fontFamily: SERIF }]}>{title}</Text>
          <Text numberOfLines={1} {...dynamicType} style={[typography.body, { color: RECAP_COLORS.dim, alignSelf: "stretch", textAlign: "center" }]}>{subtitle}</Text>
        </View>}
        {numbers}
      </View>
      {sharing ? <View style={styles.strip}>
        {url ? <View style={styles.qr}><QRCode value={url} size={72} quietZone={4} backgroundColor="white" color="black" /></View> : null}
        <View style={styles.stripText}>
          <Text numberOfLines={3} {...dynamicType} style={[typography.body, { color: RECAP_COLORS.text, fontWeight: "600" }]}>{recapCta(card, currentMonth)}</Text>
          <Svg accessibilityLabel="Atmyshelf" width={20} height={20} viewBox={MARK_VIEWBOX}><MarkRects fill={RECAP_COLORS.gold} /></Svg>
        </View>
      </View> : <Text numberOfLines={2} {...dynamicType} style={[typography.caption, styles.hint]}>{recapCta(card, currentMonth)}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { overflow: "hidden", paddingHorizontal: spacing.xxl, justifyContent: "space-between", backgroundColor: RECAP_COLORS.base },
  sharing: { width: "100%", aspectRatio: 9 / 16 },
  full: { flex: 1 },
  main: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.xl },
  mainSharing: { gap: spacing.md },
  label: { color: RECAP_COLORS.gold, fontWeight: "700", textAlign: "center", alignSelf: "stretch" },
  cover: { flex: 1, minHeight: 0, alignSelf: "stretch", alignItems: "center", justifyContent: "center" },
  coverPress: { flex: 1, minHeight: 0, alignSelf: "stretch" },
  coverRow: { flexDirection: "row", gap: spacing.sm },
  glow: { position: "absolute" },
  fallback: { alignItems: "center", justifyContent: "center", backgroundColor: RECAP_COLORS.deep },
  titles: { gap: spacing.xs, alignSelf: "stretch" },
  title: { color: RECAP_COLORS.text, fontSize: 28, textAlign: "center", alignSelf: "stretch" },
  number: { color: RECAP_COLORS.gold, fontSize: 22, textAlign: "center", alignSelf: "stretch" },
  summaryNumbers: { color: RECAP_COLORS.text, fontSize: 28, textAlign: "center", alignSelf: "stretch" },
  numbersPress: { alignSelf: "stretch" },
  hint: { color: RECAP_COLORS.dim, textAlign: "center", alignSelf: "stretch", paddingHorizontal: minimumTouchTarget },
  strip: { flexDirection: "row", alignItems: "center", gap: spacing.lg, paddingTop: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: RECAP_COLORS.border },
  qr: { padding: spacing.xs, backgroundColor: "white", borderRadius: radii.sm },
  stripText: { flex: 1, gap: spacing.xs },
});
