import type { ReactNode } from "react";
import { router } from "expo-router";
import { Image } from "expo-image";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "../../ui/Text";
import { readerGlyphLabel } from "@scripta/shared";
import { dynamicType, minimumTouchTarget, radii, spacing, typography, useTheme } from "../../ui";
import type { ContentTone, DiscoverItem, PublishedContent } from "@scripta/shared/community";
import { TIER_LADDER, contentKindLabel, contentStats, contentStatus, contentTarget } from "./communityHome";
import { openProfile } from "./AuthorAvatar";
import { ReaderGlyph } from "./ReaderGlyph";
import { CoverImage } from "../library/components/CoverImage";

export function DiscoverRow({ item, linkAuthor, onPreviewBooks, onOpen }: { item: DiscoverItem; linkAuthor: boolean; onPreviewBooks?: (tournament: { id: string; name: string }) => void; onOpen?: () => void }) {
  const { colors } = useTheme();
  const { content, author } = item;
  const status = contentStatus(content);
  const glyphLabel = readerGlyphLabel(author.readerGlyph);
  return (
    <GameRow
      kind={content.kind}
      name={content.name}
      accessibilityRole="link"
      onPress={() => { onOpen?.(); router.push(contentTarget(content) as never); }}
      covers={content.covers}
      ladder={content.kind === "tierlist" ? TIER_LADDER : undefined}
      meta={
        <View style={styles.metaRow}>
          <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>
            {contentKindLabel(content)} ·{" "}
          </Text>
          {author.unavailable || !linkAuthor ? (
            <View style={[styles.nameRow, styles.shrink]}>
              <Text numberOfLines={1} {...dynamicType} style={[typography.caption, styles.metaName, { color: colors.textDim }]}>
                {author.username}
              </Text>
              <ReaderGlyph identity={author.readerGlyph} />
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={glyphLabel ? `Open ${author.username}'s profile, ${glyphLabel}` : `Open ${author.username}'s profile`}
              hitSlop={{ top: 14, bottom: 14, left: spacing.sm, right: spacing.sm }}
              onPress={() => openProfile(author.username)}
              style={[styles.nameRow, styles.shrink]}
            >
              <Text numberOfLines={1} {...dynamicType} style={[typography.caption, styles.metaName, { color: colors.textDim }]}>
                {author.username}
              </Text>
              <ReaderGlyph identity={author.readerGlyph} />
            </Pressable>
          )}
        </View>
      }
      badges={status.votedBadge ? [status, { label: "Voted", tone: "info" }] : [status]}
      stats={contentStats(content)}
      seeBooks={content.kind === "tournament" && onPreviewBooks ? { label: `See all ${content.bookCount} books in ${content.name}`, onPress: () => onPreviewBooks({ id: content.id, name: content.name }) } : undefined}
    />
  );
}

export type RowCover = string | Record<string, unknown>;

export type GameRowProps = {
  kind: PublishedContent["kind"];
  name: string;
  meta: ReactNode;
  badges: Array<{ label: string; tone: ContentTone }>;
  caption?: string;
  stats?: Array<{ value: number; label: string }>;
  covers: RowCover[];
  ladder?: string[];
  seeBooks?: { label: string; onPress: () => void };
  accessibilityRole?: "link" | "button";
  onPress: () => void;
  onDelete?: () => void;
};

