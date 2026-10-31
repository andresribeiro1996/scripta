import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Stack, router } from "expo-router";
import { Text } from "../../ui/Text";
import { useAuth } from "../../core/auth";
import { ConfirmDialog, Icon, Screen, Sheet, dynamicType, minimumTouchTarget, radii, spacing, typography, useTheme, type IconName } from "../../ui";
import { FontPicker } from "../settings/FontPicker";
import { LanguagePicker } from "../settings/LanguagePicker";
import { ThemePicker } from "../settings/ThemePicker";
import { SocialsSection } from "../socials";
import { ProfileHeader } from "./ProfileHeader";

type Card = { label: string; icon: IconName } & ({ href: string } | { sheet: "appearance" | "socials" });

const CARDS: Card[] = [
  { label: "Your shelf", href: "/me", icon: "shelf" },
  { label: "Murals", href: "/murals", icon: "murals" },
  { label: "Reader card", href: "/reader-card", icon: "readerCard" },
  { label: "Gallery", href: "/gallery", icon: "image" },
  { label: "Appearance", sheet: "appearance", icon: "theme" },
  { label: "Socials", sheet: "socials", icon: "link" },
];

export function YouScreen() {
  const { colors } = useTheme();
  const { signOut } = useAuth();
  const [sheet, setSheet] = useState<"appearance" | "socials" | null>(null);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmSignOut() {
    setSignOutOpen(false);
    setError(null);
    try {
      await signOut();
      router.replace("/(public)/login");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Something went wrong.");
    }
  }

  return (
    <Screen top={false}>
      <Stack.Screen options={{ headerShown: true, title: "You" }} />
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <ProfileHeader />
        <View style={styles.grid}>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          {CARDS.map((card) => (
            <View key={card.label} style={styles.cell}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={card.label}
                onPress={() => ("href" in card ? router.push(card.href as never) : setSheet(card.sheet))}
                style={({ pressed }) => [styles.card, pressed ? { backgroundColor: colors.surfacePressed } : null]}
              >
                <Icon name={card.icon} size={44} color={colors.accent} />
                <Text {...dynamicType} numberOfLines={1} style={[typography.body, styles.label, { color: colors.text }]}>{card.label}</Text>
              </Pressable>
            </View>
          ))}
        </View>
        <View style={[styles.rows, { borderColor: colors.border }]}>
          <Pressable accessibilityRole="button" onPress={() => router.push("/account-security")} style={({ pressed }) => [styles.row, { borderColor: colors.border, backgroundColor: pressed ? colors.surfacePressed : "transparent" }]}>
            <Text {...dynamicType} style={[typography.body, styles.grow, { color: colors.text }]}>Account and security</Text>
            <Icon name="chevronRight" size={18} color={colors.textDim} />
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => setSignOutOpen(true)} style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.surfacePressed : "transparent" }]}>
            <Text {...dynamicType} style={[typography.body, { color: colors.danger }]}>Sign out</Text>
          </Pressable>
        </View>
        {error ? <Text accessibilityRole="alert" style={[typography.caption, styles.center, { color: colors.danger }]}>{error}</Text> : null}
      </ScrollView>
      <Sheet visible={sheet === "appearance"} title="Appearance" onClose={() => setSheet(null)}>
        <ScrollView contentContainerStyle={styles.sheetBody}>
          <ThemePicker />
          <FontPicker slot="display" />
          <FontPicker slot="text" />
          <LanguagePicker />
        </ScrollView>
      </Sheet>
      <Sheet visible={sheet === "socials"} title="Socials" onClose={() => setSheet(null)}>
        <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
          <SocialsSection />
        </ScrollView>
      </Sheet>
      <ConfirmDialog visible={signOutOpen} title="Sign out" body="Sign out of Atmyshelf on this device?" confirmLabel="Sign out" destructive onConfirm={() => void confirmSignOut()} onCancel={() => setSignOutOpen(false)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.lg, paddingBottom: spacing.huge, gap: spacing.xl },
  center: { textAlign: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  divider: { position: "absolute", left: "50%", top: spacing.md, bottom: spacing.md, width: 1 },
  cell: { width: "50%", alignItems: "center", paddingVertical: spacing.md },
  card: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radii.lg },
  label: { alignSelf: "stretch", fontWeight: "600", textAlign: "center" },
  rows: { borderTopWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: "row", alignItems: "center", minHeight: minimumTouchTarget, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  grow: { flex: 1 },
  sheetBody: { gap: spacing.lg, paddingTop: spacing.sm },
});
