import AsyncStorage from "@react-native-async-storage/async-storage";
import { readSavedBlockLooks, saveBlockLook, savedBlockLooksKey, type BlockStyle, type SavedBlockLook } from "@scripta/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { View } from "react-native";
import { useAuth } from "../../core/auth";
import { Button, Input } from "../../ui";
import { Text } from "../../ui/Text";
import { spacing, typography, useTheme } from "../../ui/theme";

export function SavedLooks({ style, onApply }: { style: BlockStyle; onApply: (style: BlockStyle) => void }) {
  const { user } = useAuth();
  const { colors } = useTheme();
  const client = useQueryClient();
  const [name, setName] = useState("");
  const queryKey = ["mural-block-looks", user?.id];
  const key = savedBlockLooksKey(user?.id ?? "");
  const looks = useQuery({ queryKey, queryFn: async () => readSavedBlockLooks(await AsyncStorage.getItem(key)), enabled: !!user, retry: false });
  const save = useMutation({
    mutationFn: async (next: SavedBlockLook[]) => { await AsyncStorage.setItem(key, JSON.stringify(next)); return next; },
    onSuccess: (next) => { client.setQueryData(queryKey, next); setName(""); },
  });
  const ready = !!user && looks.isSuccess && !looks.isFetching && !save.isPending;
  return <View style={{ gap: spacing.sm }}>
    <Text style={[typography.caption, { color: colors.textDim }]}>Saved on this device for your account. The same name replaces a look.</Text>
    {looks.isPending ? <Text style={typography.caption}>Loading looks…</Text> : null}
    {looks.isError ? <>
      <Text accessibilityLiveRegion="polite" style={[typography.caption, { color: colors.danger }]}>Could not load saved looks.</Text>
      <Button label="Retry" variant="secondary" onPress={() => { void looks.refetch(); }} />
    </> : null}
    {(looks.data ?? []).map((look) => <View key={look.name} style={{ flexDirection: "row", gap: spacing.sm, alignItems: "center" }}>
      <View style={{ flex: 1 }}><Button label={look.name} variant="secondary" disabled={!ready} onPress={() => onApply({ ...look.style, cardBorderSides: { ...look.style.cardBorderSides } })} /></View>
      <Button label="Delete" accessibilityLabel={`Delete ${look.name}`} variant="secondary" disabled={!ready} onPress={() => save.mutate(looks.data!.filter((item) => item.name !== look.name))} />
    </View>)}
    <Input label="Look name" value={name} onChangeText={setName} maxLength={48} placeholder="My reading corner" />
    <Button label="Save current look" variant="secondary" disabled={!ready || !name.trim()} onPress={() => save.mutate(saveBlockLook(looks.data!, name, style))} />
    {save.isError ? <Text accessibilityLiveRegion="polite" style={[typography.caption, { color: colors.danger }]}>Could not save looks. Try again.</Text> : null}
  </View>;
}