export function GameRow({ kind, name, meta, badges, caption, stats = [], covers, ladder, seeBooks, accessibilityRole = "button", onPress, onDelete }: GameRowProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole={accessibilityRole}
      accessibilityLabel={`Open ${name}`}
      onPress={onPress}
      onLongPress={onDelete}
      accessibilityHint={onDelete ? "Long-press to delete" : undefined}
      accessibilityActions={onDelete ? [{ name: "delete", label: "Delete" }] : undefined}
      onAccessibilityAction={onDelete ? (event) => { if (event.nativeEvent.actionName === "delete") onDelete(); } : undefined}
    >
      {({ pressed }) => (
        <View style={[styles.row, { backgroundColor: pressed ? colors.surfacePressed : "transparent", borderBottomColor: colors.border }]}>
          {kind === "tournament" ? <TournamentThumb covers={covers} /> : <FanThumb covers={covers} ladder={ladder} />}
          <View style={styles.grow}>
            <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>
              {name}
            </Text>
            {typeof meta === "string" ? (
              <Text numberOfLines={1} {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>
                {meta}
              </Text>
            ) : meta}
            <View style={styles.statusRow}>
              {badges.map((badge) => <StatusBadge key={badge.label} label={badge.label} tone={badge.tone} />)}
              {caption ? (
                <Text numberOfLines={1} {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{caption}</Text>
              ) : null}
              {stats.map((stat) => (
                <Text key={stat.label} numberOfLines={1} {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>
                  <Text style={[styles.strong, { color: colors.text }]}>{stat.value}</Text> {stat.label}
                </Text>
              ))}
              {seeBooks ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={seeBooks.label}
                  hitSlop={{ top: 14, bottom: 14, left: spacing.sm, right: spacing.sm }}
                  onPress={seeBooks.onPress}
                  style={styles.rowAction}
                >
                  <Text numberOfLines={1} {...dynamicType} style={[typography.caption, styles.strong, { color: colors.accent }]}>See books</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        </View>
      )}
    </Pressable>
  );
}

export function StatusBadge({ label, tone }: { label: string; tone: ContentTone }) {
  const { colors } = useTheme();
  const palette = {
    neutral: { borderColor: colors.border, backgroundColor: colors.surface, color: colors.textDim },
    accent: { borderColor: colors.accent, backgroundColor: colors.accentSoft, color: colors.accent },
    info: { borderColor: colors.info, backgroundColor: colors.infoSoft, color: colors.info },
    success: { borderColor: colors.success, backgroundColor: colors.successSoft, color: colors.success },
    reference: { borderColor: colors.reference, backgroundColor: colors.referenceSoft, color: colors.reference },
  }[tone];
  return (
    <View style={[styles.badge, { borderColor: palette.borderColor, backgroundColor: palette.backgroundColor }]}>
      <Text numberOfLines={1} {...dynamicType} style={[typography.caption, styles.strong, { color: palette.color }]}>
        {label}
      </Text>
    </View>
  );
}

function FanThumb({ covers, ladder }: { covers: RowCover[]; ladder?: string[] }) {
  const { colors } = useTheme();
  const fan: Array<RowCover | null> = covers.length ? covers.slice(0, 3) : [null];
  const middle = (fan.length - 1) / 2;
  return (
    <View style={styles.thumb} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      {ladder?.length ? (
        <View style={styles.ladder}>
          {ladder.map((color, index) => (
            <View key={index} style={[styles.grow, { backgroundColor: color }]} />
          ))}
        </View>
      ) : null}
      {fan.map((cover, index) => (
        <Cover
          key={index}
          cover={cover}
          style={{
            left: FAN_INSET + index * FAN_STEP + (3 - fan.length) * (FAN_STEP / 2),
            top: (THUMB_HEIGHT - FAN_HEIGHT) / 2,
            width: FAN_WIDTH,
            height: FAN_HEIGHT,
            zIndex: index,
            borderColor: colors.background,
            transform: [{ rotate: `${(index - middle) * FAN_TILT}deg` }],
          }}
        />
      ))}
    </View>
  );
}

function TournamentThumb({ covers }: { covers: RowCover[] }) {
  const { colors } = useTheme();
  return (
    <View style={styles.thumb} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      {[covers[0] ?? null, covers[1] ?? null].map((cover, index) => (
        <Cover
          key={index}
          cover={cover}
          style={{ left: index * (PAIR_WIDTH + PAIR_GAP), top: (THUMB_HEIGHT - PAIR_HEIGHT) / 2, width: PAIR_WIDTH, height: PAIR_HEIGHT, borderColor: colors.background }}
        />
      ))}
      <View style={[styles.versus, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text allowFontScaling={false} style={[styles.versusText, { color: colors.text }]}>VS</Text>
      </View>
    </View>
  );
}

function Cover({ cover, style }: { cover: RowCover | null; style: object }) {
  const { colors } = useTheme();
  if (typeof cover === "string") return <Image source={{ uri: cover }} contentFit="cover" style={[styles.cover, style]} />;
  return (
    <View style={[styles.cover, style, { backgroundColor: colors.border }, cover && styles.clip]}>
      {cover ? <CoverImage book={cover} /> : null}
    </View>
  );
}

const THUMB_WIDTH = 64;
const THUMB_HEIGHT = 58;
const LADDER_WIDTH = 4;
const FAN_INSET = LADDER_WIDTH + 6;
const FAN_WIDTH = 34;
const FAN_HEIGHT = 51;
const FAN_STEP = (THUMB_WIDTH - FAN_INSET - FAN_WIDTH) / 2;
const FAN_TILT = 6;
const PAIR_GAP = 4;
const PAIR_WIDTH = (THUMB_WIDTH - PAIR_GAP) / 2;
const PAIR_HEIGHT = 45;
const VERSUS_WIDTH = 26;

const styles = StyleSheet.create({
  grow: { flex: 1 },
  shrink: { flexShrink: 1 },
  strong: { fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1 },
  metaRow: { flexDirection: "row", alignItems: "center" },
  nameRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  metaName: { flexShrink: 1 },
  statusRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.xs },
  rowAction: { minHeight: minimumTouchTarget - spacing.lg, justifyContent: "center", paddingVertical: spacing.xs },
  badge: { borderWidth: 1, borderRadius: radii.full, paddingHorizontal: spacing.sm },
  thumb: { width: THUMB_WIDTH, height: THUMB_HEIGHT },
  ladder: { position: "absolute", left: 0, top: (THUMB_HEIGHT - FAN_HEIGHT) / 2, width: LADDER_WIDTH, height: FAN_HEIGHT, borderRadius: 2, overflow: "hidden" },
  cover: { position: "absolute", borderRadius: 3, borderWidth: 1 },
  clip: { overflow: "hidden" },
  versus: { position: "absolute", left: (THUMB_WIDTH - VERSUS_WIDTH) / 2, top: THUMB_HEIGHT / 2 - 9, width: VERSUS_WIDTH, height: 18, borderRadius: radii.full, borderWidth: 1, alignItems: "center", justifyContent: "center", zIndex: 10 },
  versusText: { fontSize: 10, fontWeight: "700", letterSpacing: 1 },
});
