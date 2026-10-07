import { BottomSheet, RNHostView } from "@expo/ui";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, View, useWindowDimensions } from "react-native";
import { Text } from "../../ui/Text";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { captureRef, releaseCapture } from "react-native-view-shot";
import * as Sharing from "expo-sharing";
import { requestPermissionsAsync, saveToLibraryAsync } from "expo-media-library/legacy";
import QRCode from "react-native-qrcode-svg";
import { Button, Icon, type IconName, dynamicType, minimumTouchTarget, radii, spacing, typography, useTheme } from "../../ui";
import { snapshotSize } from "./shareImage";

type Props = {
  visible: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  url?: string | null;
  children?: ReactNode;
  previewControls?: ReactNode;
  imageReady?: boolean;
  onEnableLink?: () => Promise<string | void>;
  enableLinkLabel?: string;
  onDisableLink?: () => Promise<void>;
  linkError?: string | null;
  onRetryLink?: () => void;
  onExportVideo?: (pngUri: string) => Promise<string>;
};

export function ContentShareSheet({ visible, onClose, title, description, url, children, previewControls, imageReady = true, onEnableLink, enableLinkLabel = "Create share link", onDisableLink, linkError, onRetryLink, onExportVideo }: Props) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const capture = useRef<View>(null);
  const size = useRef({ width: 0, height: 0 });
  const [view, setView] = useState<"actions" | "image" | "qr">("actions");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const shareUrl = url || createdUrl;

  useEffect(() => {
    if (!visible) {
      setView("actions");
      setError(null);
      setNotice(null);
      setCreatedUrl(null);
    }
  }, [visible]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try { await action(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Sharing failed. Please try again."); }
    finally { setBusy(false); }
  }

  async function exportImage(mode: "save" | "send" | "video") {
    if (!imageReady || !capture.current) throw new Error("Wait for the image preview to finish loading.");
    if (mode === "save") {
      const permission = await requestPermissionsAsync(true, ["photo"]);
      if (!permission.granted) throw new Error("Allow saving photos in your device settings, or use Send image.");
    } else if (!await Sharing.isAvailableAsync()) {
      throw new Error("Sharing is unavailable on this device. You can save the image instead.");
    }
    const uri = await captureRef(capture, { format: "png", result: "tmpfile", ...snapshotSize(size.current.width, size.current.height) });
    try {
      if (mode === "save") {
        await saveToLibraryAsync(uri);
        setNotice("Image saved to Photos.");
      } else if (mode === "video") {
        await Sharing.shareAsync(await onExportVideo!(uri), { mimeType: "video/mp4", UTI: "public.mpeg-4", dialogTitle: title });
      } else {
        await Sharing.shareAsync(uri, { mimeType: "image/png", UTI: "public.png", dialogTitle: title });
      }
    } finally { releaseCapture(uri); }
  }

  return <BottomSheet isPresented={visible} onDismiss={() => { if (!busy) onClose(); }} snapPoints={["full"]} containerColor={colors.surface} contentPadding={0} shouldDismissOnBackPress={!busy} shouldDismissOnClickOutside={!busy}>
    <RNHostView>
      <View style={{ width: Math.min(width, 560), alignSelf: "center", flexGrow: 1, height: 0, paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: Math.max(insets.bottom, spacing.lg), gap: spacing.lg }}>
        <View style={styles.header}>
          {view !== "actions" ? <Pressable accessibilityRole="button" accessibilityLabel="Back to share options" accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => { setView("actions"); setError(null); setNotice(null); }} style={({ pressed }) => [styles.iconAction, { backgroundColor: pressed ? colors.border : colors.background, opacity: busy ? 0.5 : 1 }]}><Icon name="back" size={20} color={colors.text} /></Pressable> : null}
          {view === "actions" ? <View style={{ flex: 1 }} /> : <Text accessibilityRole="header" {...dynamicType} style={[typography.title, { color: colors.text, flex: 1, textAlign: "center", fontWeight: "600" }]}>{view === "image" ? "Image preview" : "Scan to open"}</Text>}
          <Pressable accessibilityRole="button" accessibilityLabel="Close share sheet" accessibilityState={{ disabled: busy }} disabled={busy} onPress={onClose} style={({ pressed }) => [styles.iconAction, { backgroundColor: pressed ? colors.border : colors.background, opacity: busy ? 0.5 : 1 }]}><Icon name="close" size={18} color={colors.textDim} /></Pressable>
        </View>
        {view === "image" ? <>
          {previewControls}
          {description ? <Text style={[typography.caption, { color: colors.textDim }]}>{description}</Text> : null}
          <ScrollView style={{ flex: 1, borderRadius: radii.xl, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.sm }} removeClippedSubviews={false}>
            <View ref={capture} collapsable={false} onLayout={(event) => { size.current = event.nativeEvent.layout; }} style={{ backgroundColor: colors.background }}>
              {children}
            </View>
          </ScrollView>
          <View style={{ gap: spacing.md }}>
            <View style={styles.header}>
              {!imageReady || busy ? <ActivityIndicator size="small" color={colors.accent} /> : <Icon name="confirm" size={16} color={colors.textDim} />}
              <Text accessibilityLiveRegion="polite" style={[typography.caption, { color: colors.textDim, flex: 1 }]}>{busy ? "Preparing your share…" : imageReady ? "Full image · Ready to share" : "Loading your image…"}</Text>
            </View>
            <View style={styles.actions}>
              <View style={styles.imageAction}><Button label="Save image" variant="secondary" disabled={busy || !imageReady} onPress={() => void run(() => exportImage("save"))} /></View>
              <View style={styles.imageAction}><Button label="Send image" disabled={busy || !imageReady} onPress={() => void run(() => exportImage("send"))} /></View>
              {onExportVideo ? <View style={styles.imageAction}><Button label="Send video" variant="secondary" disabled={busy || !imageReady} onPress={() => void run(() => exportImage("video"))} /></View> : null}
            </View>
          </View>
        </> : <ScrollView contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.sm }}>
          <View style={{ gap: spacing.sm, paddingVertical: spacing.sm }}>
            <Text numberOfLines={3} {...dynamicType} style={[typography.title, { color: colors.text, fontWeight: "700" }]}>{title}</Text>
            <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{view === "qr" ? "Let someone nearby scan this with their camera." : children ? "A picture to post. A link to explore." : "Invite someone to explore and take part."}</Text>
          </View>
          {description ? <View style={[styles.note, { backgroundColor: colors.background }]}><Text style={[typography.caption, { color: colors.textDim }]}>{description}</Text></View> : null}
          {linkError ? <Text accessibilityRole="alert" selectable style={{ color: colors.danger }}>{linkError}</Text> : null}
          {linkError && onRetryLink ? <Button label="Retry link" variant="secondary" disabled={busy} onPress={onRetryLink} /> : null}
          {view === "qr" && shareUrl ? <>
            <View style={[styles.qr, { backgroundColor: colors.background }]}>
              <View style={{ padding: spacing.md, backgroundColor: "white", borderRadius: radii.xl }}>
                <QRCode value={shareUrl} size={Math.min(220, width - 112)} quietZone={8} backgroundColor="white" color="black" />
              </View>
              <Text style={[typography.caption, { color: colors.textDim, alignSelf: "stretch", textAlign: "center" }]}>Open in Atmyshelf</Text>
            </View>
            <Text numberOfLines={1} ellipsizeMode="middle" style={[typography.caption, { color: colors.textDim, textAlign: "center" }]}>{shareUrl}</Text>
            <Button label="Send link instead" disabled={busy} onPress={() => void run(async () => { await Share.share({ message: shareUrl, title }); })} />
          </> : <>
            {children ? <ShareChoice icon="image" label="Share as image" detail="Made for stories, posts & group chats" primary disabled={busy} onPress={() => setView("image")} /> : null}
            {shareUrl ? <View style={styles.actions}>
              <ShareChoice icon="link" label="Send link" detail="Open the live version" disabled={busy} onPress={() => void run(async () => { await Share.share({ message: shareUrl, title }); })} />
              <ShareChoice icon="qr" label="QR code" detail="Share face to face" disabled={busy} onPress={() => setView("qr")} />
            </View> : onEnableLink ? <ShareChoice icon="link" label={enableLinkLabel} detail="Let others open the live version" disabled={busy} onPress={() => void run(async () => { const next = await onEnableLink(); if (next) setCreatedUrl(next); })} /> : null}
            {children ? <Text style={[typography.caption, { color: colors.textDim, textAlign: "center" }]}>Sharing an image keeps your visibility unchanged.</Text> : null}
            {shareUrl && onDisableLink ? <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => void run(async () => { await onDisableLink(); setCreatedUrl(null); })} style={({ pressed }) => [styles.textAction, { opacity: busy || pressed ? 0.5 : 1 }]}><Text {...dynamicType} style={[typography.caption, { color: colors.danger, alignSelf: "stretch", textAlign: "center" }]}>Stop sharing link</Text></Pressable> : null}
          </>}
          {busy ? <ActivityIndicator accessibilityLabel="Working" color={colors.accent} /> : null}
        </ScrollView>}
        {error ? <View style={[styles.note, { backgroundColor: colors.dangerSoft }]}><Text accessibilityRole="alert" selectable style={{ color: colors.text }}>{error}</Text></View> : null}
        {notice ? <View style={[styles.note, { backgroundColor: colors.successSoft }]}><Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>{notice}</Text></View> : null}
      </View>
    </RNHostView>
  </BottomSheet>;
}

