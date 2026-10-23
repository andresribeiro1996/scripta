import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { recapMonthName } from "@scripta/shared";
import { Text } from "../../ui/Text";
import { IconButton, dynamicType, minimumTouchTarget, radii, spacing, typography, useTheme } from "../../ui";
import { fetchRecapIndex } from "./api";

const dismissedKey = (month: string) => `topShelfRecapDismissed:${month}`;

export function RecapHomeCard() {
  const { colors } = useTheme();
  const index = useQuery({ queryKey: ["topShelfRecaps"], queryFn: fetchRecapIndex, retry: false });
  const month = index.data?.announce ? index.data.months[0] : undefined;
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    setDismissed(null);
    if (!month) return;
    let live = true;
    AsyncStorage.getItem(dismissedKey(month)).then(
      (stored) => { if (live) setDismissed(stored !== null); },
      (reason) => { console.warn("Couldn't read the recap dismissal", reason); },
    );
    return () => { live = false; };
  }, [month]);

  if (!month || dismissed !== false) return null;
  const name = recapMonthName(month);
  const dismiss = () => {
    setDismissed(true);
    AsyncStorage.setItem(dismissedKey(month), "1").catch((reason) => { console.warn("Couldn't save the recap dismissal", reason); });
  };
  return (
    <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Play ${name} recap`} onPress={() => router.push(`/recap/${month}` as never)} style={styles.body}>
        <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>{`${name} recap is ready`}</Text>
        <Text numberOfLines={1} {...dynamicType} style={[typography.caption, { color: colors.accent }]}>▶ Play it</Text>
      </Pressable>
      <IconButton name="close" accessibilityLabel={`Dismiss ${name} recap`} onPress={dismiss} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", marginHorizontal: spacing.md, marginTop: spacing.lg, paddingLeft: spacing.md, paddingRight: spacing.xs, borderWidth: 1, borderRadius: radii.xl },
  body: { flex: 1, minWidth: 0, minHeight: minimumTouchTarget, justifyContent: "center", gap: spacing.xs },
  strong: { fontWeight: "700" },
});
