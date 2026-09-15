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
import MenuView, { type MenuAction } from "@expo/ui/community/menu";
import PagerView from "react-native-pager-view";
import { Icon, type IconName } from "./icon";
import SegmentedControl from "@expo/ui/community/segmented-control";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { errorHaptic, successHaptic } from "./haptics";
import { dynamicType, minimumTouchTarget, radii, spacing, typography, useReducedMotion, useTheme } from "./theme";

const AnimatedPagerView = Animated.createAnimatedComponent(PagerView);

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
  label,
  onPress,
  tone = "default",
}: {
  name: IconName;
  accessibilityLabel: string;
  /** Draws the word beside the glyph. Use wherever the glyph alone is a guess
   *  — a globe could be public, or language, or region. */
  label?: string;
  onPress?: () => void;
  tone?: "default" | "danger";
}) {
  const { colors } = useTheme();
  const color = tone === "danger" ? colors.danger : colors.textDim;
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [
        label ? styles.labelledIconButton : styles.iconButton,
        { backgroundColor: pressed ? colors.surfacePressed : "transparent" },
      ]}
    >
      <Icon color={color} name={name} size={22} />
      {label ? <Text {...dynamicType} numberOfLines={1} style={[typography.body, { color }]}>{label}</Text> : null}
    </Pressable>
  );
}

export function Input({
  label,
  error,
  secureTextEntry,
  hint,
  accessibilityLabel = label,
  editable = true,
  style,
  // Forwarded so a form can move focus to the next field on "next" — without
  // it there is no way to reach the underlying TextInput.
  ref,
  ...props
}: TextInputProps & { label: string; error?: string; hint?: string; ref?: Ref<TextInput> }) {
  const { colors } = useTheme();
  const [visible, setVisible] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.field}>
      <Text {...dynamicType} style={[styles.label, { color: colors.text }]}>{label}</Text>
      <View style={{ position: "relative" }}>
      <TextInput
        {...props}
        ref={(node) => { inputRef.current = node; if (typeof ref === "function") ref(node); else if (ref) ref.current = node; }}
        secureTextEntry={secureTextEntry && !visible}
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
          secureTextEntry ? { paddingRight: minimumTouchTarget + spacing.sm } : null,
          style,
        ]}
      />
      {secureTextEntry && <Pressable accessibilityRole="button" accessibilityLabel={visible ? "Hide password" : "Show password"} accessibilityState={{ disabled: !editable }}
        disabled={!editable} onPress={() => { setVisible(!visible); inputRef.current?.focus(); }}
        style={{ position: "absolute", right: 0, top: 0, bottom: 0, minWidth: minimumTouchTarget, minHeight: minimumTouchTarget, alignItems: "center", justifyContent: "center" }}>
        <Icon name={visible ? "hidePassword" : "showPassword"} size={20} color={colors.textDim} />
      </Pressable>}
      </View>
      {hint ? <Text {...dynamicType} style={[styles.help, { color: colors.textDim }]}>{hint}</Text> : null}
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

