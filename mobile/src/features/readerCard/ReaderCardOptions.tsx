import { useDeferredValue, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { CARD_PRINTS, CORNER_LABELS, CORNER_STYLES, COUNTERS, COUNTER_LABELS, FOOTER_LEFTS, FOOTER_LEFT_LABELS, FOOTER_RIGHTS, FOOTER_RIGHT_LABELS, LAYOUTS, LAYOUT_LABELS, MOTTO_LOOKS, MOTTO_LOOK_LABELS, MOTTO_MAX, PRINT_LABELS, TRAITS, TRAIT_LABELS, cardRatio, counterThumbnail, footerLeftText, footerRightText, styleThumbnail, type FooterLeft, type FooterRight, type Layout, type MottoLook, type ReaderCardBase } from "@scripta/shared";
import { Button, Icon, Segmented, minimumTouchTarget, radii, spacing, typography, useTheme } from "../../ui";
import { Text } from "../../ui/Text";
import { Caption, Section, Tile } from "../library/components/StyleControls";
import { ReaderCardImage } from "../murals/ReaderCardImage";
import { DraftField } from "./DraftField";
import type { SaveStyle } from "./ReaderCardChoices";

export type PanelId = "look" | "corners" | "footerLeft" | "footerRight";

const PANEL_TITLES: Record<PanelId, string> = { look: "Motto look", corners: "Corners", footerLeft: "Bottom-left text", footerRight: "Bottom-right text" };
const TILE_COLUMNS = 4;
const TILE_PADDING = 8;
const SAMPLE_MOTTO = "Per libros ad astra";
const UNAVAILABLE = "Not available yet; prints the default";
const LAYOUT_HINTS: Record<Layout, string> = {
  faces: "Tap the card to turn through the front, your picks and your record",
  book: "Opens like a book, with your picks and record inside",
  merged: "One back page with your picks and record together",
};
const options = <T extends string>(keys: readonly T[], labels: Record<T, string>) => keys.map((value) => ({ value, label: labels[value] }));
const TRAIT_OPTIONS = options(TRAITS, TRAIT_LABELS);
const LAYOUT_OPTIONS = options(LAYOUTS, LAYOUT_LABELS);
const PRINT_OPTIONS = options(CARD_PRINTS, PRINT_LABELS);

const leftDetail = (value: FooterLeft, text: string | null, hasPlate: boolean) => (value === "glyph" ? (hasPlate ? "Your glyph" : UNAVAILABLE) : value === "none" ? "Nothing" : text ?? UNAVAILABLE);
const rightDetail = (value: FooterRight, text: string | null) => (value === "none" ? "Nothing" : text ?? UNAVAILABLE);
const withText = (label: string, text: string | null) => (text ? `${label} · ${text}` : label);

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

function PanelTrigger({ title, current, disabled = false, onPress }: { title: string; current: string; disabled?: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${title}: ${current}`} accessibilityHint="Shows the options" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.trigger, { borderColor: colors.border, backgroundColor: colors.surface, opacity: disabled ? 0.5 : 1 }]}>
      <Text numberOfLines={1} style={[styles.triggerLabel, { color: colors.text }]}>{current}</Text>
      <Icon name="chevronRight" size={18} color={colors.textDim} />
    </Pressable>
  );
}

export function GroupHeader({ title }: { title: string }) {
  const { colors } = useTheme();
  return <Text accessibilityRole="header" style={[typography.title, styles.group, { color: colors.text }]}>{title}</Text>;
}

export function useMotto(input: ReaderCardBase, onChange: SaveStyle) {
  const motto = input.style.motto;
  const [look, setLook] = useState<MottoLook>(motto?.look ?? "ribbon");
  const [seen, setSeen] = useState(motto?.look);
  if (motto && motto.look !== seen) {
    setSeen(motto.look);
    setLook(motto.look);
  }
  const lastText = useRef(motto?.text ?? null);
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
  return { look, saveMotto, pickLook };
}

type Motto = ReturnType<typeof useMotto>;

export function FrontOptions({ input, motto, onChange, onOpen }: { input: ReaderCardBase; motto: Motto; onChange: SaveStyle; onOpen: (panel: PanelId) => void }) {
  const { width: windowWidth } = useWindowDimensions();
  const { counter, trait, motto: saved, footer, corners, print } = input.style;
  const deferred = useDeferredValue(input);
  const counterThumbs = useMemo(() => COUNTERS.map((option) => ({ option, input: counterThumbnail(deferred, option) })), [deferred]);
  return (
    <>
      <Section title="Motto">
        <DraftField label="Your motto" initial={saved?.text ?? null} max={MOTTO_MAX} onSave={motto.saveMotto} />
        <PanelTrigger title="Motto look" current={MOTTO_LOOK_LABELS[motto.look]} disabled={!saved} onPress={() => onOpen("look")} />
        {saved ? null : <Caption>Write a motto to choose its look</Caption>}
      </Section>
      <Section title="Book marks">
        <TileRow items={counterThumbs} value={counter} labels={COUNTER_LABELS} available={windowWidth - spacing.xl * 2} onPick={(next) => void onChange({ counter: next })} />
        <Caption>One mark per finished book</Caption>
      </Section>
      <Section title="Your streak">
        <Segmented accessibilityLabel="Your streak" options={TRAIT_OPTIONS} value={trait} onChange={(next) => void onChange({ trait: next })} />
        <Caption>Your second-strongest reader type</Caption>
      </Section>
      <Section title="Corners">
        <PanelTrigger title="Corners" current={CORNER_LABELS[corners]} onPress={() => onOpen("corners")} />
      </Section>
      <Section title="Bottom-left text">
        <PanelTrigger title="Bottom-left text" current={withText(FOOTER_LEFT_LABELS[footer.left], footerLeftText(footer.left, input.card))} onPress={() => onOpen("footerLeft")} />
      </Section>
      <Section title="Bottom-right text">
        <PanelTrigger title="Bottom-right text" current={withText(FOOTER_RIGHT_LABELS[footer.right], footerRightText(footer.right, input.readerName))} onPress={() => onOpen("footerRight")} />
      </Section>
      <Section title="Colours">
        <Segmented accessibilityLabel="Colours" options={PRINT_OPTIONS} value={print} onChange={(next) => void onChange({ print: next })} />
        <Caption>Auto follows the app's light or dark theme</Caption>
      </Section>
    </>
  );
}

export function LayoutOption({ layout, onChange }: { layout: Layout; onChange: SaveStyle }) {
  return (
    <Section title="Layout">
      <Segmented accessibilityLabel="Layout" options={LAYOUT_OPTIONS} value={layout} onChange={(next) => void onChange({ layout: next })} />
      <Caption>{LAYOUT_HINTS[layout]}</Caption>
    </Section>
  );
}

function OptionRow({ label, detail, selected, onPress }: { label: string; detail: string; selected: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="radio" accessibilityLabel={`${label}, ${detail}`} accessibilityState={{ checked: selected }} onPress={onPress} style={[styles.option, { borderColor: selected ? colors.accent : colors.border, backgroundColor: selected ? colors.accentSoft : colors.surface }]}>
      <View style={styles.optionText}>
        <Text style={[typography.body, { color: selected ? colors.accent : colors.text, fontWeight: selected ? "700" : "500" }]}>{label}</Text>
        <Text style={[typography.caption, { color: colors.textDim }]}>{detail}</Text>
      </View>
      {selected ? <Icon name="confirm" size={18} color={colors.accent} /> : null}
    </Pressable>
  );
}

function LookPanel({ input, motto, available }: { input: ReaderCardBase; motto: Motto; available: number }) {
  const deferred = useDeferredValue(input);
  const thumbs = useMemo(() => MOTTO_LOOKS.map((option) => ({ option, input: styleThumbnail(deferred, { motto: { text: deferred.style.motto?.text ?? SAMPLE_MOTTO, look: option } }, "motto") })), [deferred]);
  return <TileRow items={thumbs} value={motto.look} labels={MOTTO_LOOK_LABELS} available={available} onPick={motto.pickLook} />;
}

function CornersPanel({ input, available, onChange }: { input: ReaderCardBase; available: number; onChange: SaveStyle }) {
  const deferred = useDeferredValue(input);
  const thumbs = useMemo(() => CORNER_STYLES.map((option) => ({ option, input: styleThumbnail(deferred, { corners: option }, "corner") })), [deferred]);
  return <TileRow items={thumbs} value={input.style.corners} labels={CORNER_LABELS} available={available} onPick={(next) => void onChange({ corners: next })} />;
}

function FooterPanel({ side, input, onChange }: { side: "footerLeft" | "footerRight"; input: ReaderCardBase; onChange: SaveStyle }) {
  const { footer } = input.style;
  return (
    <View accessibilityRole="radiogroup" style={styles.list}>
      {side === "footerLeft"
        ? FOOTER_LEFTS.map((value) => <OptionRow key={value} label={FOOTER_LEFT_LABELS[value]} detail={leftDetail(value, footerLeftText(value, input.card), input.card.state !== "unwritten" && Boolean(input.card.identity))} selected={footer.left === value} onPress={() => void onChange({ footer: { ...footer, left: value } })} />)
        : FOOTER_RIGHTS.map((value) => <OptionRow key={value} label={FOOTER_RIGHT_LABELS[value]} detail={rightDetail(value, footerRightText(value, input.readerName))} selected={footer.right === value} onPress={() => void onChange({ footer: { ...footer, right: value } })} />)}
    </View>
  );
}

export function ReaderCardPanel({ panel, input, motto, onChange, onClose }: { panel: PanelId; input: ReaderCardBase; motto: Motto; onChange: SaveStyle; onClose: () => void }) {
  const { colors } = useTheme();
  const [available, setAvailable] = useState(0);
  return (
    <View style={[styles.panel, { backgroundColor: colors.background }]}>
      <View style={styles.panelHeader}>
        <Text accessibilityRole="header" style={[typography.title, styles.panelTitle, { color: colors.text }]}>{PANEL_TITLES[panel]}</Text>
        <Button label="Done" variant="secondary" onPress={onClose} />
      </View>
      <ScrollView onLayout={(event) => setAvailable(event.nativeEvent.layout.width - spacing.xl * 2)} contentContainerStyle={styles.panelBody}>
        {available <= 0 ? null : panel === "look" ? <LookPanel input={input} motto={motto} available={available} /> : panel === "corners" ? <CornersPanel input={input} available={available} onChange={onChange} /> : <FooterPanel side={panel} input={input} onChange={onChange} />}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", gap: spacing.sm },
  group: { fontWeight: "700", marginTop: spacing.sm },
  trigger: { minHeight: minimumTouchTarget, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, borderWidth: 1, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  triggerLabel: { flex: 1, fontSize: 14, fontWeight: "500" },
  panel: { ...StyleSheet.absoluteFill },
  panelHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, paddingHorizontal: spacing.xl, paddingVertical: spacing.sm },
  panelTitle: { flex: 1, fontWeight: "700" },
  panelBody: { paddingHorizontal: spacing.xl, paddingBottom: spacing.huge },
  list: { gap: spacing.sm },
  option: { minHeight: minimumTouchTarget, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, borderWidth: 1, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  optionText: { flex: 1, gap: 2 },
});
