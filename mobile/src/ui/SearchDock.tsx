import { useEffect, useRef, type ReactNode, type Ref } from "react";
import { Keyboard, Pressable, StyleSheet, TextInput, View, type TextInputInstance } from "react-native";
import { Icon, type IconName } from "./icon";
import { Input, Menu, type MenuItem } from "./components";
import { ScrollDock, scrollDockFabHeight, type SearchDockScrollProps } from "./ScrollDock";
import { minimumTouchTarget, radii, spacing, useTheme } from "./theme";

export const searchDockClearance = minimumTouchTarget + spacing.lg * 2;
export const searchDockFabClearance = searchDockClearance + scrollDockFabHeight + spacing.lg;

export type { SearchDockScrollProps } from "./ScrollDock";

export function SearchDock({
  value,
  onChangeText,
  accessibilityLabel,
  placeholder,
  cycle,
  fab,
  hidden = false,
  onSubmitEditing,
  inputRef,
  children,
}: {
  value: string;
  onChangeText: (text: string) => void;
  accessibilityLabel: string;
  placeholder: string;
  cycle?: {
    icon: IconName;
    active: boolean;
    accessibilityLabel: string;
    accessibilityHint?: string;
    onPress?: () => void;
    menu?: { title: string; items: MenuItem[] };
  };
  fab?: ReactNode;
  hidden?: boolean;
  onSubmitEditing?: () => void;
  inputRef?: Ref<TextInputInstance>;
  children: (scrollProps: SearchDockScrollProps) => ReactNode;
}) {
  const { colors } = useTheme();
  const input = useRef<TextInputInstance | null>(null);
  const setInput = (node: TextInputInstance | null) => {
    input.current = node;
    if (typeof inputRef === "function") inputRef(node);
    else if (inputRef) inputRef.current = node;
  };

  useEffect(() => {
    const hiding = Keyboard.addListener("keyboardDidHide", () => input.current?.blur());
    return () => hiding.remove();
  }, []);

  const cycleButton = cycle ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={cycle.accessibilityLabel}
      accessibilityHint={cycle.accessibilityHint}
      onPress={cycle.onPress}
      style={[styles.cycle, { borderColor: colors.border, backgroundColor: cycle.active ? colors.accentSoft : colors.surface }]}
    >
      <Icon name={cycle.icon} size={20} color={cycle.active ? colors.text : colors.textDim} />
    </Pressable>
  ) : null;

  const bar = (
    <View style={styles.row}>
      <View style={styles.grow}>
        <Input
          icon="search"
          accessibilityLabel={accessibilityLabel}
          value={value}
          onChangeText={onChangeText}
          onSubmitEditing={onSubmitEditing}
          ref={setInput}
          placeholder={placeholder}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          style={styles.searchField}
        />
      </View>
      {cycleButton ? <View style={styles.cycleSlot}>{cycle?.menu ? <Menu title={cycle.menu.title} items={cycle.menu.items}>{cycleButton}</Menu> : cycleButton}</View> : null}
    </View>
  );

  return <ScrollDock bar={bar} fab={fab} hidden={hidden}>{children}</ScrollDock>;
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md },
  searchField: { borderRadius: radii.full },
  cycleSlot: { minWidth: 48, minHeight: 48, alignItems: "center", justifyContent: "center" },
  cycle: { alignItems: "center", justifyContent: "center", width: minimumTouchTarget, height: minimumTouchTarget, borderWidth: 1, borderRadius: radii.full },
});
