import { type ReactNode, type Ref, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
} from "react-native";
import MenuView from "@expo/ui/community/menu";
import { Icon, type IconName } from "./icon";
import SegmentedControl from "@expo/ui/community/segmented-control";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { errorHaptic, successHaptic } from "./haptics";
import { dynamicType, minimumTouchTarget, radii, spacing, typography, useReducedMotion, useTheme } from "./theme";

// Every screen root: paints the themed background and pays whichever safe-area
// insets nothing else is covering.
//
// `top` is false wherever a native stack header sits above the screen — the
// header already clears the status bar, and paying the inset again pushes the
// content down by it twice. `bottom` is for routes outside the tab shell, where
// no tab bar is reserving the home-indicator strip.
export function Screen({
  children,
  top = true,
  bottom = false,
  style,
}: {
  children: ReactNode;
  top?: boolean;
  bottom?: boolean;
  style?: ViewStyle;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        { flex: 1, backgroundColor: colors.background },
        top ? { paddingTop: insets.top } : null,
        bottom ? { paddingBottom: insets.bottom } : null,
        style,
      ]}
    >
      {children}
    </View>
  );
}

export type ButtonVariant = "primary" | "secondary" | "destructive";

export function Button({
  label,
  accessibilityLabel = label,
  variant = "primary",
  loading = false,
  disabled = false,
  onPress,
}: {
  label: string;
  accessibilityLabel?: string;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  /** Omitted when the button is only a trigger — see Menu. */
  onPress?: () => void;
}) {
  const { colors } = useTheme();
  const unavailable = disabled || loading;
  const backgroundColor = variant === "primary" ? colors.accent : variant === "destructive" ? colors.danger : colors.surface;
  const color = variant === "primary" ? colors.onAccent : variant === "destructive" ? colors.onDanger : colors.text;

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled: unavailable, busy: loading }}
      disabled={unavailable}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: pressed && variant === "secondary" ? colors.surfacePressed : backgroundColor,
          borderColor: variant === "secondary" ? colors.border : backgroundColor,
          opacity: unavailable ? 0.55 : 1,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
      ]}
    >
      {loading ? <ActivityIndicator color={color} /> : <Text {...dynamicType} style={[styles.buttonText, { color }]}>{label}</Text>}
    </Pressable>
  );
}

// An icon-only control. Exists mainly as a menu trigger and for header
// actions, where a text button would crowd the row — the accessibility label
// carries the meaning the glyph can't.
export function IconButton({
  name,
  accessibilityLabel,
  onPress,
  tone = "default",
}: {
  name: IconName;
  accessibilityLabel: string;
  onPress?: () => void;
  tone?: "default" | "danger";
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        { backgroundColor: pressed ? colors.surfacePressed : "transparent" },
      ]}
    >
      <Icon color={tone === "danger" ? colors.danger : colors.textDim} name={name} size={22} />
    </Pressable>
  );
}

export function Input({
  label,
  error,
  accessibilityLabel = label,
  editable = true,
  style,
  // Forwarded so a form can move focus to the next field on "next" — without
  // it there is no way to reach the underlying TextInput.
  ref,
  ...props
}: TextInputProps & { label: string; error?: string; ref?: Ref<TextInput> }) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.field}>
      <Text {...dynamicType} style={[styles.label, { color: colors.text }]}>{label}</Text>
      <TextInput
        {...props}
        ref={ref}
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled: !editable }}
        allowFontScaling
        editable={editable}
        onBlur={(event) => { setFocused(false); props.onBlur?.(event); }}
        onFocus={(event) => { setFocused(true); props.onFocus?.(event); }}
        placeholderTextColor={colors.textDim}
        selectionColor={colors.accent}
        style={[
          styles.input,
          { backgroundColor: colors.surface, borderColor: error ? colors.danger : focused ? colors.accent : colors.border, color: colors.text, opacity: editable ? 1 : 0.55 },
          style,
        ]}
      />
      {error ? <Text accessibilityLiveRegion="polite" {...dynamicType} style={[styles.help, { color: colors.danger }]}>{error}</Text> : null}
    </View>
  );
}

type OverlayProps = {
  visible: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  closeAccessibilityLabel?: string;
};

