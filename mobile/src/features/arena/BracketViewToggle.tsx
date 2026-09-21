// Switches the bracket pane between the round-by-round draw and the classic
// whole-tree map, as a floating button rather than a chip in the round bar:
// the bar has to fit a 32-book bracket's five rounds without scrolling, and
// a sixth item there either wrapped to a second row or ran off the edge.
//
// It is a toggle, so it carries its state the way a selected chip does —
// filled while the map is up, outlined while it isn't — instead of relying
// on the icon alone to say which view you would get.
//
// Positioning is the caller's: the two panes float it at different heights,
// since only one of them has a round bar underneath it.

import { Pressable, StyleSheet } from "react-native";
import { Icon, radii, useTheme } from "../../ui";

export type BracketView = "rounds" | "classic";

export function BracketViewToggle({ to, onPress }: { to: BracketView; onPress: () => void }) {
  const { colors } = useTheme();
  const showingClassic = to === "rounds";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: showingClassic }}
      accessibilityLabel={showingClassic ? "Show the bracket round by round" : "Show the whole bracket at once"}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [
        styles.fab,
        {
          backgroundColor: showingClassic ? colors.accent : pressed ? colors.surfacePressed : colors.surface,
          borderColor: showingClassic ? colors.accent : colors.border,
        },
      ]}
    >
      <Icon name="bracket" size={22} color={showingClassic ? colors.onAccent : colors.accent} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: { width: 48, height: 48, borderRadius: radii.full, alignItems: "center", justifyContent: "center", borderWidth: 1, elevation: 6, shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
});
