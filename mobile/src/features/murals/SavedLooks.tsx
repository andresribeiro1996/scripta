import AsyncStorage from "@react-native-async-storage/async-storage";
import { readSavedBlockLooks, saveBlockLook, savedBlockLooksKey, type BlockStyle, type SavedBlockLook } from "@scripta/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { View } from "react-native";
import { useAuth } from "../../core/auth";
import { Button, Input } from "../../ui";
import { Text } from "../../ui/Text";
import { spacing, typography, useTheme } from "../../ui/theme";
import { useLocale, useT } from "../../i18n";

export function SavedLooks({ style, onApply }: { style: BlockStyle; onApply: (style: BlockStyle) => void }) {
  const locale = useLocale();
  const t = useT();
  const { user } = useAuth();
  const { colors } = useTheme();
  const client = useQueryClient();
  const [name, setName] = useState("");
  const queryKey = ["mural-block-looks", user?.id];
  const key = savedBlockLooksKey(user?.id ?? "");
  const looks = useQuery({ queryKey, queryFn: async () => readSavedBlockLooks(await AsyncStorage.getItem(key), locale), enabled: !!user, retry: false });
  const save = useMutation({
    mutationFn: async (next: SavedBlockLook[]) => { await AsyncStorage.setItem(key, JSON.stringify(next)); return next; },
    onSuccess: (next) => { client.setQueryData(queryKey, next); setName(""); },
  });
  const ready = !!user && looks.isSuccess && !looks.isFetching && !save.isPending;
  return <View style={{ gap: spacing.sm }}>
    <Text style={[typography.caption, { color: colors.textDim }]}>{t("murals.savedLooksNote")}</Text>
    {looks.isPending ? <Text style={typography.caption}>{t("murals.loadingLooks")}</Text> : null}
    {looks.isError ? <>
      <Text accessibilityLiveRegion="polite" style={[typography.caption, { color: colors.danger }]}>{t("murals.looksLoadFailed")}</Text>
      <Button label={t("shell.retry")} variant="secondary" onPress={() => { void looks.refetch(); }} />
    </> : null}
    {(looks.data ?? []).map((look) => <View key={look.name} style={{ flexDirection: "row", gap: spacing.sm, alignItems: "center" }}>
      <View style={{ flex: 1 }}><Button label={look.name} variant="secondary" disabled={!ready} onPress={() => onApply({ ...look.style, cardBorderSides: { ...look.style.cardBorderSides } })} /></View>
      <Button label={t("library.delete")} accessibilityLabel={t("murals.deleteLook", { name: look.name })} variant="secondary" disabled={!ready} onPress={() => save.mutate(looks.data!.filter((item) => item.name !== look.name))} />
    </View>)}
    <Input label={t("murals.lookName")} value={name} onChangeText={setName} maxLength={48} placeholder={t("murals.lookNamePlaceholder")} />
    <Button label={t("murals.saveCurrentLook")} variant="secondary" disabled={!ready || !name.trim()} onPress={() => save.mutate(saveBlockLook(looks.data!, name, style, locale))} />
    {save.isError ? <Text accessibilityLiveRegion="polite" style={[typography.caption, { color: colors.danger }]}>{t("murals.looksSaveFailed")}</Text> : null}
  </View>;
}
