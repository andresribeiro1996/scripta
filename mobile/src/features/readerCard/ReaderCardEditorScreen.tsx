import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { hasChosen, readerCardInputOf, saveFailureMessage, type ReaderCardStylePatch } from "@scripta/shared";
import { useAuth } from "../../core/auth";
import { Button, Toast, minimumTouchTarget, spacing, typography, useTheme } from "../../ui";
import { Text } from "../../ui/Text";
import { useLibrary } from "../library/hooks/useLibrary";
import { NO_GROUPS } from "../murals/MuralCanvas";
import { PLATE_RATIO } from "../murals/ReaderCardImage";
import { ReaderCardTurner } from "../murals/ReaderCardTurner";
import { HighlightChoice, SignatureChoice } from "./ReaderCardChoices";
import { ReaderCardOptions } from "./ReaderCardOptions";
import { ReaderGlyphSetting } from "./ReaderGlyphSetting";
import { useOwnCardStyle, useReaderCardStyle, useSaveReaderCardStyle } from "./useReaderCardStyle";

const NO_BOOKS: Array<Record<string, unknown>> = [];
const PREVIEW_MAX = 280;
const PIN_SHARE = 0.4;
const PIN_CHROME = minimumTouchTarget + spacing.md + spacing.sm * 2;

export function ReaderCardEditorScreen() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const readerName = user?.username ?? "reader";
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const { data: library } = useLibrary();
  const books = library?.data.books ?? NO_BOOKS;
  const groups = library?.data.groups ?? NO_GROUPS;
  const { data: style, isPending, refetch } = useReaderCardStyle();
  const save = useSaveReaderCardStyle();
  const [error, setError] = useState<string | null>(null);
  const own = useOwnCardStyle();
  const input = useMemo(() => readerCardInputOf(books, groups, readerName, undefined, own), [books, groups, readerName, own]);
  const width = Math.min(windowWidth - spacing.xl * 2, PREVIEW_MAX, (windowHeight * PIN_SHARE - PIN_CHROME) / PLATE_RATIO);

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

  if (!style) {
    if (isPending) return <Text style={[typography.body, styles.pad, { color: colors.textDim }]}>Loading your reader card…</Text>;
    return <View style={styles.pad}><Button label="Couldn't load your reader card. Try again" onPress={() => void refetch()} /></View>;
  }

  return (
    <View style={styles.screen}>
      <View style={[styles.pinned, { backgroundColor: colors.background }]}>
        <ReaderCardTurner key={`${input.view}-${input.style.layout}-${hasChosen(input.card.chosen)}`} input={input} width={width} />
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.page}>
        {input.card.state === "unwritten" && input.missing ? <Text style={[typography.body, { color: colors.textDim }]}>{input.missing}</Text> : null}
        {error ? <Toast visible message={error} tone="error" /> : null}
        <ReaderCardOptions input={input} onChange={change} />
        <SignatureChoice books={books} signature={style.signature} chosen={input.card.chosen?.signature} onChange={change} />
        <HighlightChoice books={books} highlight={style.highlight} chosen={input.card.chosen?.highlight} onChange={change} />
        <ReaderGlyphSetting username={readerName} books={books} groups={groups} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  pinned: { paddingTop: spacing.sm, paddingBottom: spacing.sm },
  page: { padding: spacing.xl, gap: spacing.lg, paddingBottom: spacing.huge },
  pad: { padding: spacing.xl },
});
