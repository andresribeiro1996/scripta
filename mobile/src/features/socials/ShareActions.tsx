import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "../../ui/Text";
import { Button } from "../../ui";
import { spacing, typography, useTheme } from "../../ui/theme";
import { useT } from "../../i18n";
import { postToSocial } from "./api";
import { useSocials } from "./useSocials";

export function ShareActions({ message }: { message: string }) {
  const t = useT();
  const { data = [] } = useSocials();
  const { colors } = useTheme();
  const [notice, setNotice] = useState<{ message: string; tone: "success" | "error" } | null>(null);
  const [posting, setPosting] = useState<"x" | "threads" | null>(null);
  const connected = (provider: "x" | "threads") => data.some((status) => status.provider === provider && status.connected);

  async function post(provider: "x" | "threads") {
    setPosting(provider);
    setNotice(null);
    try {
      const result = await postToSocial(provider, message);
      setNotice({ message: result.postUrl ? t("sharing.postedWithLink", { url: result.postUrl }) : t("sharing.posted"), tone: "success" });
    } catch (reason) {
      setNotice({ message: t("sharing.postFailed", { reason: reason instanceof Error ? reason.message : t("sharing.tryAgainSentence") }), tone: "error" });
    } finally {
      setPosting(null);
    }
  }

  if (!connected("x") && !connected("threads") && !notice) return null;

  return (
    <View style={styles.actions}>
      {connected("x") ? <Button label={t("sharing.postToX")} loading={posting === "x"} onPress={() => void post("x")} /> : null}
      {connected("threads") ? <Button label={t("sharing.postToThreads")} loading={posting === "threads"} onPress={() => void post("threads")} /> : null}
      {notice ? <Text accessibilityRole="alert" selectable style={[typography.caption, { color: notice.tone === "success" ? colors.success : colors.danger }]}>{notice.message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({ actions: { gap: spacing.sm } });
