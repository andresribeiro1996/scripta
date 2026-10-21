import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { router, useSegments } from "expo-router";
import { ActivityIndicator, Pressable, StyleSheet, View, type GestureResponderEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { contentTarget } from "@scripta/shared/community";
import { ApiError } from "../../core/api";
import { ErrorState, Icon, minimumTouchTarget, radii, spacing } from "../../ui";
import { ContentShareSheet } from "../sharing/ContentShareSheet";
import { publicContentUrl } from "../sharing/links";
import { workPath } from "../works/workPath";
import { fetchRecap, fetchRecapIndex } from "./api";
import { RECAP_COLORS, RecapCard } from "./RecapCard";
import { recapLinkPath, recapTitle } from "./recapModel";

const missing = (error: unknown) => error instanceof ApiError && (error.status === 404 || error.status === 400);

export function RecapScreen({ month }: { month: string }) {
  const insets = useSafeAreaInsets();
  const segments = useSegments();
  const [index, setIndex] = useState(0);
  const [width, setWidth] = useState(0);
  const [sharing, setSharing] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkAttempt, setLinkAttempt] = useState(0);
  const [coversReady, setCoversReady] = useState(false);
  const recap = useQuery({ queryKey: ["topShelfRecap", month], queryFn: () => fetchRecap(month), retry: false });
  const recapIndex = useQuery({ queryKey: ["topShelfRecaps"], queryFn: fetchRecapIndex, retry: false });
  const cards = recap.data?.cards ?? [];
  const card = cards[Math.min(index, cards.length - 1)];
  const unknown = missing(recap.error) || (recap.isSuccess && cards.length === 0);

  const close = () => (router.canGoBack() ? router.back() : router.replace("/top-shelf" as never));

  useEffect(() => {
    if (unknown) router.replace("/top-shelf" as never);
  }, [unknown]);

  useEffect(() => {
    setShareUrl(null);
    setLinkError(null);
  }, [card]);

  useEffect(() => {
    setCoversReady(false);
  }, [card, sharing]);

  useEffect(() => {
    if (!sharing || !card) return;
    let active = true;
    void publicContentUrl(recapLinkPath(card)).then((url) => { if (active) { setShareUrl(url); setLinkError(null); } }).catch((reason) => { if (active) setLinkError(reason instanceof Error ? reason.message : "Couldn't create a public link."); });
    return () => { active = false; };
  }, [sharing, card, linkAttempt]);

  const onCoversReady = useCallback(() => setCoversReady(true), []);

  if (unknown) return <View style={styles.root} />;
  if (recap.isError || recapIndex.isError) {
    return <View style={[styles.root, styles.center]}>
      <ErrorState body="Couldn't load this recap." actionLabel="Retry" onAction={() => { void recap.refetch(); void recapIndex.refetch(); }} />
      <CloseButton top={insets.top} onPress={close} />
    </View>;
  }
  if (!card || !recapIndex.data) return <View style={[styles.root, styles.center]}><ActivityIndicator color={RECAP_COLORS.gold} /></View>;

  const currentMonth = recapIndex.data.currentMonth;
  const last = cards.length - 1;
  const back = () => setIndex((value) => Math.max(0, value - 1));
  const forward = () => {
    if (index < last) setIndex((value) => value + 1);
    else close();
  };
  const step = (event: GestureResponderEvent) => (event.nativeEvent.pageX < width / 2 ? back() : forward());
  const open = () => {
    if (card.kind === "book") router.push(workPath(card.book.workId, segments) as never);
    else if (card.kind === "hottestGame") router.push(contentTarget(card.game.item.content) as never);
  };

  return (
    <View style={styles.root} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      <Pressable accessibilityRole="button" accessibilityLabel="Next card" accessibilityHint="Tap the left side to go back, the right side to go on" accessibilityActions={[{ name: "previous", label: "Previous card" }]} onAccessibilityAction={back} style={styles.fill} onPress={step}>
        <RecapCard card={card} month={month} currentMonth={currentMonth} onOpen={card.kind === "summary" ? undefined : open} />
      </Pressable>
      <View pointerEvents="none" style={[styles.dots, { top: insets.top + spacing.md }]}>
        {cards.map((_, position) => <View key={position} style={[styles.dot, { backgroundColor: position <= index ? RECAP_COLORS.gold : RECAP_COLORS.border }]} />)}
      </View>
      <CloseButton top={insets.top + spacing.lg} onPress={close} />
      <Pressable accessibilityRole="button" accessibilityLabel="Share this card" onPress={() => setSharing(true)} style={[styles.share, { bottom: insets.bottom + spacing.lg }]}>
        <Icon name="share" size={20} color={RECAP_COLORS.gold} />
      </Pressable>
      <ContentShareSheet visible={sharing} onClose={() => setSharing(false)} title={recapTitle(card, month)} url={shareUrl} linkError={linkError} onRetryLink={() => setLinkAttempt((value) => value + 1)} imageReady={shareUrl !== null && coversReady}>
        {shareUrl ? <RecapCard sharing card={card} month={month} currentMonth={currentMonth} url={shareUrl} onCoversReady={onCoversReady} /> : null}
      </ContentShareSheet>
    </View>
  );
}

function CloseButton({ top, onPress }: { top: number; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel="Close recap" onPress={onPress} style={[styles.close, { top }]}><Icon name="close" size={20} color={RECAP_COLORS.text} /></Pressable>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: RECAP_COLORS.base },
  center: { alignItems: "center", justifyContent: "center" },
  fill: { flex: 1 },
  dots: { position: "absolute", left: spacing.lg, right: spacing.lg + minimumTouchTarget, flexDirection: "row", gap: spacing.xs },
  dot: { flex: 1, height: 3, borderRadius: radii.full },
  close: { position: "absolute", right: spacing.sm, width: minimumTouchTarget, height: minimumTouchTarget, alignItems: "center", justifyContent: "center" },
  share: { position: "absolute", right: spacing.lg, width: minimumTouchTarget, height: minimumTouchTarget, borderRadius: radii.full, borderWidth: 1, borderColor: RECAP_COLORS.border, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(15,21,18,0.7)" },
});
