import { useEffect, useMemo, useState } from "react";
import { BackHandler, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { hasChosen, readerCardInputOf, saveFailureMessage, type ReaderCardPage, type ReaderCardStylePatch } from "@scripta/shared";
import { useAuth } from "../../core/auth";
import { Button, Toast, minimumTouchTarget, spacing, typography, useTheme } from "../../ui";
import { Text } from "../../ui/Text";
import { useLibrary } from "../library/hooks/useLibrary";
import { NO_GROUPS } from "../murals/MuralCanvas";
import { PLATE_RATIO } from "../murals/ReaderCardImage";
import { ReaderCardTurner } from "../murals/ReaderCardTurner";
import { HighlightChoice, SignatureChoice } from "./ReaderCardChoices";
import { FrontOptions, GroupHeader, LayoutOption, ReaderCardPanel, useMotto, type PanelId } from "./ReaderCardOptions";
import { ReaderGlyphSetting } from "./ReaderGlyphSetting";
import { useOwnCardStyle, useReaderCardStyle, useSaveReaderCardStyle } from "./useReaderCardStyle";

const NO_BOOKS: Array<Record<string, unknown>> = [];
const PREVIEW_MAX = 280;
const PIN_SHARE = 0.4;
const BACK_KEYS = ["layout", "signature", "highlight"];
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
  const [panel, setPanel] = useState<PanelId | null>(null);
  const [face, setFace] = useState<{ page: ReaderCardPage } | undefined>();
  const own = useOwnCardStyle();
  const input = useMemo(() => readerCardInputOf(books, groups, readerName, undefined, own), [books, groups, readerName, own]);
  const width = Math.min(windowWidth - spacing.xl * 2, PREVIEW_MAX, (windowHeight * PIN_SHARE - PIN_CHROME) / PLATE_RATIO);

  const change = async (patch: ReaderCardStylePatch) => {
    setError(null);
    try {
      await save(patch);
      setFace({ page: Object.keys(patch).some((key) => BACK_KEYS.includes(key)) ? "chosen" : "front" });
      return true;
    } catch (reason) {
      setError(saveFailureMessage(reason, "Couldn't save your reader card."));
      return false;
    }
  };

  const motto = useMotto(input, change);

  useEffect(() => {
    if (panel === null) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      setPanel(null);
      return true;
    });
    return () => subscription.remove();
  }, [panel]);

  const openPanel = (next: PanelId) => {
    setPanel(next);
    setFace({ page: "front" });
  };

  if (!style) {
    if (isPending) return <Text style={[typography.body, styles.pad, { color: colors.textDim }]}>Loading your reader card…</Text>;
    return <View style={styles.pad}><Button label="Couldn't load your reader card. Try again" onPress={() => void refetch()} /></View>;
  }

  return (
    <View style={styles.screen}>
      <View style={[styles.pinned, { backgroundColor: colors.background }]}>
        <ReaderCardTurner key={`${input.view}-${input.style.layout}-${hasChosen(input.card.chosen)}`} input={input} width={width} page={face} />
      </View>
      {error ? <View style={styles.notice}><Toast visible message={error} tone="error" /></View> : null}
      <View style={styles.options}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.page} accessibilityElementsHidden={panel !== null} importantForAccessibility={panel === null ? "auto" : "no-hide-descendants"}>
          {input.card.state === "unwritten" && input.missing ? <Text style={[typography.body, { color: colors.textDim }]}>{input.missing}</Text> : null}
          <GroupHeader title="Front" />
          <FrontOptions input={input} motto={motto} onChange={change} onOpen={openPanel} />
          <GroupHeader title="Back" />
          <LayoutOption layout={input.style.layout} onChange={change} />
          <SignatureChoice books={books} signature={style.signature} chosen={input.card.chosen?.signature} onChange={change} />
          <HighlightChoice books={books} highlight={style.highlight} chosen={input.card.chosen?.highlight} onChange={change} />
          <GroupHeader title="Your glyph" />
          <ReaderGlyphSetting username={readerName} books={books} groups={groups} />
        </ScrollView>
        {panel === null ? null : <ReaderCardPanel panel={panel} input={input} motto={motto} onChange={change} onClose={() => setPanel(null)} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  pinned: { paddingTop: spacing.sm, paddingBottom: spacing.sm },
  notice: { paddingHorizontal: spacing.xl },
  options: { flex: 1 },
  page: { padding: spacing.xl, gap: spacing.lg, paddingBottom: spacing.huge },
  pad: { padding: spacing.xl },
});
