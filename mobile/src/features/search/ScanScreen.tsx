import { Stack, router } from "expo-router";
import { StyleSheet, View } from "react-native";
import { Screen, spacing } from "../../ui";
import { IsbnScanner } from "../library/components/IsbnScanner";
import { sendScan } from "./scanBridge";

export function ScanScreen() {
  return (
    <Screen top={false}>
      <Stack.Screen options={{ title: "Scan" }} />
      <View style={styles.body}>
        <IsbnScanner
          hint="Point at the barcode on the back cover"
          onIsbn={(isbn) => {
            sendScan(isbn);
            router.back();
          }}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing.lg },
});