// Panes of content, swiped or tapped. A segmented control is the wrong
// component for this: on both platforms it selects an option or a filter —
// hence the checkmark Android draws in it — while moving between panes is what
// tabs are for, and tabs bring an indicator that tracks the finger mid-drag.
//
// The tab row stays visible because the swipe is an accelerator, never the only
// path: a gesture-only switch is invisible to a first-time user and unreachable
// with a screen reader or limited motor control.
//
// Android consumes swipes that start within a few dp of either screen edge as
// its back gesture. That is the platform's call, not a bug here.
export function SwipeableTabs<T extends string>({
  options,
  value,
  onChange,
  renderPage,
  accessibilityLabel,
}: {
  options: readonly { readonly value: T; readonly label: string }[];
  value: T;
  onChange: (value: T) => void;
  renderPage: (value: T, active: boolean) => ReactNode;
  accessibilityLabel?: string;
}) {
  const { colors } = useTheme();
  const reducedMotion = useReducedMotion();
  const pager = useRef<PagerView>(null);
  const [rowWidth, setRowWidth] = useState(0);
  const index = Math.max(0, options.findIndex((option) => option.value === value));
  // position and offset arrive as separate keys on one native event, so they
  // are two values added together rather than one.
  const position = useRef(new Animated.Value(0)).current;
  const offset = useRef(new Animated.Value(0)).current;
  const tabWidth = options.length ? rowWidth / options.length : 0;

  // The pager is the source of truth for which page is showing; tapping a tab
  // asks it to move and the selection follows from onPageSelected, so a tap and
  // a swipe land in exactly the same state.
  useEffect(() => {
    if (!pager.current) return;
    if (reducedMotion) pager.current.setPageWithoutAnimation(index);
    else pager.current.setPage(index);
  }, [index, reducedMotion]);

  return (
    <View style={styles.grow}>
      <View
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="tablist"
        onLayout={(event) => setRowWidth(event.nativeEvent.layout.width)}
        style={[styles.tabRow, { borderBottomColor: colors.border }]}
      >
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              accessibilityLabel={option.label}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              key={option.value}
              onPress={() => onChange(option.value)}
              style={({ pressed }) => [
                styles.tab,
                { backgroundColor: pressed ? colors.surfacePressed : "transparent" },
              ]}
            >
              <Text
                {...dynamicType}
                numberOfLines={1}
                style={[typography.body, styles.tabLabel, { color: selected ? colors.accent : colors.textDim }]}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
        {tabWidth ? (
          <Animated.View
            style={[
              styles.tabIndicator,
              {
                backgroundColor: colors.accent,
                width: tabWidth,
                transform: [{ translateX: Animated.multiply(Animated.add(position, offset), tabWidth) }],
              },
            ]}
          />
        ) : null}
      </View>
      <AnimatedPagerView
        initialPage={index}
        onPageScroll={Animated.event([{ nativeEvent: { position, offset } }], { useNativeDriver: true })}
        onPageSelected={(event) => {
          const picked = options[event.nativeEvent.position];
          if (picked && picked.value !== value) onChange(picked.value);
        }}
        ref={pager}
        style={styles.grow}
      >
        {options.map((option) => (
          <View collapsable={false} key={option.value} style={styles.grow}>
            {renderPage(option.value, option.value === value)}
          </View>
        ))}
      </AnimatedPagerView>
    </View>
  );
}

// The screen's one primary action, in the thumb arc rather than above the
// content. Extended — the label is the affordance; a bare + on a screen that
// can create two different things says nothing about which.
export function Fab({
  label,
  icon = "add",
  onPress,
  loading = false,
}: {
  label: string;
  icon?: IconName;
  onPress: () => void;
  loading?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ busy: loading, disabled: loading }}
      disabled={loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.fab,
        { backgroundColor: pressed ? colors.accentSoft : colors.accent },
      ]}
    >
      {loading
        ? <ActivityIndicator color={colors.onAccent} />
        : <Icon color={colors.onAccent} name={icon} size={22} />}
      <Text {...dynamicType} numberOfLines={1} style={[typography.body, styles.fabLabel, { color: colors.onAccent }]}>{label}</Text>
    </Pressable>
  );
}

export type MenuItem = {
  label: string;
  accessibilityLabel?: string;
  destructive?: boolean;
  disabled?: boolean;
  /** Draws a checkmark. Use for the current choice in a one-of-N group. */
  selected?: boolean;
  /** Nested choices — renders a real submenu on both platforms. */
  items?: MenuItem[];
  /** Omitted on a row whose only job is to open a submenu. */
  onPress?: () => void;
};

/** Ids are the item's path through the tree ("2", "0.1") rather than its
 *  label: the id is what comes back on press, and a label can repeat across
 *  groups ("Title A–Z" could plausibly appear under two of them). */
