import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { hasChosen, readerCardInputOf, saveFailureMessage, visitorView, type ReaderCardStylePatch } from "@scripta/shared";
import { useAuth } from "../../core/auth";
import { Button, Segmented, Toast, spacing, typography, useTheme } from "../../ui";
import { Text } from "../../ui/Text";
import { useLibrary } from "../library/hooks/useLibrary";
import { NO_GROUPS } from "../murals/MuralCanvas";
import { ReaderCardTurner } from "../murals/ReaderCardTurner";
import { HighlightChoice, SignatureChoice } from "./ReaderCardChoices";
import { ReaderCardOptions } from "./ReaderCardOptions";
import { ReaderGlyphSetting } from "./ReaderGlyphSetting";
import { coverOf, useReaderCardStyle, useSaveReaderCardStyle } from "./useReaderCardStyle";

const NO_BOOKS: Array<Record<string, unknown>> = [];
const PREVIEW_MAX = 280;
const AUDIENCES = [{ value: "you", label: "You" }, { value: "visitors", label: "Visitors" }] as const;

export function ReaderCardEditorScreen() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const readerName = user?.username ?? "reader";
  const { width: windowWidth } = useWindowDimensions();
  const { data: library } = useLibrary();
  const books = library?.data.books ?? NO_BOOKS;
  const groups = library?.data.groups ?? NO_GROUPS;
  const { data: style, isPending, isError, refetch } = useReaderCardStyle();
  const save = useSaveReaderCardStyle();
  const [audience, setAudience] = useState<"you" | "visitors">("you");
  const [error, setError] = useState<string | null>(null);
  const input = useMemo(() => readerCardInputOf(books, groups, readerName, undefined, style ? { style, coverOf } : undefined), [books, groups, readerName, style]);
  const preview = useMemo(() => (audience === "you" ? input : visitorView(input)), [audience, input]);
  const width = Math.min(windowWidth - spacing.xl * 2, PREVIEW_MAX);

  const change = async (patch: ReaderCardStylePatch) => {
    setError(null);
    try {
      await save(patch);
      return true;
    } catch (reason) {
      setError(saveFailureMessage(reason, "Couldn't save your reader card."));
      return false;
    }
  };

  if (isPending) return <Text style={[typography.body, styles.pad, { color: colors.textDim }]}>Loading your reader card…</Text>;
  if (isError || !style) return <View style={styles.pad}><Button label="Couldn't load your reader card. Try again" onPress={() => void refetch()} /></View>;

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.page}>
      <Segmented accessibilityLabel="Preview as" options={AUDIENCES} value={audience} onChange={setAudience} />
      <ReaderCardTurner key={`${preview.view}-${preview.style.layout}-${hasChosen(preview.card.chosen)}`} input={preview} width={width} />
      {input.card.state === "unwritten" && input.missing ? <Text style={[typography.body, { color: colors.textDim }]}>{input.missing}</Text> : null}
      {error ? <Toast visible message={error} tone="error" /> : null}
      <ReaderCardOptions input={input} onChange={(patch) => void change(patch)} />
      <SignatureChoice books={books} signature={style.signature} chosen={input.card.chosen?.signature} onChange={change} />
      <HighlightChoice books={books} highlight={style.highlight} chosen={input.card.chosen?.highlight} onChange={change} />
      <ReaderGlyphSetting username={readerName} books={books} groups={groups} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.xl, gap: spacing.lg, paddingBottom: spacing.huge },
  pad: { padding: spacing.xl },
});
