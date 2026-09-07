import { useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { Button } from "../../ui";
import { spacing } from "../../ui/theme";
import { postToSocial, shareNatively } from "./api";
import { useSocials } from "./useSocials";

export function ShareActions({ message, title }: { message: string; title?: string }) {
  const { data = [] } = useSocials();
  const [posting, setPosting] = useState<"x" | "threads" | null>(null);
  const connected = (provider: "x" | "threads") => data.some((status) => status.provider === provider && status.connected);

  async function post(provider: "x" | "threads") {
    setPosting(provider);
    try {
      const result = await postToSocial(provider, message);
      Alert.alert("Posted", result.postUrl ? `Your post is live: ${result.postUrl}` : "Your post is live.");
    } catch (reason) {
      Alert.alert("Couldn't post", reason instanceof Error ? reason.message : "Try again.");
    } finally {
      setPosting(null);
    }
  }

  return (
    <View style={styles.actions}>
      <Button label="Share…" variant="secondary" onPress={() => void shareNatively(message, title)} />
      {connected("x") ? <Button label="Post to X" loading={posting === "x"} onPress={() => void post("x")} /> : null}
      {connected("threads") ? <Button label="Post to Threads" loading={posting === "threads"} onPress={() => void post("threads")} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({ actions: { gap: spacing.sm } });
