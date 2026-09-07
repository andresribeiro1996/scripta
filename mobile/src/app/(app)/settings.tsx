import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "../../core/auth";

export default function SettingsPage() {
  const { user, signOut } = useAuth();
  const router = useRouter();

  const onSignOut = () => {
    Alert.alert("Sign out", "Sign out of Scripta on this device?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: async () => {
          await signOut();
          router.replace("/(public)/login");
        },
      },
    ]);
  };

  return (
    <View style={styles.flex}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Settings</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Account</Text>
        <Text style={styles.value}>{user?.username ? `@${user.username}` : user?.email}</Text>
      </View>
      <Pressable style={({ pressed }) => [styles.button, pressed && { opacity: 0.85 }]} onPress={onSignOut}>
        <Text style={styles.buttonText}>Sign out</Text>
      </Pressable>
      <Text style={styles.footnote}>Gallery, socials, and styling arrive in Wave 3 (Task 5B).</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: "#fafaf9" },
  header: { paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#e7e5e4" },
  headerTitle: { fontSize: 28, fontWeight: "700", color: "#1c1917" },
  row: { paddingHorizontal: 20, paddingVertical: 16 },
  label: { fontSize: 13, color: "#78716c", textTransform: "uppercase" },
  value: { fontSize: 16, color: "#1c1917", marginTop: 4 },
  button: { marginHorizontal: 20, marginTop: 8, backgroundColor: "#1c1917", borderRadius: 12, padding: 16, alignItems: "center" },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  footnote: { fontSize: 13, color: "#a8a29e", textAlign: "center", marginTop: 16 },
});
