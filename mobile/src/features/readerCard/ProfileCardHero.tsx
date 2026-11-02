import { useId, useMemo, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop, SvgXml } from "react-native-svg";
import { hasChosen, renderReaderCard, resolvePrint, type ReaderCardBase } from "@scripta/shared";
import { cardFontFamily, spacing, useTheme } from "../../ui";
import { CARD_MONO_FAMILY, CARD_SCRIPT_FAMILY } from "../../ui/fontAssets";
import { readerCardXml } from "../murals/readerCardXml";
import { ReaderCardTurner } from "../murals/ReaderCardTurner";
import { backdropXml } from "./backdropXml";

const BACKDROP_OPACITY = 0.7;
const CARD_WIDTH_SHARE = 0.78;
const CARD_WIDTH_MAX = 320;

export function ProfileCardHero({ input, width, children }: { input: ReaderCardBase; width: number; children?: ReactNode }) {
  const { colors, mode } = useTheme();
  const fadeId = useId().replace(/\W/g, "");
  const backdrop = useMemo(
    () => backdropXml(readerCardXml(renderReaderCard({ ...input, print: resolvePrint(input.style.print, mode === "dark") }), { serif: cardFontFamily("playfairDisplay"), sans: cardFontFamily("sans"), mono: CARD_MONO_FAMILY, script: CARD_SCRIPT_FAMILY })),
    [input, mode],
  );
  const cardWidth = Math.min(width * CARD_WIDTH_SHARE, CARD_WIDTH_MAX);
  return (
    <View style={[styles.hero, { width }]}>
      <View style={styles.band}>
        <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
          <SvgXml xml={backdrop} width="100%" height="100%" style={[StyleSheet.absoluteFill, styles.backdrop]} />
          <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" viewBox="0 0 1 1" preserveAspectRatio="none">
            <Defs>
              <LinearGradient id={fadeId} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={colors.background} stopOpacity={0} />
                <Stop offset="1" stopColor={colors.background} stopOpacity={1} />
              </LinearGradient>
            </Defs>
            <Rect width="1" height="1" fill={`url(#${fadeId})`} />
          </Svg>
        </View>
        <ReaderCardTurner key={`${input.view}-${input.style.layout}-${hasChosen(input.card.chosen)}`} input={input} width={cardWidth} />
      </View>
      {children ? <View style={styles.children}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { gap: spacing.md },
  band: { alignItems: "center", overflow: "hidden", paddingTop: spacing.xl, paddingBottom: spacing.xs },
  backdrop: { opacity: BACKDROP_OPACITY },
  children: { paddingHorizontal: spacing.lg, gap: spacing.md },
});
