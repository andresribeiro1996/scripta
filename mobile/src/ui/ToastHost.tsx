import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Toast } from "./components";
import { spacing } from "./theme";

type ToastTone = "default" | "error" | "success";

const TOAST_MS = 5000;

const ToastContext = createContext<{ show(message: string, tone?: ToastTone): void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<{ message: string; tone: ToastTone; visible: boolean }>({ message: "", tone: "default", visible: false });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((message: string, tone: ToastTone = "default") => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ message, tone, visible: true });
    timer.current = setTimeout(() => setToast((current) => ({ ...current, visible: false })), TOAST_MS);
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const value = useMemo(() => ({ show }), [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <View pointerEvents="none" style={[styles.host, { top: insets.top + spacing.md }]}>
        <Toast message={toast.message} tone={toast.tone} visible={toast.visible} />
      </View>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside ToastProvider");
  return context;
}

const styles = StyleSheet.create({
  host: { position: "absolute", left: spacing.lg, right: spacing.lg, zIndex: 1000, elevation: 1000 },
});
