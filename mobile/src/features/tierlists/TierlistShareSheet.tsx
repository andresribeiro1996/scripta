import { useRef, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import * as Clipboard from "expo-clipboard";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import QRCode from "react-native-qrcode-svg";
import { captureRef } from "react-native-view-shot";
import type { TierlistData } from "@scripta/shared";
import { Button, Sheet } from "../../ui";
import { palettes, radii, spacing, typography, useTheme } from "../../ui/theme";
import { ShareActions } from "../socials";
import { renderTierlistShareVideo } from "./api";
import { keyOf, titleOf, type TierBook } from "./TierBoard";

export function TierlistShareSheet({ visible, onClose, id, name, code, data, books }: { visible: boolean; onClose: () => void; id: string; name: string; code: string; data: TierlistData; books: TierBook[] }) {
  const card = useRef<View>(null);
  const [busy, setBusy] = useState<"image" | "video" | null>(null);
  const [copied, setCopied] = useState(false);
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const cardWidth = Math.min(240, width - 48);
  const voteUrl = `https://atmyshelf.com/vote/${encodeURIComponent(code)}`;
  const bookTitles = new Map(books.map((book) => [keyOf(book), titleOf(book)]));
  const bookCount = data.pool.length + data.tiers.reduce((count, tier) => count + tier.bookKeys.length, 0);
  const featured = [...data.tiers.flatMap((tier) => tier.bookKeys), ...data.pool].slice(0, 2).map((key) => bookTitles.get(key)).filter(Boolean).join(" · ");

  async function shareCard(kind: "image" | "video") {
    setBusy(kind);
    try {
      if (!card.current || !await Sharing.isAvailableAsync()) throw new Error("Sharing isn't available on this device.");
      const uri = await captureRef(card, { format: "png", result: "tmpfile" });
      if (kind === "image") {
        await Sharing.shareAsync(uri, { mimeType: "image/png" });
      } else {
        const { base64 } = await renderTierlistShareVideo(id, uri);
        const file = new File(Paths.cache, `tierlist-${Date.now()}.mp4`);
        file.create();
        file.write(base64, { encoding: "base64" });
        await Sharing.shareAsync(file.uri, { mimeType: "video/mp4" });
      }
    } catch (reason) {
      Alert.alert(kind === "video" ? "Couldn't share video" : "Couldn't share image", reason instanceof Error ? reason.message : "Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function copyLink() {
    try {
      await Clipboard.setStringAsync(voteUrl);
      setCopied(true);
    } catch (reason) {
      Alert.alert("Couldn't copy link", reason instanceof Error ? reason.message : "Try again.");
    }
  }

  return <Sheet visible={visible} title="Share tier list" onClose={onClose}>
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <View ref={card} collapsable={false} style={[styles.card, { width: cardWidth, height: cardWidth * 16 / 9 }]}>
        <View style={styles.cardTop}>
          <Text style={styles.brand}>ATMYSHELF  /  COMMUNITY VOTE</Text>
          <Text numberOfLines={2} style={styles.cardTitle}>{name}</Text>
          <Text style={styles.cardSubhead}>Where do these books belong?</Text>
          <View style={styles.voteBox}>
            <View style={styles.voteCopy}>
              <Text style={styles.voteLabel}>SCAN OR VISIT TO VOTE</Text>
              <Text numberOfLines={3} style={styles.voteUrl}>atmyshelf.com/vote/{code}</Text>
            </View>
            <QRCode value={voteUrl} size={54} quietZone={3} backgroundColor="#fff" />
          </View>
        </View>
        <View style={styles.board}>
          <Text style={styles.boardHeading}>{bookCount} BOOKS  ·  {data.tiers.length} TIERS</Text>
          {data.tiers.slice(0, 4).map((tier) => <View key={tier.id} style={styles.tier}>
            <View style={[styles.tierLabel, { backgroundColor: tier.color }]}><Text numberOfLines={1} style={styles.tierText}>{tier.label}</Text></View>
            <Text numberOfLines={1} style={styles.tierBooks}>{tier.bookKeys.slice(0, 2).map((key) => bookTitles.get(key)).filter(Boolean).join(" · ") || "Your pick"}</Text>
          </View>)}
          {data.tiers.length > 4 ? <Text style={styles.more}>+ {data.tiers.length - 4} more tiers</Text> : null}
        </View>
        {featured ? <View style={styles.cardBottom}><Text numberOfLines={2} style={styles.featured}>Featuring {featured}</Text></View> : null}
      </View>
      <Text style={[styles.hint, { color: colors.textDim }]}>Choose TikTok or Instagram in your phone's share menu. Copy the voting link into your post or profile so people can vote.</Text>
      <View style={styles.actions}>
        <Button label="Share Reel video…" loading={busy === "video"} disabled={busy !== null} onPress={() => void shareCard("video")} />
        <Button label="Share image…" variant="secondary" loading={busy === "image"} disabled={busy !== null} onPress={() => void shareCard("image")} />
        <Button label={copied ? "Link copied" : "Copy voting link"} variant="secondary" onPress={() => void copyLink()} />
        <Text selectable style={[styles.link, { color: colors.text }]}>{voteUrl}</Text>
        <ShareActions message={voteUrl} title={name} />
      </View>
    </ScrollView>
  </Sheet>;
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0, flexShrink: 1 },
  content: { alignItems: "center", gap: spacing.md, paddingBottom: spacing.sm },
  card: { backgroundColor: palettes.light.background, padding: spacing.lg, justifyContent: "space-between", overflow: "hidden" },
  cardTop: { gap: spacing.sm },
  brand: { ...typography.caption, fontSize: 9, letterSpacing: 1, fontWeight: "700", color: palettes.light.accent },
  cardTitle: { fontSize: 24, lineHeight: 27, fontWeight: "700", color: palettes.light.text },
  cardSubhead: { ...typography.body, color: palettes.light.textDim },
  voteBox: { backgroundColor: palettes.light.accentSoft, borderRadius: radii.md, padding: spacing.sm, gap: spacing.xs, flexDirection: "row", alignItems: "center" },
  voteCopy: { flex: 1, gap: spacing.xs },
  board: { gap: spacing.xs },
  boardHeading: { fontSize: 9, letterSpacing: 1, fontWeight: "700", color: palettes.light.textDim, marginBottom: spacing.xs },
  tier: { height: 34, flexDirection: "row", backgroundColor: palettes.light.surface, borderRadius: radii.sm, overflow: "hidden", alignItems: "center" },
  tierLabel: { width: 42, height: "100%", justifyContent: "center", alignItems: "center", paddingHorizontal: 2 },
  tierText: { fontSize: 10, fontWeight: "700", color: "#fff", textAlign: "center" },
  tierBooks: { flex: 1, paddingHorizontal: spacing.sm, fontSize: 10, color: palettes.light.text },
  more: { fontSize: 9, color: palettes.light.textDim, textAlign: "right" },
  cardBottom: { borderTopWidth: 1, borderColor: palettes.light.border, paddingTop: spacing.sm, gap: spacing.xs },
  featured: { fontSize: 10, lineHeight: 13, color: palettes.light.textDim },
  voteLabel: { fontSize: 10, letterSpacing: 1, fontWeight: "700", color: palettes.light.accent },
  voteUrl: { fontSize: 13, lineHeight: 16, fontWeight: "700", color: palettes.light.text },
  hint: { ...typography.caption, alignSelf: "stretch" },
  actions: { width: "100%", gap: spacing.sm },
  link: { ...typography.caption, textAlign: "center" },
});
