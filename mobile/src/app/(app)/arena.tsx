import { StyleSheet, Text, View } from "react-native";

export default function ArenaPage() {
  return (
    <View style={styles.center}>
      <Text style={styles.title}>Arena</Text>
      <Text style={styles.text}>Lands in Wave 3 (Task 5C).</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#fafaf9", padding: 24 },
  title: { fontSize: 24, fontWeight: "700", color: "#1c1917" },
  text: { fontSize: 14, color: "#78716c", marginTop: 6 },
});
