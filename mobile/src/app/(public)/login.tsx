import { authFieldErrors, PASSWORD_HINT, USERNAME_HINT } from "@scripta/shared";
import { afterSignIn, startAuthNavigation } from "../../features/auth/navigation";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  ScrollView,
  Text,
  type TextInput,
  View,
} from "react-native";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { GoogleSignInCancelledError, useAuth } from "../../core/auth";
import { ApiError, apiClient } from "../../core/api";
import { Button, Input, Screen, Segmented } from "../../ui";
import { spacing, typography, useTheme } from "../../ui/theme";

const AUTH_MODES = [
  { value: "login", label: "Log in" },
  { value: "signup", label: "Sign up" },
] as const;

export default function LoginPage() {
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const { ready, user, signUp, signIn, signInWithGoogle } = useAuth();
  const { colors } = useTheme();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [identifier, setIdentifier] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const locked = useRef(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const identifierRef = useRef<TextInput>(null);
  const usernameRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

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
      <Screen bottom style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
      </Screen>
    );
  }
  if (user) return <Redirect href={afterSignIn(user.username) as never} />;

  const onSubmit = async () => {
    if (locked.current) return;
    const errors = authFieldErrors(mode, identifier, username, password);
    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      if (errors.identifier) identifierRef.current?.focus();
      else if (errors.username) usernameRef.current?.focus();
      else passwordRef.current?.focus();
      return;
    }
    locked.current = true;
    startAuthNavigation(returnTo, mode === "signup");
    setBusy(true);
    setError(null);
    try {
      if (mode === "signup") await signUp(identifier.trim(), username.trim(), password);
      else await signIn(identifier.trim(), password);
    } catch (e) {
      if (e instanceof ApiError && e.field) setFieldErrors({ [e.field]: e.message });
      else setError(e instanceof TypeError ? "Couldn’t connect. Check your connection and try again." : e instanceof Error ? e.message : "Sign-in failed");
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };

  const onGoogleSignIn = async () => {
    if (locked.current) return;
    locked.current = true;
    startAuthNavigation(returnTo, false);
    setGoogleBusy(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch (e) {
      if (!(e instanceof GoogleSignInCancelledError)) {
        setError(e instanceof Error ? e.message : "Google sign-in failed");
      }
    } finally {
      locked.current = false;
      setGoogleBusy(false);
    }
  };

  return (
    <Screen bottom>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.flex}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.center}>
          <Text accessibilityRole="header" style={[styles.logo, { color: colors.text }]}>Atmyshelf</Text>
          {/* Only worth the user's attention when the server is actually
              unreachable — "server ok" is a developer's line, not a reader's. */}
          {health.isError ? (
            <Text accessibilityRole="alert" style={[styles.server, { color: colors.danger }]}>
              Can&apos;t reach the server. Check your connection.
            </Text>
          ) : (
            <Text style={[styles.server, { color: colors.textDim }]}>Your bookshelf, everywhere.</Text>
          )}

          <View style={styles.modeRow}>
            <Segmented
              accessibilityLabel="Sign in or create an account"
              options={AUTH_MODES}
              value={mode}
              onChange={(next) => { if (locked.current) return; setMode(next); setError(null); setFieldErrors({}); }}
            />
          </View>

          <View style={styles.form}>
            <Input
              ref={identifierRef}
              editable={!busy && !googleBusy}
              error={fieldErrors.identifier}
              label={mode === "signup" ? "Email" : "Email or username"}
              value={identifier}
              onChangeText={(value) => { setIdentifier(value); setFieldErrors({ ...fieldErrors, identifier: "" }); }}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete={mode === "signup" ? "email" : "username"}
              textContentType={mode === "signup" ? "emailAddress" : "username"}
              keyboardType={mode === "signup" ? "email-address" : "default"}
              returnKeyType="next"
              onSubmitEditing={() => (mode === "signup" ? usernameRef : passwordRef).current?.focus()}
              submitBehavior="submit"
              placeholder={mode === "signup" ? "you@example.com" : "Email or username"}
            />
            {mode === "signup" ? (
              <Input
                ref={usernameRef}
                editable={!busy && !googleBusy}
                error={fieldErrors.username}
                hint={USERNAME_HINT}
                label="Username"
                value={username}
                onChangeText={(value) => { setUsername(value); setFieldErrors({ ...fieldErrors, username: "" }); }}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="username-new"
                textContentType="username"
                returnKeyType="next"
                onSubmitEditing={() => passwordRef.current?.focus()}
                submitBehavior="submit"
                placeholder="username"
              />
            ) : null}
            <Input
              ref={passwordRef}
              key={mode}
              editable={!busy && !googleBusy}
              error={fieldErrors.password}
              hint={mode === "signup" ? PASSWORD_HINT : undefined}
              label="Password"
              value={password}
              onChangeText={(value) => { setPassword(value); setFieldErrors({ ...fieldErrors, password: "" }); }}
              secureTextEntry
              // Without these, iOS offers neither Keychain autofill nor
              // "save this password" after a successful sign-in.
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              textContentType={mode === "signup" ? "newPassword" : "password"}
              returnKeyType="go"
              onSubmitEditing={() => void onSubmit()}
              placeholder={mode === "signup" ? "At least 8 characters" : "Password"}
            />
            {mode === "login" && <Button label="Forgot password?" variant="secondary" disabled={busy || googleBusy} onPress={() => router.push({ pathname: "/forgot-password", params: { email: identifier.includes("@") ? identifier : "" } })} />}
            <Button
              label={mode === "signup" ? "Create account" : "Sign in"}
              loading={busy}
              disabled={googleBusy}
              onPress={() => void onSubmit()}
            />
            {providers.data?.google ? (
              <Button label="Sign in with Google" variant="secondary" disabled={busy} loading={googleBusy} onPress={() => void onGoogleSignIn()} />
            ) : null}
            {error ? (
              <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={[styles.error, { color: colors.danger }]}>{error}</Text>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flexGrow: 1, justifyContent: "center", alignItems: "center", padding: spacing.xxl },
  logo: { fontSize: 40, lineHeight: 48, fontWeight: "700" },
  server: { ...typography.body, marginTop: spacing.xs, marginBottom: spacing.xxxl, textAlign: "center" },
  modeRow: { width: "100%", marginBottom: spacing.lg },
  form: { width: "100%", gap: spacing.md },
  error: { ...typography.body, textAlign: "center" },
});
