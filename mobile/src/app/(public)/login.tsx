import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Redirect } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { GoogleSignInCancelledError, useAuth } from "../../core/auth";
import { apiClient } from "../../core/api";

export default function LoginPage() {
  const { ready, user, signIn, signInWithGoogle } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const health = useQuery({
    queryKey: ["health"],
    queryFn: () => apiClient.request<{ status: string }>("/health"),
    retry: false,
  });

  // Same "let the backend say whether Google sign-in is configured"
  // pattern as the PWA's LoginPage — no hardcoded assumption here either.
  const providers = useQuery({
    queryKey: ["auth-providers"],
    queryFn: () => apiClient.request<{ google: boolean }>("/auth/providers"),
    retry: false,
  });

  if (!ready) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }
  if (user) return <Redirect href="/(app)" />;

  const onSubmit = async () => {
    setBusy(true);
    setError(null);
    try {
      await signIn(identifier.trim(), password);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  };

  const onGoogleSignIn = async () => {
    setGoogleBusy(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch (e) {
      if (!(e instanceof GoogleSignInCancelledError)) {
        setError(e instanceof Error ? e.message : "Google sign-in failed");
      }
    } finally {
      setGoogleBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
      <View style={styles.center}>
        <Text style={styles.logo}>Scripta</Text>
        <Text style={styles.server}>
          {health.isPending ? "checking server…" : health.isError ? "server unreachable" : "server ok"}
        </Text>
        <TextInput
          style={styles.input}
          value={identifier}
          onChangeText={setIdentifier}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          placeholder="Email or username"
          placeholderTextColor="#9ca3af"
        />
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="Password"
          placeholderTextColor="#9ca3af"
        />
        <Pressable style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]} onPress={onSubmit} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sign in</Text>}
        </Pressable>
        {providers.data?.google && (
          <Pressable
            style={({ pressed }) => [styles.googleButton, pressed && styles.buttonPressed]}
            onPress={onGoogleSignIn}
            disabled={googleBusy}
          >
            {googleBusy ? <ActivityIndicator color="#1c1917" /> : <Text style={styles.googleButtonText}>Sign in with Google</Text>}
          </Pressable>
        )}
        {error && <Text style={styles.error}>{error}</Text>}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: "#fafaf9" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  logo: { fontSize: 40, fontWeight: "700", color: "#1c1917" },
  server: { fontSize: 13, color: "#78716c", marginTop: 4, marginBottom: 32 },
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
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  googleButton: {
    width: "100%",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#d6d3d1",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    marginTop: 12,
  },
  googleButtonText: { color: "#1c1917", fontSize: 16, fontWeight: "600" },
  error: { color: "#dc2626", marginTop: 12, textAlign: "center" },
});
