import { Pressable, StyleSheet, View } from "react-native";
import { BOOK_GENRES, type BookGenre } from "@scripta/shared";
import { Text } from "../../../ui/Text";
import { radii, spacing, useTheme } from "../../../ui/theme";

export function GenreChoices({ value, onChange }: { value: readonly BookGenre[]; onChange: (next: BookGenre[]) => void }) {
  const { colors } = useTheme();
  return (
    <View style={styles.choices}>
      {BOOK_GENRES.map((genre) => {
        const checked = value.includes(genre);
        return (
          <Pressable
            key={genre}
            accessibilityRole="checkbox"
            accessibilityState={{ checked }}
            onPress={() => onChange(checked ? value.filter((item) => item !== genre) : [...value, genre])}
            style={[styles.choice, { backgroundColor: checked ? colors.accentSoft : colors.surface, borderColor: checked ? colors.accent : colors.border }]}
          >
            <Text style={{ color: checked ? colors.accent : colors.text }}>{genre}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  choices: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  choice: { borderWidth: 1, borderRadius: radii.full, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
});
