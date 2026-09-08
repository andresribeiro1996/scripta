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
import { Redirect, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { GoogleSignInCancelledError, useAuth } from "../../core/auth";
import { apiClient } from "../../core/api";

export default function LoginPage() {
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const { ready, user, signUp, signIn, signInWithGoogle } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [identifier, setIdentifier] = useState("");
  const [username, setUsername] = useState("");
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
  if (user) return <Redirect href={(!user.username ? "/choose-username" : mode === "signup" ? "/welcome-avatar" : returnTo?.startsWith("/vote/") ? returnTo : "/(app)") as never} />;

  const onSubmit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === "signup") await signUp(identifier.trim(), username.trim(), password);
      else await signIn(identifier.trim(), password);
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
        <View style={styles.modeRow}>
          <Pressable accessibilityRole="tab" accessibilityState={{ selected: mode === "login" }} style={[styles.modeButton, mode === "login" && styles.modeActive]} onPress={() => setMode("login")}><Text style={styles.modeText}>Log in</Text></Pressable>
          <Pressable accessibilityRole="tab" accessibilityState={{ selected: mode === "signup" }} style={[styles.modeButton, mode === "signup" && styles.modeActive]} onPress={() => setMode("signup")}><Text style={styles.modeText}>Sign up</Text></Pressable>
        </View>
        <TextInput
          style={styles.input}
          value={identifier}
          onChangeText={setIdentifier}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType={mode === "signup" ? "email-address" : "default"}
          placeholder={mode === "signup" ? "Email" : "Email or username"}
          placeholderTextColor="#9ca3af"
        />
        {mode === "signup" ? <TextInput
          style={styles.input}
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Username"
          placeholderTextColor="#9ca3af"
        /> : null}
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="Password"
          placeholderTextColor="#9ca3af"
        />
        <Pressable accessibilityState={{ disabled: busy || (mode === "signup" && (username.trim().length < 3 || password.length < 8)) }} style={({ pressed }) => [styles.button, pressed && styles.buttonPressed, mode === "signup" && (username.trim().length < 3 || password.length < 8) && styles.buttonDisabled]} onPress={onSubmit} disabled={busy || (mode === "signup" && (username.trim().length < 3 || password.length < 8))}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{mode === "signup" ? "Create account" : "Sign in"}</Text>}
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
  modeRow: { width: "100%", flexDirection: "row", marginBottom: 16, borderWidth: 1, borderColor: "#d6d3d1", borderRadius: 12, overflow: "hidden" },
  modeButton: { flex: 1, padding: 12, alignItems: "center" },
  modeActive: { backgroundColor: "#e7e5e4" },
  modeText: { color: "#1c1917", fontWeight: "600" },
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
