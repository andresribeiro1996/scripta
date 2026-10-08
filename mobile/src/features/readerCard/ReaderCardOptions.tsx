import { useDeferredValue, useMemo, useRef, useState } from "react";
import { FlatList, ScrollView, StyleSheet } from "react-native";
import { CARD_PRINTS, CORNER_LABELS, CORNER_STYLES, COUNTERS, COUNTER_LABELS, FOOTER_LEFTS, FOOTER_LEFT_LABELS, FOOTER_RIGHTS, FOOTER_RIGHT_LABELS, LAYOUTS, LAYOUT_LABELS, MOTTO_LOOKS, MOTTO_LOOK_LABELS, MOTTO_MAX, PRINT_LABELS, TRAITS, TRAIT_LABELS, cardRatio, counterThumbnail, styleThumbnail, type MottoLook, type ReaderCardBase } from "@scripta/shared";
import { Segmented, spacing } from "../../ui";
import { Chip, Section, Tile } from "../library/components/StyleControls";
import { ReaderCardImage } from "../murals/ReaderCardImage";
import { DraftField } from "./DraftField";
import type { SaveStyle } from "./ReaderCardChoices";

const THUMB_WIDTH = 72;
const CORNER_WIDTH = 56;
const TILE_PADDING = 8;
const SAMPLE_MOTTO = "Per libros ad astra";
const options = <T extends string>(keys: readonly T[], labels: Record<T, string>) => keys.map((value) => ({ value, label: labels[value] }));
const TRAIT_OPTIONS = options(TRAITS, TRAIT_LABELS);
const LAYOUT_OPTIONS = options(LAYOUTS, LAYOUT_LABELS);
const PRINT_OPTIONS = options(CARD_PRINTS, PRINT_LABELS);

function TileRow<T extends string>({ items, width, value, labels, onPick }: { items: Array<{ option: T; input: ReaderCardBase }>; width: number; value: T | null; labels: Record<T, string>; onPick: (option: T) => void }) {
  return (
    <FlatList
      horizontal
      data={items}
      keyExtractor={(item) => item.option}
      initialNumToRender={3}
      windowSize={3}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      renderItem={({ item }) => (
        <Tile width={width + TILE_PADDING} tileWidth={width + TILE_PADDING} height={width * cardRatio(item.input.crop) + TILE_PADDING} label={labels[item.option]} selected={value === item.option} onPress={() => onPick(item.option)}>
          <ReaderCardImage input={item.input} width={width} />
        </Tile>
      )}
    />
  );
}

function ChipRow<T extends string>({ keys, labels, value, onPick }: { keys: readonly T[]; labels: Record<T, string>; value: T; onPick: (option: T) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {keys.map((key) => <Chip key={key} label={labels[key]} selected={value === key} onPress={() => onPick(key)} />)}
    </ScrollView>
  );
}

export function ReaderCardOptions({ input, onChange }: { input: ReaderCardBase; onChange: SaveStyle }) {
  const { counter, trait, layout, motto, footer, corners, print } = input.style;
  const [look, setLook] = useState<MottoLook>(motto?.look ?? "ribbon");
  const lastText = useRef(motto?.text ?? null);
  const deferred = useDeferredValue(input);
  const counterThumbs = useMemo(() => COUNTERS.map((option) => ({ option, input: counterThumbnail(deferred, option) })), [deferred]);
  const mottoThumbs = useMemo(() => MOTTO_LOOKS.map((option) => ({ option, input: styleThumbnail(deferred, { motto: { text: deferred.style.motto?.text ?? SAMPLE_MOTTO, look: option } }, "motto") })), [deferred]);
  const cornerThumbs = useMemo(() => CORNER_STYLES.map((option) => ({ option, input: styleThumbnail(deferred, { corners: option }, "corner") })), [deferred]);
  const saveMotto = (text: string | null) => {
    const previous = lastText.current;
    lastText.current = text;
    return onChange({ motto: text ? { text, look } : null }).then((saved) => {
      if (!saved && lastText.current === text) lastText.current = previous;
      return saved;
    });
  };
  const pickLook = (next: MottoLook) => {
    const previous = look;
    setLook(next);
    if (!lastText.current) return;
    void onChange({ motto: { text: lastText.current, look: next } }).then((saved) => {
      if (!saved) setLook(previous);
    });
  };
  return (
    <>
      <Section title="Counter">
        <TileRow items={counterThumbs} width={THUMB_WIDTH} value={counter} labels={COUNTER_LABELS} onPick={(next) => void onChange({ counter: next })} />
      </Section>
      <Section title="Second trait">
        <Segmented accessibilityLabel="Second trait" options={TRAIT_OPTIONS} value={trait} onChange={(next) => void onChange({ trait: next })} />
      </Section>
      <Section title="Motto">
        <DraftField label="Your motto" initial={motto?.text ?? null} max={MOTTO_MAX} onSave={saveMotto} />
        <TileRow items={mottoThumbs} width={THUMB_WIDTH} value={motto?.look ?? look} labels={MOTTO_LOOK_LABELS} onPick={pickLook} />
      </Section>
      <Section title="Footer, left">
        <ChipRow keys={FOOTER_LEFTS} labels={FOOTER_LEFT_LABELS} value={footer.left} onPick={(left) => void onChange({ footer: { ...footer, left } })} />
      </Section>
      <Section title="Footer, right">
        <ChipRow keys={FOOTER_RIGHTS} labels={FOOTER_RIGHT_LABELS} value={footer.right} onPick={(right) => void onChange({ footer: { ...footer, right } })} />
      </Section>
      <Section title="Corners">
        <TileRow items={cornerThumbs} width={CORNER_WIDTH} value={corners} labels={CORNER_LABELS} onPick={(next) => void onChange({ corners: next })} />
      </Section>
      <Section title="Print">
        <Segmented accessibilityLabel="Print" options={PRINT_OPTIONS} value={print} onChange={(next) => void onChange({ print: next })} />
      </Section>
      <Section title="Layout">
        <Segmented accessibilityLabel="Layout" options={LAYOUT_OPTIONS} value={layout} onChange={(next) => void onChange({ layout: next })} />
      </Section>
    </>
  );
}

const styles = StyleSheet.create({ row: { gap: spacing.sm } });
