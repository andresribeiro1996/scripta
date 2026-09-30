// Mirrors frontend's components/BookCard.tsx — cover art, a title/author/
// status overlay, selection-mode checkbox, and highlight-count badge. Two
// deliberate touch-platform adaptations:
//
//  1. The web card's CSS gradient scrim is drawn as a react-native-svg
//     linear gradient (no `expo-linear-gradient` in this app), its peak
//     opacity set by the same `overlayIntensity` setting.
//  2. `cardHoverEffect` has no touch equivalent for "hover" itself; it's
//     repurposed as a press-in scale/opacity response, which is the
//     nearest analogous "this is interactive" feedback on a touchscreen.
//
// Selection mode shows its checkbox unconditionally, same as the web
// version.

import { useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { Text } from "../../../ui/Text";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import type { LibraryStyleSettings } from "@scripta/shared";
import { statusLabel } from "@scripta/shared";
import { cardFontFamily, resolveBorderColor, resolveBorderStyle } from "../../../ui/libraryStyle";
import { dynamicType, minimumTouchTarget, useTheme } from "../../../ui/theme";
import { CoverImage } from "./CoverImage";
import { scrimStops } from "./scrim";

function aspectRatioNumber(value: LibraryStyleSettings["cardAspectRatio"]): number {
  const [w, h] = value.split("/").map(Number);
  return w && h ? w / h : 2 / 3;
}

export function BookCard({
  book,
  onPress,
  onLongPress,
  style,
  selectable = false,
  selected = false,
  onToggleSelect,
}: {
  book: Record<string, unknown>;
  onPress: () => void;
  onLongPress?: () => void;
  style: LibraryStyleSettings;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (book: Record<string, unknown>) => void;
}) {
  const { colors } = useTheme();
  const [hasCover, setHasCover] = useState(false);
  const label = statusLabel(book.ReadStatus);
  const highlights = Array.isArray(book.highlights) ? book.highlights.length : 0;
  const showOverlayText = style.showTitleAuthor || !hasCover;
  const overlayTextColor = style.cardTextColor ?? "#ffffff";

  const borderWidthFor = (side: keyof LibraryStyleSettings["cardBorderSides"]) =>
    style.cardBorderSides[side] ? style.cardBorderWidth : 0;

  return (
    <Pressable
      accessibilityLabel={`${String(book.Title ?? "Untitled")}, ${String(book.Attribution ?? "Unknown author")}, ${label}${
        highlights > 0 ? `, ${highlights} highlight${highlights === 1 ? "" : "s"}` : ""
      }`}
      accessibilityRole="button"
      accessibilityState={selectable ? { selected } : undefined}
      onPress={selectable ? () => onToggleSelect?.(book) : onPress}
      onLongPress={selectable ? undefined : onLongPress}
      style={({ pressed }) => [
        styles.card,
        {
          aspectRatio: aspectRatioNumber(style.cardAspectRatio),
          borderRadius: style.cardRadius,
          opacity: (style.cardOpacity / 100) * (pressed && style.cardHoverEffect ? 0.85 : 1),
          borderTopWidth: borderWidthFor("top"),
          borderRightWidth: borderWidthFor("right"),
          borderBottomWidth: borderWidthFor("bottom"),
          borderLeftWidth: borderWidthFor("left"),
          borderStyle: style.cardBorderWidth > 0 ? resolveBorderStyle(style.cardBorderStyle) : "solid",
          borderColor: resolveBorderColor(style.cardBorderColor, style.cardBorderOpacity, colors.border),
          backgroundColor: colors.border,
          ...(style.cardShadow ? cardShadow : null),
          ...(pressed && style.cardHoverEffect ? { transform: [{ scale: 0.98 }] } : null),
          ...(selected ? { outlineWidth: 3, outlineColor: colors.accent, outlineStyle: "solid", outlineOffset: 2 } : null),
        },
      ]}
    >
      <CoverImage book={book} onHasCoverChange={setHasCover} />

      {selectable && (
        <View
          style={[
            styles.checkbox,
            { borderColor: selected ? colors.accent : "rgba(255,255,255,0.7)", backgroundColor: selected ? colors.accent : "rgba(10,8,6,0.4)" },
          ]}
        >
          {selected && <Text style={[styles.checkmark, { color: colors.onAccent }]}>✓</Text>}
        </View>
      )}

      {highlights > 0 && (
        <View style={styles.highlightBadge} pointerEvents="none">
          <Text style={styles.actionText}>
            {highlights} highlight{highlights === 1 ? "" : "s"}
          </Text>
        </View>
      )}

      {showOverlayText && (
        <Svg pointerEvents="none" style={StyleSheet.absoluteFill} width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 1 1">
          <Defs>
            <LinearGradient id="scrim" x1="0" y1="1" x2="0" y2="0">
              {scrimStops(style.overlayIntensity).map((stop) => (
                <Stop key={stop.offset} offset={stop.offset} stopColor="#0a0806" stopOpacity={stop.opacity} />
              ))}
            </LinearGradient>
          </Defs>
          <Rect width="1" height="1" fill="url(#scrim)" />
        </Svg>
      )}

      {showOverlayText && (
        <View style={styles.textOverlay} pointerEvents="none">
          <Text
            {...dynamicType}
            numberOfLines={2}
            style={[
              styles.title,
              styles.shadow,
              {
                color: overlayTextColor,
                fontFamily: cardFontFamily(style.cardFontFamily),
                fontSize: style.cardFontSize * 1.15,
                fontWeight: style.cardBold ? "700" : "600",
                fontStyle: style.cardItalic ? "italic" : "normal",
              },
            ]}
          >
            {String(book.Title ?? "Untitled")}
          </Text>
          <Text
            {...dynamicType}
            numberOfLines={1}
            style={[
              styles.author,
              styles.shadow,
              {
                color: overlayTextColor,
                opacity: 0.82,
                fontFamily: cardFontFamily(style.cardFontFamily),
                fontSize: style.cardFontSize * 0.9,
                fontWeight: style.cardBold ? "700" : "400",
                fontStyle: style.cardItalic ? "italic" : "normal",
              },
            ]}
          >
            {String(book.Attribution ?? "Unknown author")}
          </Text>
          <Text
            {...dynamicType}
            style={[
              styles.status,
              styles.shadow,
              {
                color: overlayTextColor,
                opacity: 0.6,
                fontFamily: cardFontFamily(style.cardFontFamily),
                fontSize: style.cardFontSize * 0.8,
                fontWeight: style.cardBold ? "700" : "500",
                fontStyle: style.cardItalic ? "italic" : "normal",
              },
            ]}
          >
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const cardShadow = Platform.select({
  ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 4 },
  android: { elevation: 2 },
  default: {},
});

const styles = StyleSheet.create({
  card: { overflow: "hidden", minWidth: minimumTouchTarget, minHeight: minimumTouchTarget },
  checkbox: {
    position: "absolute",
    top: 8,
    left: 8,
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  checkmark: { fontWeight: "700", fontSize: 13 },
  actionText: { color: "white", fontSize: 10.5, fontWeight: "600" },
  highlightBadge: { position: "absolute", top: 8, right: 8, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: "rgba(10,8,6,0.72)" },
  textOverlay: { position: "absolute", left: 0, right: 0, bottom: 0, padding: 12 },
  shadow: { textShadowColor: "rgba(0,0,0,0.55)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  title: {},
  author: { marginTop: 2 },
  status: { marginTop: 3, fontWeight: "500" },
});
