import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Redirect } from "expo-router";
import { useAuth } from "../core/auth";

/** A Google sign-in with no username yet (`user.username === null`) is
 *  routed here by (app)/_layout.tsx's own guard before it's treated as
 *  fully signed in — the mobile equivalent of the PWA's RequireUsername
 *  (see backend/README's auth section: "the caller is expected to prompt
 *  for one via POST /auth/username before treating the account as fully
 *  set up"). A top-level route, not nested under (app)'s Tabs, so it
 *  never shows up as a tab. */
export default function ChooseUsernamePage() {
  const { ready, user, setUsername } = useAuth();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!ready) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }
  if (!user) return <Redirect href="/(public)/login" />;
  if (user.username) return <Redirect href="/(app)" />;

  const trimmed = value.trim();
  const onSubmit = async () => {
    setBusy(true);
    setError(null);
    try {
      await setUsername(trimmed);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save that username");
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
      <View style={styles.center}>
        <Text style={styles.title}>Choose a username</Text>
        <Text style={styles.sub}>One more step before your library loads.</Text>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={setValue}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="username"
          placeholderTextColor="#9ca3af"
        />
        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed, trimmed.length < 3 && styles.buttonDisabled]}
          onPress={onSubmit}
          disabled={busy || trimmed.length < 3}
        >
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Continue</Text>}
        </Pressable>
        {error && <Text style={styles.error}>{error}</Text>}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: "#fafaf9" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  title: { fontSize: 24, fontWeight: "700", color: "#1c1917" },
  sub: { fontSize: 13, color: "#78716c", marginTop: 4, marginBottom: 24, textAlign: "center" },
  input: {
    width: "100%",
    borderWidth: 1,
    borderColor: "#d6d3d1",
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    marginBottom: 12,
    backgroundColor: "#fff",
    color: "#1c1917",
  },
  button: { width: "100%", backgroundColor: "#1c1917", borderRadius: 12, padding: 16, alignItems: "center" },
  buttonPressed: { opacity: 0.85 },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  error: { color: "#dc2626", marginTop: 12, textAlign: "center" },
});