function ShareChoice({ icon, label, detail, primary = false, disabled, onPress }: { icon: IconName; label: string; detail: string; primary?: boolean; disabled: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const foreground = primary ? colors.onAccent : colors.text;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={detail} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.choice, { backgroundColor: primary ? colors.accent : pressed ? colors.surfacePressed : colors.background, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 }]}>
    <View style={styles.header}>
      <View style={[styles.choiceIcon, { backgroundColor: primary ? colors.onAccent : colors.surface }]}><Icon name={icon} size={24} color={colors.accent} /></View>
      {primary ? <View style={{ flex: 1, alignItems: "flex-end" }}><Icon name="chevronRight" size={20} color={foreground} /></View> : null}
    </View>
    <View style={{ gap: spacing.xs }}>
      <Text {...dynamicType} display={false} style={[primary ? typography.title : typography.body, { color: foreground, fontWeight: "600" }]}>{label}</Text>
      <Text {...dynamicType} style={[typography.caption, { color: primary ? foreground : colors.textDim }]}>{detail}</Text>
    </View>
  </Pressable>;
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  imageAction: { flex: 1, minWidth: 120 },
  iconAction: { width: minimumTouchTarget, height: minimumTouchTarget, borderRadius: radii.full, alignItems: "center", justifyContent: "center" },
  textAction: { minHeight: minimumTouchTarget, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.sm },
  choice: { flexGrow: 1, minWidth: 130, padding: spacing.lg, gap: spacing.lg, borderRadius: radii.xl, borderCurve: "continuous" },
  choiceIcon: { width: minimumTouchTarget, height: minimumTouchTarget, borderRadius: radii.lg, alignItems: "center", justifyContent: "center" },
  note: { padding: spacing.md, borderRadius: radii.lg },
  qr: { alignItems: "center", gap: spacing.lg, paddingVertical: spacing.xxl, borderRadius: radii.xl },
});
