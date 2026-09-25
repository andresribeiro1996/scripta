import { BottomSheet, RNHostView } from "@expo/ui";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ScrollView, Share, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { captureRef, releaseCapture } from "react-native-view-shot";
import * as Sharing from "expo-sharing";
import { Asset, requestPermissionsAsync } from "expo-media-library";
import QRCode from "react-native-qrcode-svg";
import { Button, dynamicType, spacing, typography, useTheme } from "../../ui";
import { snapshotSize } from "./shareImage";

type Props = {
  visible: boolean;
  onClose: () => void;
  title: string;
  url?: string | null;
  children?: ReactNode;
  previewControls?: ReactNode;
  imageReady?: boolean;
  onEnableLink?: () => Promise<string | void>;
  enableLinkLabel?: string;
  onDisableLink?: () => Promise<void>;
};

export function ContentShareSheet({ visible, onClose, title, url, children, previewControls, imageReady = true, onEnableLink, enableLinkLabel = "Create share link", onDisableLink }: Props) {
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
        await Asset.create(uri);
        setNotice("Image saved to Photos.");
      } else {
        await Sharing.shareAsync(uri, { mimeType: "image/png", UTI: "public.png", dialogTitle: title });
      }
    } finally { releaseCapture(uri); }
  }

  return <BottomSheet isPresented={visible} onDismiss={() => { if (!busy) onClose(); }} snapPoints={["full"]} containerColor={colors.surface} contentPadding={0} shouldDismissOnBackPress={!busy} shouldDismissOnClickOutside={!busy}>
    <RNHostView matchContents>
      <View style={{ height: height * 0.8, padding: spacing.lg, paddingBottom: Math.max(insets.bottom, spacing.lg), gap: spacing.md }}>
        <View style={styles.header}>
          <Text accessibilityRole="header" {...dynamicType} style={[typography.heading, { color: colors.text, flex: 1 }]}>Share {title}</Text>
          <Button label="Close" variant="secondary" disabled={busy} onPress={onClose} />
        </View>
        {view === "image" ? <>
          {previewControls}
          <ScrollView style={{ flex: 1 }} removeClippedSubviews={false}>
            <View ref={capture} collapsable={false} onLayout={(event) => { size.current = event.nativeEvent.layout; }} style={{ backgroundColor: colors.background }}>
              {children}
            </View>
          </ScrollView>
          {!imageReady ? <Text style={{ color: colors.textDim }}>Loading image preview…</Text> : null}
          <View style={styles.actions}>
            <Button label="Send image" disabled={busy || !imageReady} onPress={() => void run(() => exportImage(false))} />
            <Button label="Save image" variant="secondary" disabled={busy || !imageReady} onPress={() => void run(() => exportImage(true))} />
          </View>
        </> : <ScrollView contentContainerStyle={{ gap: spacing.md }}>
          {view === "qr" && shareUrl ? <View style={styles.qr}>
            <QRCode value={shareUrl} size={220} quietZone={16} backgroundColor="white" color="black" />
            <Text selectable style={[typography.caption, { color: colors.text, textAlign: "center" }]}>Scan to open {title}</Text>
          </View> : null}
          {shareUrl ? <>
            <Button label="Send link" disabled={busy} onPress={() => void run(async () => { await Share.share({ message: shareUrl, title }); })} />
            <Text selectable style={[typography.caption, { color: colors.textDim }]}>{shareUrl}</Text>
          </> : onEnableLink ? <>
            <Text style={{ color: colors.textDim }}>Creating a link lets other people open this content. Sharing an image keeps its visibility unchanged.</Text>
            <Button label={enableLinkLabel} disabled={busy} onPress={() => void run(async () => { const next = await onEnableLink(); if (next) setCreatedUrl(next); })} />
          </> : null}
          {children ? <Button label="Share as image" variant="secondary" disabled={busy} onPress={() => setView("image")} /> : null}
          {shareUrl && view !== "qr" ? <Button label="Show QR" variant="secondary" disabled={busy} onPress={() => setView("qr")} /> : null}
          {shareUrl && onDisableLink ? <Button label="Stop sharing link" variant="destructive" disabled={busy} onPress={() => void run(async () => { await onDisableLink(); setCreatedUrl(null); setView("actions"); })} /> : null}
        </ScrollView>}
        {view !== "actions" ? <Button label="Back to share options" variant="secondary" disabled={busy} onPress={() => setView("actions")} /> : null}
        {error ? <Text accessibilityRole="alert" selectable style={{ color: colors.danger }}>{error}</Text> : null}
        {notice ? <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>{notice}</Text> : null}
      </View>
    </RNHostView>
  </BottomSheet>;
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  qr: { alignItems: "center", gap: spacing.md, paddingVertical: spacing.lg },
});
