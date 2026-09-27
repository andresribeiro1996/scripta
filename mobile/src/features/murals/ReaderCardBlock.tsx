import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SvgXml } from "react-native-svg";
import { READER_PLATES, readerCardLabel, readerCardPlateLine, readerIdentity, renderPlate, type Group, type PublicReaderCard } from "@scripta/shared";
import { Sheet, spacing, typography, useTheme } from "../../ui";

export function ReaderCardBlock({ books, groups, readerName, publicCard, editable }: { books: Array<Record<string, unknown>>; groups: Group[]; readerName: string; publicCard?: PublicReaderCard; editable?: boolean }) {
  const { colors, mode } = useTheme();
  const [open, setOpen] = useState(false);
  const own = useMemo(() => (publicCard ? null : readerIdentity(books, groups)), [books, groups, publicCard]);
  const card = publicCard ?? own!;
  const label = readerCardLabel(card);
  const xml = useMemo(() => renderPlate({ identity: card.identity, state: card.state, readerName, print: mode === "dark" ? "reversed" : "paper", label, unwrittenLine: readerCardPlateLine(own?.missing ?? null) }), [card, readerName, mode, label, own]);
  const plateOf = (key: string | null) => READER_PLATES.find((plate) => plate.key === key);
  const name = (key: string | null) => plateOf(key)?.name;
  const epithet = plateOf(card.identity)?.epithet;
  const plate = <SvgXml xml={xml} width="100%" height="100%" />;
  return (
    <>
      {editable
        ? <View accessibilityLabel={label} style={styles.plate}>{plate}</View>
        : <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => setOpen(true)} style={styles.plate}>{plate}</Pressable>}
      <Sheet visible={open} title={card.identity ? `The ${name(card.identity)}` : "Unwritten"} onClose={() => setOpen(false)}>
        <View style={styles.sheet}>
          {epithet ? <Text style={[typography.caption, styles.epithet, { color: colors.textDim }]}>{epithet}</Text> : null}
          {card.runnerUp ? <Text style={[typography.body, { color: colors.text }]}>Leaning between the {name(card.identity)} and the {name(card.runnerUp)}</Text> : null}
          {card.signal ? <Text style={[typography.body, { color: colors.text }]}>{card.signal.label}</Text> : null}
          {card.coverage.map((line) => <Text key={line} style={[typography.caption, { color: colors.textDim }]}>{line}</Text>)}
          {own?.leaders.map((leader) => <Text key={leader.label} style={[typography.body, { color: colors.text }]}>{leader.label} ({leader.count})</Text>)}
          {own?.missing ? <Text style={[typography.body, { color: colors.textDim }]}>{own.missing}</Text> : null}
        </View>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  plate: { flex: 1, aspectRatio: 5 / 7, alignSelf: "center" },
  sheet: { gap: spacing.sm },
  epithet: { fontStyle: "italic" },
});
