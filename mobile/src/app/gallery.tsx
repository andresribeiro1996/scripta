import { useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  Input,
  Menu,
  ModalBody,
  OfflineBanner,
  Sheet,
  Skeleton,
  Toast,
  dynamicType,
  spacing,
  typography,
  useTheme,
} from "../ui";
import { Redirect, useLocalSearchParams } from "expo-router";
import { GalleryScreen as GalleryFeatureScreen } from "../features/gallery";
import { useAuth } from "../core/auth";

const buttonFixtures = [
  { label: "Primary", variant: "primary" as const },
  { label: "Secondary", variant: "secondary" as const },
  { label: "Delete", variant: "destructive" as const },
  { label: "Loading", variant: "primary" as const, loading: true },
  { label: "Disabled", variant: "secondary" as const, disabled: true },
];

export default function GalleryRoute() {
  const { ui } = useLocalSearchParams<{ ui?: string }>();
  const { ready, user } = useAuth();
  if (__DEV__ && ui === "1") return <UiGalleryScreen />;
  if (!ready) return <View style={styles.center}><ActivityIndicator size="large" /></View>;
  if (!user) return <Redirect href="/(public)/login" />;
  if (!user.username) return <Redirect href="/choose-username" />;
  return <GalleryFeatureScreen />;
}

function UiGalleryScreen() {
  const { colors } = useTheme();
  const [overlay, setOverlay] = useState<"sheet" | "dialog" | null>(null);
  const [toast, setToast] = useState(false);

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.page}>
      <Text accessibilityRole="header" {...dynamicType} style={[styles.heading, { color: colors.text }]}>Scripta UI gallery</Text>

      <Section title="Buttons">
        {buttonFixtures.map((fixture) => <Button key={fixture.label} {...fixture} onPress={() => undefined} />)}
      </Section>

      <Section title="Inputs">
        <Input label="Title" placeholder="Book title" />
        <Input label="Disabled" value="Unavailable" editable={false} />
        <Input label="With error" value="Bad value" error="Enter a valid title." />
      </Section>

      <Section title="Overlays">
        <Button label="Open sheet" variant="secondary" onPress={() => setOverlay("sheet")} />
        <Button label="Open dialog" variant="secondary" onPress={() => setOverlay("dialog")} />
        <Menu
          title="Book"
          items={[
            { label: "Mark as read", onPress: () => undefined },
            { label: "Disabled item", disabled: true, onPress: () => undefined },
            { label: "Delete", destructive: true, onPress: () => undefined },
          ]}
        >
          <Button label="Open menu" variant="secondary" />
        </Menu>
        <Sheet visible={overlay === "sheet"} title="Book details" onClose={() => setOverlay(null)}>
          <ModalBody><Input label="Book title" defaultValue="The Left Hand of Darkness" /><Button label="Save" onPress={() => setOverlay(null)} /></ModalBody>
        </Sheet>
        <Dialog visible={overlay === "dialog"} title="Remove book?" onClose={() => setOverlay(null)}>
          <ModalBody><Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>This action cannot be undone.</Text><Button label="Remove" variant="destructive" onPress={() => setOverlay(null)} /></ModalBody>
        </Dialog>
      </Section>

      <Section title="Feedback">
        <Button label="Show toast" variant="secondary" onPress={() => setToast((visible) => !visible)} />
        <Toast visible={toast} message="Library saved." tone="success" />
        <Toast visible message="Could not save changes." tone="error" />
        <Skeleton height={160} radius={12} />
        <Skeleton width="65%" />
      </Section>

      <Section title="States">
        <EmptyState title="No books yet" body="Import a library to get started." actionLabel="Import books" onAction={() => undefined} />
        <ErrorState body="Check your connection and try again." actionLabel="Retry" onAction={() => undefined} />
        <OfflineBanner />
      </Section>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" {...dynamicType} style={[styles.title, { color: colors.text }]}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  page: { padding: spacing.lg, paddingBottom: spacing.huge, gap: spacing.xxxl },
  heading: { ...typography.heading, fontWeight: "700" },
  section: { gap: spacing.md },
  title: { ...typography.title, fontWeight: "700" },
});