function Overlay({ visible, title, children, onClose, closeAccessibilityLabel, sheet }: OverlayProps & { sheet: boolean }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();

  return (
    <Modal
      animationType={reducedMotion ? "none" : sheet ? "slide" : "fade"}
      onRequestClose={onClose}
      transparent
      visible={visible}
    >
      <View style={[styles.overlay, sheet ? styles.sheetOverlay : styles.dialogOverlay]}>
        <Pressable
          accessibilityLabel={closeAccessibilityLabel ?? `Close ${title}`}
          accessibilityRole="button"
          onPress={onClose}
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]}
        />
        <View
          accessibilityViewIsModal
          style={[
            sheet ? styles.sheet : styles.dialog,
            { backgroundColor: colors.surface, borderColor: colors.border },
            // A sheet is flush to the bottom edge, so its own content has to
            // clear the home indicator — spacing.xxxl was a fixed guess at it.
            sheet ? { paddingBottom: insets.bottom + spacing.xl } : null,
          ]}
        >
          <View style={styles.overlayHeader}>
            <Text accessibilityRole="header" {...dynamicType} style={[styles.overlayTitle, { color: colors.text }]}>{title}</Text>
            <Pressable accessibilityLabel={`Close ${title}`} accessibilityRole="button" hitSlop={8} onPress={onClose} style={styles.closeButton}>
              <Text {...dynamicType} style={[styles.closeText, { color: colors.textDim }]}>Close</Text>
            </Pressable>
          </View>
          {children}
        </View>
      </View>
    </Modal>
  );
}

export function Sheet(props: OverlayProps) {
  return <Overlay {...props} sheet />;
}

export function Dialog(props: OverlayProps) {
  return <Overlay {...props} sheet={false} />;
}

// The native segmented control — SwiftUI's segmented Picker on iOS, Compose's
// SingleChoiceSegmentedButtonRow on Android. Replaces the pairs of Buttons that
// were standing in for one.
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
}: {
  options: readonly { readonly value: T; readonly label: string }[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel?: string;
}) {
  const { colors, mode } = useTheme();
  const index = Math.max(0, options.findIndex((option) => option.value === value));

  return (
    <View accessibilityLabel={accessibilityLabel} accessibilityRole="tablist">
      <SegmentedControl
        appearance={mode}
        onValueChange={(label) => {
          const picked = options.find((option) => option.label === label);
          if (picked) onChange(picked.value);
        }}
        selectedIndex={index}
        tintColor={colors.accent}
        values={options.map((option) => option.label)}
      />
    </View>
  );
}

export type MenuItem = {
  label: string;
  accessibilityLabel?: string;
  destructive?: boolean;
  disabled?: boolean;
  onPress: () => void;
};

/**
 * The platform's own menu — SwiftUI `Menu` on iOS, Compose `DropdownMenu` on
 * Android — anchored to whatever trigger you wrap.
 *
 * This is trigger-based, not visibility-controlled: the native menu owns its
 * own open state and neither platform exposes a programmatic open, so there is
 * no `visible` prop to drive. Pass the control that opens it as `children`; its
 * own `onPress` is not called, because the native menu intercepts the tap.
 */
export function Menu({ title, items, children }: { title?: string; items: MenuItem[]; children: ReactNode }) {
  return (
    <MenuView
      actions={items.map((item, index) => ({
        // Index rather than label: two items may share a label, and the id is
        // what comes back on press.
        id: String(index),
        title: item.label,
        attributes: { destructive: item.destructive, disabled: item.disabled },
      }))}
      onPressAction={({ nativeEvent }) => {
        const item = items[Number(nativeEvent.event)];
        if (item && !item.disabled) item.onPress();
      }}
      title={title}
    >
      {children}
    </MenuView>
  );
}

export function Toast({ visible, message, tone = "default" }: { visible: boolean; message: string; tone?: "default" | "error" | "success" }) {
  const { colors } = useTheme();
  const reducedMotion = useReducedMotion();
  const opacity = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const wasVisible = useRef(visible);

  // Once per appearance, and only for an outcome the user was waiting on — a
  // neutral toast is information, not a result.
  useEffect(() => {
    if (visible && !wasVisible.current) {
      if (tone === "success") successHaptic();
      else if (tone === "error") errorHaptic();
    }
    wasVisible.current = visible;
  }, [tone, visible]);

  useEffect(() => {
    if (reducedMotion) {
      opacity.setValue(visible ? 1 : 0);
      return;
    }
    Animated.timing(opacity, { duration: 180, toValue: visible ? 1 : 0, useNativeDriver: true }).start();
  }, [opacity, reducedMotion, visible]);

  if (!visible) return null;
  const backgroundColor = tone === "error" ? colors.dangerSoft : tone === "success" ? colors.successSoft : colors.surface;
  const color = tone === "success" ? colors.success : colors.text;
  return (
    <Animated.View accessibilityLiveRegion="polite" accessibilityRole="alert" style={[styles.toast, { backgroundColor, borderColor: colors.border, opacity }]}>
      <Text {...dynamicType} style={[typography.body, { color }]}>{message}</Text>
    </Animated.View>
  );
}

