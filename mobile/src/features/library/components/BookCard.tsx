// Mirrors frontend's components/BookCard.tsx — cover art, a title/author/
// status overlay, the Style/Cover buttons, selection-mode checkbox, and
// highlight-count badge. Two deliberate touch-platform adaptations, both
// called out in this task's handoff:
//
//  1. No CSS gradient scrim (no `expo-linear-gradient` in this app, and
//     adding one is a mobile/package.json change this task doesn't own)
//     — a single flat semi-transparent panel behind the text stands in,
//     sized by the same `overlayIntensity` setting.
//  2. `cardHoverEffect` has no touch equivalent for "hover" itself; it's
//     repurposed as a press-in scale/opacity response, which is the
//     nearest analogous "this is interactive" feedback on a touchscreen.
//
// Long-press (not hover) reveals the Style/Cover buttons, since a
// touchscreen has no hover state to reveal them on mount the way the web
// version's `group-hover` does — they'd otherwise have to be always-on
// clutter over every cover. Selection mode still shows its checkbox
// unconditionally, same as the web version.

import { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type { LibraryStyleSettings, PerCardStyle } from "@scripta/shared";
import { statusLabel } from "@scripta/shared";
import { cardFontFamily, resolveBorderColor, resolveBorderStyle } from "../../../ui/libraryStyle";
import { dynamicType, minimumTouchTarget, useTheme } from "../../../ui/theme";
import { CoverImage } from "./CoverImage";

function aspectRatioNumber(value: LibraryStyleSettings["cardAspectRatio"]): number {
  const [w, h] = value.split("/").map(Number);
  return w && h ? w / h : 2 / 3;
}

export function BookCard({
  book,
  onPress,
  onLongPress,
  style,
  showActions = false,
  onOpenStyle,
  onOpenCoverPicker,
  selectable = false,
  selected = false,
  onToggleSelect,
}: {
  book: Record<string, unknown>;
  onPress: () => void;
  onLongPress?: () => void;
  style: LibraryStyleSettings;
  /** Whether the Style/Cover buttons are currently revealed — driven by
   *  this card's own long-press when neither callback consumer holds
   *  open state, but the parent grid controls it so only one card's
   *  actions show at a time. */
  showActions?: boolean;
  onOpenStyle?: (book: Record<string, unknown>) => void;
  onOpenCoverPicker?: (book: Record<string, unknown>) => void;
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
  const bookStyle = book._style as PerCardStyle | undefined;
  const coverImageId = book._coverImageId as string | undefined;

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
          {selected && <Text style={styles.checkmark}>✓</Text>}
        </View>
      )}

      {!selectable && showActions && (onOpenStyle || onOpenCoverPicker) && (
        <View style={styles.actions}>
          {onOpenStyle && (
            <Pressable
              accessibilityLabel={bookStyle ? "Edit this book's custom style" : "Give this book its own style"}
              accessibilityRole="button"
              onPress={() => onOpenStyle(book)}
              style={[styles.actionButton, { backgroundColor: bookStyle ? colors.accent : "rgba(10,8,6,0.72)" }]}
            >
              <Text style={styles.actionText}>Style</Text>
            </Pressable>
          )}
          {onOpenCoverPicker && (
            <Pressable
              accessibilityLabel={coverImageId ? "Change this book's custom cover" : "Set a custom cover from your gallery"}
              accessibilityRole="button"
              onPress={() => onOpenCoverPicker(book)}
              style={[styles.actionButton, { backgroundColor: coverImageId ? colors.accent : "rgba(10,8,6,0.72)" }]}
            >
              <Text style={styles.actionText}>Cover</Text>
            </Pressable>
          )}
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
        <View style={styles.overlayScrim} pointerEvents="none">
          <View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: "#0a0806", opacity: style.overlayIntensity / 100 },
            ]}
          />
        </View>
      )}

      {showOverlayText && (
        <View style={styles.textOverlay} pointerEvents="none">
          <Text
            {...dynamicType}
            numberOfLines={2}
            style={[
              styles.title,
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
  checkmark: { color: "white", fontWeight: "700", fontSize: 13 },
  actions: { position: "absolute", top: 8, left: 8, gap: 6 },
  actionButton: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  actionText: { color: "white", fontSize: 10.5, fontWeight: "600" },
  highlightBadge: { position: "absolute", top: 8, right: 8, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: "rgba(10,8,6,0.72)" },
  overlayScrim: { position: "absolute", left: 0, right: 0, bottom: 0, height: "60%" },
  textOverlay: { position: "absolute", left: 0, right: 0, bottom: 0, padding: 12 },
  title: {},
  author: { marginTop: 2 },
  status: { marginTop: 3, fontWeight: "500" },
});
