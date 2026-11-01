// Switches the bracket pane between the round-by-round draw and the classic
// whole-tree map. It sits at the right end of the pane's bottom strip
// rather than floating over the list: a floating button covered whatever
// scrolled under it, including the owner's Settle control.
//
// It is a toggle, so it carries its state the way a selected chip does —
// filled while the map is up, outlined while it isn't — instead of relying
// on the icon alone to say which view you would get.

import { Pressable, StyleSheet } from "react-native";
import { Icon, radii, useTheme } from "../../ui";
import { useT } from "../../i18n";

export type BracketView = "rounds" | "classic";

export function BracketViewToggle({ to, onPress }: { to: BracketView; onPress: () => void }) {
  const t = useT();
  const { colors } = useTheme();
  const showingClassic = to === "rounds";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: showingClassic }}
      accessibilityLabel={t(showingClassic ? "arena.showRounds" : "arena.showWholeBracket")}
      hitSlop={10}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: showingClassic ? colors.accent : pressed ? colors.surfacePressed : "transparent",
          borderColor: showingClassic ? colors.accent : colors.border,
        },
      ]}
    >
      <Icon name="bracket" size={18} color={showingClassic ? colors.onAccent : colors.accent} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { width: 36, height: 36, borderRadius: radii.full, alignItems: "center", justifyContent: "center", borderWidth: 1 },
});
