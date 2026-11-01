import { Stack, router } from "expo-router";
import { StyleSheet, View } from "react-native";
import { Screen, spacing } from "../../ui";
import { IsbnScanner } from "../library/components/IsbnScanner";
import { sendScan } from "./scanBridge";
import { useT } from "../../i18n";

export function ScanScreen() {
  const t = useT();
  return (
    <Screen top={false}>
      <Stack.Screen options={{ title: t("shell.scan") }} />
      <View style={styles.body}>
        <IsbnScanner
          hint={t("book.scanHint")}
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
