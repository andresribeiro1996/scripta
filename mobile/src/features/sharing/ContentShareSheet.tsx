import { BottomSheet, RNHostView } from "@expo/ui";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, ScrollView, Share, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { captureRef, releaseCapture } from "react-native-view-shot";
import * as Sharing from "expo-sharing";
import { requestPermissionsAsync, saveToLibraryAsync } from "expo-media-library/legacy";
import QRCode from "react-native-qrcode-svg";
import { Button, dynamicType, minimumTouchTarget, radii, spacing, typography, useTheme } from "../../ui";
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
};

export function ContentShareSheet({ visible, onClose, title, description, url, children, previewControls, imageReady = true, onEnableLink, enableLinkLabel = "Create share link", onDisableLink, linkError, onRetryLink }: Props) {
  const { colors } = useTheme();
  const { height } = useWindowDimensions();
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

  async function exportImage(save: boolean) {
    if (!imageReady || !capture.current) throw new Error("Wait for the image preview to finish loading.");
    if (save) {
      const permission = await requestPermissionsAsync(true, ["photo"]);
      if (!permission.granted) throw new Error("Allow saving photos in your device settings, or use Send image.");
    } else if (!await Sharing.isAvailableAsync()) {
      throw new Error("Image sharing is unavailable on this device. You can save the image instead.");
    }
    const uri = await captureRef(capture, { format: "png", result: "tmpfile", ...snapshotSize(size.current.width, size.current.height) });
    try {
      if (save) {
        await saveToLibraryAsync(uri);
        setNotice("Image saved to Photos.");
      } else {
        await Sharing.shareAsync(uri, { mimeType: "image/png", UTI: "public.png", dialogTitle: title });
      }
    } finally { releaseCapture(uri); }
  }

  return <BottomSheet isPresented={visible} onDismiss={() => { if (!busy) onClose(); }} snapPoints={view === "image" ? ["full"] : undefined} containerColor={colors.surface} contentPadding={0} shouldDismissOnBackPress={!busy} shouldDismissOnClickOutside={!busy}>
    <RNHostView matchContents>
      <View style={{ height: view === "image" ? height * 0.8 : Math.min(height * 0.75, view === "qr" ? 520 : 440), padding: spacing.lg, paddingBottom: Math.max(insets.bottom, spacing.lg), gap: spacing.lg }}>
        <View style={styles.header}>
          <View style={{ flex: 1, gap: spacing.xs }}>
            <Text accessibilityRole="header" {...dynamicType} style={[typography.heading, { color: colors.text, fontWeight: "600" }]}>{view === "image" ? "Image preview" : view === "qr" ? "Scan to open" : "Share"}</Text>
            <Text numberOfLines={2} {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{title}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={view === "actions" ? "Close share sheet" : "Back to share options"} disabled={busy} onPress={view === "actions" ? onClose : () => { setView("actions"); setError(null); setNotice(null); }} style={styles.textAction}>
            <Text {...dynamicType} style={[typography.body, { color: colors.accent, opacity: busy ? 0.5 : 1 }]}>{view === "actions" ? "Close" : "Back"}</Text>
          </Pressable>
        </View>
        {description ? <Text style={[typography.caption, { color: colors.textDim }]}>{description}</Text> : null}
        {view === "image" ? <>
          {previewControls}
          <ScrollView style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, backgroundColor: colors.background }} removeClippedSubviews={false}>
            <View ref={capture} collapsable={false} onLayout={(event) => { size.current = event.nativeEvent.layout; }} style={{ backgroundColor: colors.background }}>
              {children}
            </View>
          </ScrollView>
          {!imageReady ? <Text style={{ color: colors.textDim }}>Loading image preview…</Text> : null}
          <View style={styles.actions}>
            <View style={styles.imageAction}><Button label="Send image" disabled={busy || !imageReady} onPress={() => void run(() => exportImage(false))} /></View>
            <View style={styles.imageAction}><Button label="Save image" variant="secondary" disabled={busy || !imageReady} onPress={() => void run(() => exportImage(true))} /></View>
          </View>
        </> : <ScrollView contentContainerStyle={{ gap: spacing.lg }}>
          {linkError ? <Text accessibilityRole="alert" selectable style={{ color: colors.danger }}>{linkError}</Text> : null}
          {linkError && onRetryLink ? <Button label="Retry link" variant="secondary" disabled={busy} onPress={onRetryLink} /> : null}
          {view === "qr" && shareUrl ? <View style={styles.qr}>
            <QRCode value={shareUrl} size={220} quietZone={16} backgroundColor="white" color="black" />
            <Text style={[typography.body, { color: colors.textDim, textAlign: "center" }]}>Use another phone’s camera to open the link.</Text>
            <Text selectable style={[typography.caption, { color: colors.textDim, textAlign: "center" }]}>{shareUrl}</Text>
          </View> : null}
          {children && view === "actions" ? <View style={{ gap: spacing.sm }}>
            <Button label="Share as image" disabled={busy} onPress={() => setView("image")} />
            <Text style={[typography.caption, { color: colors.textDim, textAlign: "center" }]}>Preview, send, or save. Your visibility stays the same.</Text>
          </View> : null}
          {shareUrl ? <>
            <Button label="Send link" variant={children && view === "actions" ? "secondary" : "primary"} disabled={busy} onPress={() => void run(async () => { await Share.share({ message: shareUrl, title }); })} />
          </> : onEnableLink ? <>
            <View style={{ gap: spacing.sm, borderTopWidth: 1, borderColor: colors.border, paddingTop: spacing.lg }}>
              <Text style={[typography.body, { color: colors.textDim }]}>Want people to open it too? Create a public link.</Text>
              <Button label={enableLinkLabel} variant="secondary" disabled={busy} onPress={() => void run(async () => { const next = await onEnableLink(); if (next) setCreatedUrl(next); })} />
            </View>
          </> : null}
          {shareUrl && view !== "qr" ? <Pressable accessibilityRole="button" disabled={busy} onPress={() => setView("qr")} style={styles.textAction}><Text {...dynamicType} style={[typography.body, { color: colors.accent }]}>Show QR code</Text></Pressable> : null}
          {shareUrl && onDisableLink && view === "actions" ? <Pressable accessibilityRole="button" disabled={busy} onPress={() => void run(async () => { await onDisableLink(); setCreatedUrl(null); })} style={styles.textAction}><Text {...dynamicType} style={[typography.caption, { color: colors.danger }]}>Stop sharing link</Text></Pressable> : null}
        </ScrollView>}
        {error ? <Text accessibilityRole="alert" selectable style={{ color: colors.danger }}>{error}</Text> : null}
        {notice ? <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>{notice}</Text> : null}
      </View>
    </RNHostView>
  </BottomSheet>;
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  imageAction: { flex: 1, minWidth: 120 },
  textAction: { minHeight: minimumTouchTarget, minWidth: minimumTouchTarget, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.sm },
  qr: { alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm },
});
