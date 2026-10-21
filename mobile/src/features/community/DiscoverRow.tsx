import type { ReactNode } from "react";
import { router } from "expo-router";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { Text } from "../../ui/Text";
import { readerGlyphLabel, type QuizPreview } from "@scripta/shared";
import { Icon, dynamicType, minimumTouchTarget, radii, spacing, typography, useTheme } from "../../ui";
import type { ContentTone, DiscoverItem, PublishedContent } from "@scripta/shared/community";
import { TIER_LADDER, contentStats, contentStatus, contentTarget, gameActionLabel } from "./communityHome";
import { openProfile } from "./AuthorAvatar";
import { ReaderGlyph } from "./ReaderGlyph";
import { GameTicketArt } from "./GameTicketArt";

export function DiscoverRow({ item, linkAuthor, stats, onPreviewBooks, onOpen }: { item: DiscoverItem; linkAuthor: boolean; stats?: Array<{ value: number; label: string }>; onPreviewBooks?: (tournament: { id: string; name: string }) => void; onOpen?: () => void }) {
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
      preview={content.kind === "quiz" ? content.preview : undefined}
      actionLabel={gameActionLabel(content)}
      ladder={content.kind === "tierlist" ? TIER_LADDER : undefined}
      meta={
        <View style={styles.metaRow}>
          <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>
            by{" "}
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
      stats={stats ?? contentStats(content)}
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
  preview?: QuizPreview;
  actionLabel?: string;
  seeBooks?: { label: string; onPress: () => void };
  accessibilityRole?: "link" | "button";
  onPress: () => void;
  onDelete?: () => void;
};

export function GameRow({ kind, name, meta, badges, caption, stats = [], covers, ladder, preview, actionLabel = "Open game", seeBooks, accessibilityRole = "button", onPress, onDelete }: GameRowProps) {
  const { colors } = useTheme();
  const { fontScale } = useWindowDimensions();
  const color = kind === "quiz" ? colors.reference : kind === "tierlist" ? colors.success : colors.accent;
  const soft = kind === "quiz" ? colors.referenceSoft : kind === "tierlist" ? colors.successSoft : colors.accentSoft;
  return (
    <View style={[styles.ticket, { backgroundColor: colors.surface }]}>
      <Pressable
        accessibilityRole={accessibilityRole}
        accessibilityLabel={`${kind === "tierlist" ? "Tier list" : kind === "tournament" ? "Tournament" : "Quiz"}: ${name}`}
        onPress={onPress}
        onLongPress={onDelete}
        accessibilityHint={onDelete ? "Long-press to delete" : preview?.type !== "cover_title" ? preview?.prompt : undefined}
        accessibilityActions={onDelete ? [{ name: "delete", label: "Delete" }] : undefined}
        onAccessibilityAction={onDelete ? (event) => { if (event.nativeEvent.actionName === "delete") onDelete(); } : undefined}
      >
        {({ pressed }) => (
          <View style={[styles.row, { backgroundColor: pressed ? colors.surfacePressed : colors.surface }]}>
            <View style={[styles.art, { backgroundColor: soft }]}><GameTicketArt kind={kind} covers={covers} ladder={ladder} preview={preview} color={color} /></View>
            <View style={styles.details}>
              <Text numberOfLines={fontScale > 1.3 ? undefined : 2} {...dynamicType} style={[typography.title, styles.strong, { color: colors.text }]}>
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
              </View>
              <View style={styles.statsRow}>
                {stats.map((stat) => (
                  <Text key={stat.label} numberOfLines={1} {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>
                    <Text style={[styles.strong, { color: colors.text }]}>{stat.value}</Text> {stat.label}
                  </Text>
                ))}
              </View>
            </View>
          </View>
        )}
      </Pressable>
      <View style={[styles.footer, { borderColor: colors.border }]}>
        <View style={[styles.notch, styles.leftNotch, { backgroundColor: colors.background }]} />
        <View style={[styles.notch, styles.rightNotch, { backgroundColor: colors.background }]} />
        <Pressable accessibilityRole={accessibilityRole} accessibilityLabel={`${actionLabel}: ${name}`} onPress={onPress} style={({ pressed }) => [styles.primaryAction, { backgroundColor: pressed ? colors.surfacePressed : soft }]}>
          <Text {...dynamicType} style={[typography.body, styles.strong, styles.shrink, { color }]}>{actionLabel}</Text><Icon name="chevronRight" size={16} color={color} />
        </Pressable>
        {seeBooks ? <Pressable accessibilityRole="button" accessibilityLabel={seeBooks.label} onPress={seeBooks.onPress} style={({ pressed }) => [styles.secondaryAction, { borderColor: colors.border, backgroundColor: pressed ? colors.surfacePressed : colors.surface }]}><Text {...dynamicType} style={[typography.body, styles.strong, { color: colors.textDim }]}>See books</Text></Pressable> : null}
      </View>
    </View>
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

const styles = StyleSheet.create({
  ticket: { marginHorizontal: spacing.lg, marginVertical: spacing.sm, borderRadius: radii.xl, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "stretch", minHeight: 152 },
  art: { width: 88, alignItems: "center", justifyContent: "center" },
  details: { flex: 1, padding: spacing.lg, gap: spacing.sm, justifyContent: "center" },
  shrink: { flexShrink: 1 },
  strong: { fontWeight: "600" },
  metaRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap" },
  nameRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, minHeight: minimumTouchTarget },
  metaName: { flexShrink: 1 },
  statusRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm },
  statsRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  badge: { borderWidth: 1, borderRadius: radii.full, paddingHorizontal: spacing.sm },
  footer: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, padding: spacing.lg, borderTopWidth: 1, borderStyle: "dashed" },
  primaryAction: { flex: 1, minWidth: 120, minHeight: spacing.huge, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radii.lg },
  secondaryAction: { minHeight: spacing.huge, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.md, paddingVertical: spacing.md, borderWidth: 1, borderRadius: radii.lg },
  notch: { position: "absolute", width: 14, height: 14, borderRadius: radii.full, top: -7 },
  leftNotch: { left: -7 },
  rightNotch: { right: -7 },
});
