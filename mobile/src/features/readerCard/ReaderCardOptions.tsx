import { useDeferredValue, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { CARD_PRINTS, CORNER_LABELS, CORNER_STYLES, COUNTERS, COUNTER_LABELS, FOOTER_LEFTS, FOOTER_LEFT_LABELS, FOOTER_RIGHTS, FOOTER_RIGHT_LABELS, LAYOUTS, LAYOUT_LABELS, MOTTO_LOOKS, MOTTO_LOOK_LABELS, MOTTO_MAX, PRINT_LABELS, TRAITS, TRAIT_LABELS, cardRatio, counterThumbnail, styleThumbnail, type MottoLook, type ReaderCardBase } from "@scripta/shared";
import { Icon, Segmented, Sheet, minimumTouchTarget, radii, spacing, useTheme } from "../../ui";
import { Text } from "../../ui/Text";
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

function TileRow<T extends string>({ items, value, labels, available, onPick }: { items: Array<{ option: T; input: ReaderCardBase }>; value: T | null; labels: Record<T, string>; available: number; onPick: (option: T) => void }) {
  const width = Math.floor((available - (TILE_COLUMNS - 1) * spacing.sm) / TILE_COLUMNS) - TILE_PADDING;
  return (
    <View style={styles.row}>
      {items.map((item) => (
        <Tile key={item.option} width={width + TILE_PADDING} tileWidth={width + TILE_PADDING} height={width * cardRatio(item.input.crop) + TILE_PADDING} label={labels[item.option]} selected={value === item.option} onPress={() => onPick(item.option)}>
          <ReaderCardImage input={item.input} width={width} />
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

function OptionSheet({ title, current, children }: { title: string; current: string; children: (available: number, close: () => void) => ReactNode }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [available, setAvailable] = useState(0);
  const close = () => setOpen(false);
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel={`${title}: ${current}`} accessibilityHint="Shows the options" onPress={() => setOpen(true)} style={[styles.trigger, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        <Text numberOfLines={1} style={[styles.triggerLabel, { color: colors.text }]}>{current}</Text>
        <Icon name="chevronRight" size={18} color={colors.textDim} />
      </Pressable>
      <Sheet visible={open} title={title} onClose={close}>
        <ScrollView onLayout={(event) => setAvailable(event.nativeEvent.layout.width)} contentContainerStyle={styles.sheet}>
          {available > 0 ? children(available, close) : null}
        </ScrollView>
      </Sheet>
    </>
  );
}

export function ReaderCardOptions({ input, onChange }: { input: ReaderCardBase; onChange: SaveStyle }) {
  const { width: windowWidth } = useWindowDimensions();
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
        <TileRow items={counterThumbs} value={counter} labels={COUNTER_LABELS} available={windowWidth - spacing.xl * 2} onPick={(next) => void onChange({ counter: next })} />
      </Section>
      <Section title="Second trait">
        <Segmented accessibilityLabel="Second trait" options={TRAIT_OPTIONS} value={trait} onChange={(next) => void onChange({ trait: next })} />
      </Section>
      <Section title="Motto">
        <DraftField label="Your motto" initial={motto?.text ?? null} max={MOTTO_MAX} onSave={saveMotto} />
        <OptionSheet title="Motto look" current={MOTTO_LOOK_LABELS[motto?.look ?? look]}>
          {(available, close) => <TileRow items={mottoThumbs} value={motto?.look ?? look} labels={MOTTO_LOOK_LABELS} available={available} onPick={(next) => { close(); pickLook(next); }} />}
        </OptionSheet>
      </Section>
      <Section title="Footer, left">
        <OptionSheet title="Footer, left" current={FOOTER_LEFT_LABELS[footer.left]}>
          {(_, close) => <ChipRow keys={FOOTER_LEFTS} labels={FOOTER_LEFT_LABELS} value={footer.left} onPick={(left) => { close(); void onChange({ footer: { ...footer, left } }); }} />}
        </OptionSheet>
      </Section>
      <Section title="Footer, right">
        <OptionSheet title="Footer, right" current={FOOTER_RIGHT_LABELS[footer.right]}>
          {(_, close) => <ChipRow keys={FOOTER_RIGHTS} labels={FOOTER_RIGHT_LABELS} value={footer.right} onPick={(right) => { close(); void onChange({ footer: { ...footer, right } }); }} />}
        </OptionSheet>
      </Section>
      <Section title="Corners">
        <OptionSheet title="Corners" current={CORNER_LABELS[corners]}>
          {(available, close) => <TileRow items={cornerThumbs} value={corners} labels={CORNER_LABELS} available={available} onPick={(next) => { close(); void onChange({ corners: next }); }} />}
        </OptionSheet>
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

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", gap: spacing.sm },
  trigger: { minHeight: minimumTouchTarget, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, borderWidth: 1, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  triggerLabel: { flex: 1, fontSize: 14, fontWeight: "500" },
  sheet: { paddingBottom: spacing.xl },
});