export function Skeleton({ width = "100%", height = 16, radius = radii.sm, accessibilityLabel = "Loading" }: { width?: ViewStyle["width"]; height?: number; radius?: number; accessibilityLabel?: string }) {
  const { colors } = useTheme();
  const reducedMotion = useReducedMotion();
  const opacity = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    if (reducedMotion) {
      opacity.setValue(0.65);
      return;
    }
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { duration: 700, toValue: 0.9, useNativeDriver: true }),
      Animated.timing(opacity, { duration: 700, toValue: 0.45, useNativeDriver: true }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [opacity, reducedMotion]);

  return <Animated.View accessibilityLabel={accessibilityLabel} accessibilityRole="progressbar" style={{ width, height, borderRadius: radius, backgroundColor: colors.border, opacity }} />;
}

function StatePanel({ title, body, actionLabel, onAction, error }: { title: string; body?: string; actionLabel?: string; onAction?: () => void; error?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.state, { borderColor: error ? colors.danger : colors.border }]}>
      <Text accessibilityRole="header" {...dynamicType} style={[styles.stateTitle, { color: error ? colors.danger : colors.text }]}>{title}</Text>
      {body ? <Text {...dynamicType} style={[typography.body, styles.centerText, { color: colors.textDim }]}>{body}</Text> : null}
      {actionLabel && onAction ? <Button label={actionLabel} onPress={onAction} variant={error ? "destructive" : "secondary"} /> : null}
    </View>
  );
}

export function EmptyState(props: { title: string; body?: string; actionLabel?: string; onAction?: () => void }) {
  return <StatePanel {...props} />;
}

export function ErrorState(props: { title?: string; body?: string; actionLabel?: string; onAction?: () => void }) {
  return <StatePanel title="Something went wrong" {...props} error />;
}

export function OfflineBanner({ message = "You're offline. Connect to refresh." }: { message?: string }) {
  const { colors } = useTheme();
  return (
    <View accessibilityLiveRegion="polite" accessibilityRole="alert" style={[styles.banner, { backgroundColor: colors.accentSoft }]}>
      <Text {...dynamicType} style={[typography.body, styles.bannerText, { color: colors.text }]}>{message}</Text>
    </View>
  );
}

export function ModalBody({ children }: { children: ReactNode }) {
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.modalBody}>{children}</ScrollView>;
}

const styles = StyleSheet.create({
  button: { minHeight: minimumTouchTarget, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radii.md, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  buttonText: { ...typography.body, fontWeight: "600" },
  iconButton: { minHeight: minimumTouchTarget, minWidth: minimumTouchTarget, alignItems: "center", justifyContent: "center", borderRadius: radii.full },
  field: { gap: spacing.xs },
  label: { ...typography.body, fontWeight: "600" },
  input: { minHeight: minimumTouchTarget, borderWidth: 1, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, ...typography.input },
  help: { ...typography.caption },
  overlay: { flex: 1 },
  sheetOverlay: { justifyContent: "flex-end" },
  dialogOverlay: { justifyContent: "center", padding: spacing.lg },
  sheet: { maxHeight: "90%", padding: spacing.xl, borderWidth: 1, borderBottomWidth: 0, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl },
  dialog: { maxHeight: "90%", padding: spacing.xl, borderWidth: 1, borderRadius: radii.lg },
  overlayHeader: { minHeight: minimumTouchTarget, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  overlayTitle: { ...typography.title, fontWeight: "700", flex: 1 },
  closeButton: { minHeight: minimumTouchTarget, minWidth: minimumTouchTarget, alignItems: "center", justifyContent: "center" },
  closeText: { ...typography.body, fontWeight: "600" },
  toast: { borderRadius: radii.md, borderWidth: 1, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  state: { borderWidth: 2, borderStyle: "dashed", borderRadius: radii.lg, padding: spacing.huge, alignItems: "center", gap: spacing.md },
  stateTitle: { ...typography.title, fontWeight: "700", textAlign: "center" },
  centerText: { textAlign: "center" },
  banner: { minHeight: minimumTouchTarget, justifyContent: "center", paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  bannerText: { fontWeight: "600", textAlign: "center" },
  modalBody: { gap: spacing.md, paddingTop: spacing.sm },
});
