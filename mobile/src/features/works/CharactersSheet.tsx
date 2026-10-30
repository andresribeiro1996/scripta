import { router } from "expo-router";
import { ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { Text } from "../../ui/Text";
import { Button, Sheet, dynamicType, minimumTouchTarget, spacing, typography, useDismissThen, useTheme } from "../../ui";

const LIST_HEIGHT_FRACTION = 0.6;

export function CharactersSheet({ characters, gamePath, visible, onClose }: { characters: string[]; gamePath: string | null; visible: boolean; onClose: () => void }) {
  const { colors } = useTheme();
  const { height } = useWindowDimensions();
  const { then, onDismiss } = useDismissThen(visible, onClose);
  return (
    <Sheet visible={visible} title="Characters" onClose={onClose} onDismiss={onDismiss}>
      <ScrollView style={[styles.list, { maxHeight: height * LIST_HEIGHT_FRACTION }]}>
        {characters.map((name) => (
          <View key={name} style={styles.row}>
            <Text {...dynamicType} style={[typography.body, { color: colors.text }]}>{name}</Text>
          </View>
        ))}
        {gamePath ? (
          <View style={styles.action}>
            <Button label="Make a character game" variant="secondary" onPress={() => then(() => router.push(gamePath as never))} />
          </View>
        ) : null}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { flexGrow: 0 },
  row: { minHeight: minimumTouchTarget, justifyContent: "center" },
  action: { marginTop: spacing.md }
});
