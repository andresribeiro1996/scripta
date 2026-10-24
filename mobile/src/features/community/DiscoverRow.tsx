import type { ReactNode } from "react";
import { router } from "expo-router";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { Text } from "../../ui/Text";
import { readerGlyphLabel, type QuizPreview } from "@scripta/shared";
import { Icon, dynamicType, minimumTouchTarget, radii, spacing, typography, useTheme } from "../../ui";
import type { ContentTone, DiscoverItem, PublishedContent } from "@scripta/shared/community";
import { TIER_LADDER, contentStats, contentStatus, contentTarget, gameActionLabel } from "./communityHome";
import { AuthorAvatar, openProfile } from "./AuthorAvatar";
import { ReaderGlyph } from "./ReaderGlyph";
import { GameTicketArt } from "./GameTicketArt";

export function DiscoverRow({ item, linkAuthor, stats, onPreviewBooks, onOpen }: { item: DiscoverItem; linkAuthor: boolean; stats?: Array<{ value: number; label: string }>; onPreviewBooks?: (tournament: { id: string; name: string }) => void; onOpen?: () => void }) {
  const { colors } = useTheme();
  const { content, author } = item;
  const status = contentStatus(content);
  const glyphLabel = readerGlyphLabel(author.readerGlyph);
  const creator = <>
    <AuthorAvatar username={author.username} avatarUrl={author.avatarUrl} size={28} />
    <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.strong, styles.metaName, { color: colors.text }]}>{author.username}</Text>
    <ReaderGlyph identity={author.readerGlyph} size={20} />
  </>;
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
          {author.unavailable || !linkAuthor ? (
            <View style={[styles.nameRow, styles.shrink]}>
              {creator}
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={glyphLabel ? `Open ${author.username}'s profile, ${glyphLabel}` : `Open ${author.username}'s profile`}
              onPress={() => openProfile(author.username)}
              style={({ pressed }) => [styles.nameRow, styles.shrink, { backgroundColor: pressed ? colors.surfacePressed : colors.surface }]}
            >
              {creator}
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
  const clue = kind === "quiz" && preview && preview.type !== "cover_title" ? preview : undefined;
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
          <View style={{ backgroundColor: pressed ? colors.surfacePressed : colors.surface }}>
            <View style={styles.row}>
              <View style={[styles.art, { backgroundColor: soft, borderColor: colors.border }]}><GameTicketArt kind={kind} covers={covers} ladder={ladder} preview={preview} color={color} /></View>
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
                {stats.length > 0 ? <View style={[styles.statsRow, { borderColor: colors.border }]}>
                  {stats.map((stat) => (
                    <View key={stat.label} style={styles.stat}>
                      <Text {...dynamicType} style={[typography.input, styles.strong, { color: colors.text }]}>{stat.value}</Text>
                      <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{stat.label}</Text>
                    </View>
                  ))}
                </View> : null}
              </View>
            </View>
            {clue ? <View style={[styles.clue, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <View style={styles.clueHeading}><Icon name={clue.type === "title_cover" ? "book" : "quote"} size={18} color={colors.textDim} /><Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{clue.type === "title_cover" ? "Which cover belongs to this title?" : "Which book is this from?"}</Text></View>
              <Text numberOfLines={fontScale > 1.3 ? undefined : 3} {...dynamicType} style={[typography.body, { color: colors.text }]}>{clue.prompt}</Text>
            </View> : null}
          </View>
        )}
      </Pressable>
      <View style={[styles.footer, { borderColor: colors.border }]}>
        <View style={[styles.notch, styles.leftNotch, { backgroundColor: colors.background }]} />
        <View style={[styles.notch, styles.rightNotch, { backgroundColor: colors.background }]} />
        <Pressable accessibilityRole={accessibilityRole} accessibilityLabel={`${actionLabel}: ${name}`} onPress={onPress} style={({ pressed }) => [styles.primaryAction, { backgroundColor: pressed ? colors.accentFill : soft }]}>
          {({ pressed }) => <><Text {...dynamicType} style={[typography.body, styles.strong, styles.shrink, { color: pressed ? colors.text : color }]}>{actionLabel}</Text><Icon name="chevronRight" size={16} color={pressed ? colors.text : color} /></>}
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
  row: { flexDirection: "row", alignItems: "stretch", minHeight: 216 },
  art: { width: 88, alignItems: "center", justifyContent: "center", borderRightWidth: 1 },
  details: { flex: 1, padding: spacing.lg, gap: spacing.xs, justifyContent: "center" },
  shrink: { flexShrink: 1 },
  strong: { fontWeight: "600" },
  metaRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap" },
  nameRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: minimumTouchTarget, borderRadius: radii.sm },
  metaName: { flexShrink: 1 },
  statusRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.xs },
  statsRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.lg, borderTopWidth: 1, paddingTop: spacing.md, marginTop: spacing.sm },
  stat: { gap: spacing.xs, maxWidth: "100%" },
  clue: { marginHorizontal: spacing.lg, marginVertical: spacing.lg, padding: spacing.lg, borderLeftWidth: 2, borderRadius: radii.md, gap: spacing.sm },
  clueHeading: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
  badge: { borderWidth: 1, borderRadius: radii.full, paddingHorizontal: spacing.sm },
  footer: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, padding: spacing.lg, borderTopWidth: 1, borderStyle: "dashed" },
  primaryAction: { flex: 1, minWidth: 120, minHeight: spacing.huge, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radii.lg },
  secondaryAction: { minHeight: spacing.huge, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.md, paddingVertical: spacing.md, borderWidth: 1, borderRadius: radii.lg },
  notch: { position: "absolute", width: 14, height: 14, borderRadius: radii.full, top: -7 },
  leftNotch: { left: -7 },
  rightNotch: { right: -7 },
});
