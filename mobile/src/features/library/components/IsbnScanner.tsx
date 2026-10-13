import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Linking, StyleSheet, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useIsFocused } from "expo-router/react-navigation";
import { Text } from "../../../ui/Text";
import { Button } from "../../../ui/components";
import { radii, spacing, typography, useTheme } from "../../../ui/theme";
import { isbnFromBarcode } from "../lib/isbnBarcode";

export function IsbnScanner({ hint, onIsbn }: { hint: string; onIsbn: (isbn: string) => void }) {
  const { colors } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appActive, setAppActive] = useState(AppState.currentState === "active");
  const focused = useIsFocused();
  const asked = useRef(false);
  const consumed = useRef(false);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => setAppActive(state === "active"));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!permission || permission.granted || asked.current) return;
    asked.current = true;
    setRequesting(true);
    requestPermission()
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Couldn't access the camera. Type the ISBN instead."))
      .finally(() => setRequesting(false));
  }, [permission, requestPermission]);

  if (error) return <Text selectable accessibilityRole="alert" style={[typography.caption, { color: colors.danger }]}>{error}</Text>;
  if (!permission || requesting) return <View style={styles.pending}><ActivityIndicator accessibilityLabel="Starting the camera" color={colors.accent} /></View>;
  if (!permission.granted) {
    return (
      <View style={styles.message}>
        <Text accessibilityRole="alert" style={[typography.caption, { color: colors.danger }]}>
          {permission.canAskAgain
            ? "Allow camera access to scan a book, or type the ISBN instead."
            : "Camera access is disabled. Enable it in Settings, or type the ISBN instead."}
        </Text>
        {permission.canAskAgain ? null : (
          <Button label="Open Settings" variant="secondary" onPress={() => {
            void Linking.openSettings().catch((err: unknown) => setError(err instanceof Error ? err.message : "Couldn't open Settings."));
          }} />
        )}
      </View>
    );
  }
  return (
    <View style={styles.scanner}>
      <View style={[styles.frame, { backgroundColor: colors.surface }]}>
        {focused && appActive ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["ean13", "code128"] }}
            onBarcodeScanned={({ data }) => {
              if (consumed.current || AppState.currentState !== "active") return;
              const isbn = isbnFromBarcode(data);
              if (!isbn) return;
              consumed.current = true;
              onIsbn(isbn);
            }}
            onMountError={({ message }) => {
              consumed.current = true;
              setError(message || "Couldn't start the camera. Type the ISBN instead.");
            }}
          />
        ) : null}
      </View>
      <Text style={[typography.caption, { color: colors.textDim }]}>{hint}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scanner: { gap: spacing.sm },
  frame: { aspectRatio: 4 / 3, borderRadius: radii.lg, overflow: "hidden" },
  pending: { padding: spacing.lg, alignItems: "center" },
  message: { gap: spacing.sm },
});
