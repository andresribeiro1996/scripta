// No clipboard dependency in this app yet (mobile/package.json is
// forbidden) — a read-only, selectable TextInput lets the user long-press
// to copy manually, and RN's own Share API covers "send this somewhere"
// without needing one at all.

import { useState } from "react";
import { Alert, Text, View } from "react-native";
import { Button, Input } from "../../../ui/components";
import { spacing, typography, useTheme } from "../../../ui/theme";
import { ShareActions } from "../../socials";

export function ShareSheetBody({
  title,
  shareToken,
  shareUrl,
  onShare,
  onUnshare,
}: {
  title: string;
  shareToken: string | null;
  shareUrl: string | null;
  onShare: () => Promise<{ shareToken: string; shareUrl: string }>;
  onUnshare: () => Promise<void>;
}) {
  const { colors } = useTheme();
  const [current, setCurrent] = useState<{ shareToken: string; shareUrl: string } | null>(shareToken && shareUrl ? { shareToken, shareUrl } : null);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [unsharing, setUnsharing] = useState(false);

  async function handleShare() {
    setShareError(null);
    setSharing(true);
    try {
      setCurrent(await onShare());
    } catch (err) {
      setShareError(err instanceof Error ? err.message : "Couldn't create a share link.");
    } finally {
      setSharing(false);
    }
  }

  function handleStopSharing() {
    Alert.alert("Stop sharing this link?", "Anyone who already has the link will lose access to it.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Stop sharing",
        style: "destructive",
        onPress: () => {
          setUnsharing(true);
          onUnshare()
            .then(() => setCurrent(null))
            .catch(() => Alert.alert("Couldn't stop sharing — try again."))
            .finally(() => setUnsharing(false));
        },
      },
    ]);
  }

  if (!current) {
    return (
      <View style={{ gap: spacing.md }}>
        <Text style={[typography.body, { color: colors.textDim }]}>Create a public link anyone can view — no account needed on their end.</Text>
        <Button label={sharing ? "Creating…" : "Create share link"} loading={sharing} onPress={() => void handleShare()} />
        {shareError && <Text style={[typography.caption, { color: colors.danger }]}>{shareError}</Text>}
      </View>
    );
  }

  return (
    <View style={{ gap: spacing.md }}>
      <Input label="Share link" value={current.shareUrl} editable={false} selectTextOnFocus />
      <ShareActions message={current.shareUrl} title={title} />
      <Button label={unsharing ? "Stopping…" : "Stop sharing"} variant="destructive" loading={unsharing} onPress={handleStopSharing} />
    </View>
  );
}
