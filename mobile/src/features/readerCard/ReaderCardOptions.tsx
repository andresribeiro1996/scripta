import { useDeferredValue, useMemo, useRef, useState } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { CARD_PRINTS, CORNER_LABELS, CORNER_STYLES, COUNTERS, COUNTER_LABELS, FINISHES, FINISH_LABELS, FOOTER_LEFTS, FOOTER_LEFT_LABELS, FOOTER_RIGHTS, FOOTER_RIGHT_LABELS, LAYOUTS, LAYOUT_LABELS, MOTTO_LOOKS, MOTTO_LOOK_LABELS, MOTTO_MAX, PRINT_LABELS, TRAITS, TRAIT_LABELS, cardRatio, counterThumbnail, styleThumbnail, type CardCrop, type MottoLook, type ReaderCardBase } from "@scripta/shared";
import { Segmented, spacing } from "../../ui";
import { Chip, Section, Tile } from "../library/components/StyleControls";
import { ReaderCardImage } from "../murals/ReaderCardImage";
import { DraftField } from "./DraftField";
import type { SaveStyle } from "./ReaderCardChoices";

const TILE_COLUMNS = 4;
const TILE_PADDING = 8;
const SAMPLE_MOTTO = "Per libros ad astra";
const options = <T extends string>(keys: readonly T[], labels: Record<T, string>) => keys.map((value) => ({ value, label: labels[value] }));
const TRAIT_OPTIONS = options(TRAITS, TRAIT_LABELS);
const LAYOUT_OPTIONS = options(LAYOUTS, LAYOUT_LABELS);
const PRINT_OPTIONS = options(CARD_PRINTS, PRINT_LABELS);

function TileRow<T extends string>({ items, crop, value, labels, onPick }: { items: Array<{ option: T; input: ReaderCardBase | null }>; crop?: CardCrop; value: T | null; labels: Record<T, string>; onPick: (option: T) => void }) {
  const { width: windowWidth } = useWindowDimensions();
  const width = Math.floor((windowWidth - spacing.xl * 2 - (TILE_COLUMNS - 1) * spacing.sm) / TILE_COLUMNS) - TILE_PADDING;
  return (
    <View style={styles.row}>
      {items.map((item) => (
        <Tile key={item.option} width={width + TILE_PADDING} tileWidth={width + TILE_PADDING} height={width * cardRatio(crop) + TILE_PADDING} label={labels[item.option]} selected={value === item.option} onPress={() => onPick(item.option)}>
          {item.input ? <ReaderCardImage input={item.input} width={width} /> : null}
        </Tile>
      ))}
    </View>
  );
}

function ChipRow<T extends string>({ keys, labels, value, onPick }: { keys: readonly T[]; labels: Record<T, string>; value: T; onPick: (option: T) => void }) {
  return (
    <View style={styles.row}>
      {keys.map((key) => <Chip key={key} label={labels[key]} selected={value === key} onPress={() => onPick(key)} />)}
    </View>
  );
}

export function ReaderCardOptions({ input, onChange }: { input: ReaderCardBase; onChange: SaveStyle }) {
  const { counter, trait, layout, motto, footer, corners, finish, print } = input.style;
  const [look, setLook] = useState<MottoLook>(motto?.look ?? "ribbon");
  const lastText = useRef(motto?.text ?? null);
  const deferred = useDeferredValue(input, null);
  const counterThumbs = useMemo(() => COUNTERS.map((option) => ({ option, input: deferred && counterThumbnail(deferred, option) })), [deferred]);
  const mottoThumbs = useMemo(() => MOTTO_LOOKS.map((option) => ({ option, input: deferred && styleThumbnail(deferred, { motto: { text: deferred.style.motto?.text ?? SAMPLE_MOTTO, look: option } }, "motto") })), [deferred]);
  const cornerThumbs = useMemo(() => CORNER_STYLES.map((option) => ({ option, input: deferred && styleThumbnail(deferred, { corners: option }, "corner") })), [deferred]);
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
        <TileRow items={counterThumbs} value={counter} labels={COUNTER_LABELS} onPick={(next) => void onChange({ counter: next })} />
      </Section>
      <Section title="Second trait">
        <Segmented accessibilityLabel="Second trait" options={TRAIT_OPTIONS} value={trait} onChange={(next) => void onChange({ trait: next })} />
      </Section>
      <Section title="Motto">
        <DraftField label="Your motto" initial={motto?.text ?? null} max={MOTTO_MAX} onSave={saveMotto} />
        <TileRow crop="motto" items={mottoThumbs} value={motto?.look ?? look} labels={MOTTO_LOOK_LABELS} onPick={pickLook} />
      </Section>
      <Section title="Footer, left">
        <ChipRow keys={FOOTER_LEFTS} labels={FOOTER_LEFT_LABELS} value={footer.left} onPick={(left) => void onChange({ footer: { ...footer, left } })} />
      </Section>
      <Section title="Footer, right">
        <ChipRow keys={FOOTER_RIGHTS} labels={FOOTER_RIGHT_LABELS} value={footer.right} onPick={(right) => void onChange({ footer: { ...footer, right } })} />
      </Section>
      <Section title="Corners">
        <TileRow crop="corner" items={cornerThumbs} value={corners} labels={CORNER_LABELS} onPick={(next) => void onChange({ corners: next })} />
      </Section>
      <Section title="Finish">
        <ChipRow keys={FINISHES} labels={FINISH_LABELS} value={finish} onPick={(next) => void onChange({ finish: next })} />
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

const styles = StyleSheet.create({ row: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", gap: spacing.sm } });