function toAction(item: MenuItem, id: string): MenuAction {
  return {
    id,
    title: item.label,
    attributes: { destructive: item.destructive, disabled: item.disabled },
    // Only send `state` for rows that belong to a choice group. Sending "off"
    // everywhere indents every other row to leave space for a tick that never
    // comes.
    ...(item.selected === undefined ? null : { state: item.selected ? "on" : "off" }),
    ...(item.items ? { subactions: item.items.map((child, i) => toAction(child, `${id}.${i}`)) } : null),
  };
}

function itemAt(items: MenuItem[], path: string): MenuItem | undefined {
  let level = items;
  let found: MenuItem | undefined;
  for (const step of path.split(".")) {
    found = level[Number(step)];
    if (!found) return undefined;
    level = found.items ?? [];
  }
  return found;
}

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
      actions={items.map((item, index) => toAction(item, String(index)))}
      onPressAction={({ nativeEvent }) => {
        const item = itemAt(items, nativeEvent.event);
        if (item && !item.disabled) item.onPress?.();
      }}
      title={title}
    >
      {/* The trigger must not be a touch responder of its own. On Android
          MenuView anchors the menu to a Pressable it wraps around these
          children, and a nested Pressable (IconButton is one) captures the
          touch first, so the anchor never fires and the menu never opens.
          iOS doesn't hit this — SwiftUI's Menu intercepts above the RN host
          view — which is exactly why it needed a device to catch.

          That same pointerEvents is why this View, not the child, has to carry
          the touch target: a non-responder can't grow one, so IconButton's own
          hitSlop is dead here, and MenuView sizes its Pressable to whatever
          this box measures. Left at the glyph's size that came to 44pt of icon
          with no slop at all, in the very corner of the screen — reliably
          missable, and reported as such. */}
      <View pointerEvents="none" style={styles.menuTrigger}>{children}</View>
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
    <View style={styles.state}>
      <View style={error ? [styles.errorCard, { backgroundColor: colors.dangerSoft }] : styles.emptyCard}>
        <Text accessibilityRole="header" {...dynamicType} style={[styles.stateTitle, { color: error ? colors.danger : colors.text }]}>{title}</Text>
        {body ? <Text {...dynamicType} style={[typography.body, styles.centerText, { color: error ? colors.text : colors.textDim }]}>{body}</Text> : null}
        {actionLabel && onAction ? <Button label={actionLabel} onPress={onAction} variant={error ? "destructive" : "secondary"} /> : null}
      </View>
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
  // 48 is Material's minimum and clears HIG's 44. It is also the ceiling here:
  // padding past it measured as having no effect, because the native header
  // clamps its subview's width — verified by probing taps either side of the
  // edge on a device, not assumed.
  menuTrigger: { minWidth: 48, minHeight: 48, alignItems: "center", justifyContent: "center" },
  labelledIconButton: { minHeight: minimumTouchTarget, flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: radii.full },
  grow: { flex: 1 },
  tabRow: { flexDirection: "row", borderBottomWidth: 1 },
  tab: { flex: 1, minHeight: minimumTouchTarget, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.sm },
  tabLabel: { fontWeight: "700" },
  tabIndicator: { position: "absolute", left: 0, bottom: 0, height: 3, borderTopLeftRadius: radii.sm, borderTopRightRadius: radii.sm },
  fab: { position: "absolute", right: spacing.lg, bottom: spacing.lg, minHeight: 56, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radii.full, elevation: 6, shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  fabLabel: { fontWeight: "700" },
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
  state: { flexGrow: 1, justifyContent: "center", paddingVertical: spacing.xxl, paddingHorizontal: spacing.lg },
  emptyCard: { alignItems: "center", gap: spacing.md },
  errorCard: { alignItems: "center", gap: spacing.md, borderRadius: radii.lg, padding: spacing.lg },
  stateTitle: { ...typography.title, fontWeight: "700", textAlign: "center" },
  centerText: { textAlign: "center" },
  banner: { minHeight: minimumTouchTarget, justifyContent: "center", paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  bannerText: { fontWeight: "600", textAlign: "center" },
  modalBody: { gap: spacing.md, paddingTop: spacing.sm },
});
