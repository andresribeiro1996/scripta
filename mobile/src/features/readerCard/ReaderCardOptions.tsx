import { useMemo } from "react";
import { FlatList, StyleSheet } from "react-native";
import { COUNTERS, COUNTER_LABELS, LAYOUTS, LAYOUT_LABELS, TRAITS, TRAIT_LABELS, counterThumbnail, type ReaderCardBase, type ReaderCardStylePatch } from "@scripta/shared";
import { Segmented, spacing } from "../../ui";
import { Section, Tile } from "../library/components/StyleControls";
import { ReaderCardImage } from "../murals/ReaderCardImage";

const THUMB_WIDTH = 72;
const TRAIT_OPTIONS = TRAITS.map((value) => ({ value, label: TRAIT_LABELS[value] }));
const LAYOUT_OPTIONS = LAYOUTS.map((value) => ({ value, label: LAYOUT_LABELS[value] }));

export function ReaderCardOptions({ input, onChange }: { input: ReaderCardBase; onChange: (patch: ReaderCardStylePatch) => void }) {
  const { counter, trait, layout } = input.style;
  const thumbnails = useMemo(() => COUNTERS.map((option) => ({ option, input: counterThumbnail(input, option) })), [input]);
  return (
    <>
      <Section title="Counter">
        <FlatList
          horizontal
          data={thumbnails}
          keyExtractor={(item) => item.option}
          initialNumToRender={3}
          windowSize={3}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.row}
          renderItem={({ item }) => (
            <Tile label={COUNTER_LABELS[item.option]} selected={counter === item.option} onPress={() => onChange({ counter: item.option })}>
              <ReaderCardImage input={item.input} width={THUMB_WIDTH} />
            </Tile>
          )}
        />
      </Section>
      <Section title="Second trait">
        <Segmented accessibilityLabel="Second trait" options={TRAIT_OPTIONS} value={trait} onChange={(next) => onChange({ trait: next })} />
      </Section>
      <Section title="Layout">
        <Segmented accessibilityLabel="Layout" options={LAYOUT_OPTIONS} value={layout} onChange={(next) => onChange({ layout: next })} />
      </Section>
    </>
  );
}

const styles = StyleSheet.create({ row: { gap: spacing.sm } });
