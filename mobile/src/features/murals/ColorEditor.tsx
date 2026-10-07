import { Host } from "@expo/ui";
import { Slider } from "@expo/ui/jetpack-compose";
import { ColorPicker } from "@expo/ui/swift-ui";
import { normalizeHexColor, parseHexColor, toHex } from "@scripta/shared";
import { useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { Button, Input } from "../../ui";
import { Text } from "../../ui/Text";
import { radii, spacing, typography, useTheme } from "../../ui/theme";

const CHANNELS = [
  { key: "r", label: "Red" },
  { key: "g", label: "Green" },
  { key: "b", label: "Blue" },
] as const;

export function ColorEditor({ color, onChange, onDone, onCancel }: {
  color: string;
  onChange: (hex: string) => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { colors, mode } = useTheme();
  const [text, setText] = useState(color);
  const typed = normalizeHexColor(text);
  const pick = (hex: string) => {
    setText(hex);
    onChange(hex);
  };
  const edit = (next: string) => {
    setText(next);
    const hex = normalizeHexColor(next);
    if (hex) onChange(hex);
  };
  const rgb = parseHexColor(color)!;
  return (
    <View style={[styles.editor, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <View style={styles.top}>
        <View accessibilityLabel={`Sample ${color}`} style={[styles.sample, { backgroundColor: color, borderColor: colors.border }]} />
        <View style={styles.grow}>
          <Input label="Hex" value={text} onChangeText={edit} autoCapitalize="none" autoCorrect={false} maxLength={7} error={text.trim() !== "" && !typed ? "Use a color like #1a2b3c" : undefined} />
        </View>
      </View>
      {Platform.OS === "ios" ? (
        <Host matchContents={{ vertical: true }} colorScheme={mode}>
          <ColorPicker
            label="Color"
            selection={color}
            supportsOpacity={false}
            onSelectionChange={(value) => {
              const hex = normalizeHexColor(value);
              if (hex) pick(hex);
            }}
          />
        </Host>
      ) : (
        CHANNELS.map(({ key, label }) => (
          <View key={key} style={styles.channel}>
            <View style={styles.channelHead}>
              <Text style={[typography.body, { color: colors.text }]}>{label}</Text>
              <Text style={[typography.body, { color: colors.textDim }]}>{rgb[key]}</Text>
            </View>
            <Host matchContents={{ vertical: true }} colorScheme={mode}>
              <Slider value={rgb[key]} min={0} max={255} colors={{ thumbColor: colors.accent, activeTrackColor: colors.accent, inactiveTrackColor: colors.border }} onValueChange={(value) => pick(toHex({ ...rgb, [key]: value }))} />
            </Host>
          </View>
        ))
      )}
      <View style={styles.actions}>
        <Button label="Done" disabled={!typed} onPress={onDone} />
        <Button label="Cancel" variant="secondary" onPress={onCancel} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  editor: { gap: spacing.md, borderWidth: 1, borderRadius: radii.md, padding: spacing.md },
  top: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  grow: { flex: 1 },
  sample: { width: 56, height: 56, borderRadius: radii.md, borderWidth: 1, marginTop: spacing.lg },
  channel: { gap: spacing.xs },
  channelHead: { flexDirection: "row", justifyContent: "space-between" },
  actions: { flexDirection: "row", gap: spacing.sm },
});
