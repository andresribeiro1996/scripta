import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import { SvgXml } from "react-native-svg";
import { PLATE_FONTS, READER_PLATES, readerCardLabel, readerCardPlateLine, readerIdentity, renderPlate, type Group, type PublicReaderCard } from "@scripta/shared";
import { Sheet, cardFontFamily, spacing, typography, useTheme } from "../../ui";

const PLATE_RATIO = 350 / 250;
const SHEET_PLATE_MAX = 280;

export function ReaderCardBlock({ books, groups, readerName, publicCard, editable }: { books: Array<Record<string, unknown>>; groups: Group[]; readerName: string; publicCard?: PublicReaderCard; editable?: boolean }) {
  const { colors, mode } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const own = useMemo(() => (publicCard ? null : readerIdentity(books, groups)), [books, groups, publicCard]);
  const card = publicCard ?? own!;
  const label = readerCardLabel(card);
  const unwrittenLine = own ? readerCardPlateLine(own.missing) : "yet to be written";
  const xml = useMemo(() => {
    const svg = renderPlate({ identity: card.identity, state: card.state, readerName, print: mode === "dark" ? "reversed" : "paper", label, unwrittenLine });
    return svg.replaceAll(PLATE_FONTS.serif, cardFontFamily("playfairDisplay")).replaceAll(PLATE_FONTS.sans, cardFontFamily("sans"));
  }, [card, readerName, mode, label, unwrittenLine]);
  const plateOf = (key: string | null) => READER_PLATES.find((plate) => plate.key === key);
  const name = (key: string | null) => plateOf(key)?.name;
  const epithet = plateOf(card.identity)?.epithet;
  const onLayout = (event: LayoutChangeEvent) => setBox(event.nativeEvent.layout);
  const width = Math.max(0, Math.min(box.width, box.height / PLATE_RATIO));
  const plate = width > 0 ? <SvgXml xml={xml} width={width} height={width * PLATE_RATIO} /> : null;
  const sheetPlateWidth = Math.min(windowWidth - spacing.xl * 2, SHEET_PLATE_MAX);
  return (
    <>
      <View onLayout={onLayout} style={styles.plateBox}>
        {editable
          ? plate
          : <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => setOpen(true)} style={{ width, height: width * PLATE_RATIO }}>{plate}</Pressable>}
      </View>
      <Sheet visible={open} title={card.identity ? `The ${name(card.identity)}` : "Unwritten"} onClose={() => setOpen(false)}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheet}>
          <SvgXml xml={xml} width={sheetPlateWidth} height={sheetPlateWidth * PLATE_RATIO} />
          {epithet ? <Text style={[typography.caption, styles.epithet, { color: colors.textDim }]}>{epithet}</Text> : null}
          {card.runnerUp ? <Text style={[typography.body, { color: colors.text }]}>Leaning between the {name(card.identity)} and the {name(card.runnerUp)}</Text> : null}
          {card.signal ? <Text style={[typography.body, { color: colors.text }]}>{card.signal.label}</Text> : null}
          {card.coverage.map((line) => <Text key={line} style={[typography.caption, { color: colors.textDim }]}>{line}</Text>)}
          {own?.leaders.map((leader) => <Text key={leader.label} style={[typography.body, { color: colors.text }]}>{leader.label} ({leader.count})</Text>)}
          {own?.missing ? <Text style={[typography.body, { color: colors.textDim }]}>{own.missing}</Text> : null}
        </ScrollView>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  plateBox: { flex: 1, alignItems: "center", justifyContent: "center" },
  sheet: { gap: spacing.sm, paddingBottom: spacing.xl },
  epithet: { fontStyle: "italic" },
});
