import { useDeferredValue, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { cornerLabels, CORNER_STYLES, COUNTERS, counterLabels, FINISHES, finishLabels, FOOTER_LEFTS, footerLeftLabels, FOOTER_RIGHTS, footerRightLabels, MOTTO_LOOKS, mottoLookLabels, MOTTO_MAX, cardRatio, counterThumbnail, footerLeftText, footerRightText, styleThumbnail, type CardCrop, type Finish, type FooterLeft, type FooterRight, type Layout, type MottoLook, type ReaderCardBase } from "@scripta/shared";
import type { Locale } from "@scripta/shared/i18n";
import { Button, Icon, Segmented, minimumTouchTarget, radii, spacing, typography, useTheme } from "../../ui";
import { Text } from "../../ui/Text";
import { Caption, Section, Tile } from "../library/components/StyleControls";
import { ReaderCardImage } from "../murals/ReaderCardImage";
import { DraftField } from "./DraftField";
import type { SaveStyle } from "./ReaderCardChoices";
import { translatorFor, useLocale, useT, type MessageKey } from "../../i18n";
import { layoutOptions, printOptions, traitOptions } from "./segmentOptions";

export type PanelId = "look" | "corners" | "finish" | "footerLeft" | "footerRight";

const PANEL_TITLE_KEYS: Record<PanelId, MessageKey> = { look: "readerCard.mottoLook", corners: "readerCard.corners", finish: "readerCard.finish", footerLeft: "readerCard.bottomLeftText", footerRight: "readerCard.bottomRightText" };
const TILE_COLUMNS = 4;
const TILE_PADDING = 8;
const SAMPLE_MOTTO = "Per libros ad astra";
const LAYOUT_HINT_KEYS: Record<Layout, MessageKey> = { faces: "readerCard.layoutHintFaces", book: "readerCard.layoutHintBook", merged: "readerCard.layoutHintMerged" };
const FINISH_HINT_KEYS: Record<Finish, MessageKey> = {
  paper: "readerCard.finishHintPaper",
  aged: "readerCard.finishHintAged",
  linen: "readerCard.finishHintLinen",
  letterpress: "readerCard.finishHintLetterpress",
  foil: "readerCard.finishHintFoil",
  holo: "readerCard.finishHintHolo",
  vellum: "readerCard.finishHintVellum",
  watercolor: "readerCard.finishHintWatercolor",
  gilt: "readerCard.finishHintGilt",
  stamp: "readerCard.finishHintStamp",
  kraft: "readerCard.finishHintKraft",
  riso: "readerCard.finishHintRiso",
};

const leftDetail = (value: FooterLeft, text: string | null, hasPlate: boolean, locale: Locale) => {
  const t = translatorFor(locale);
  return value === "glyph" ? (hasPlate ? t("readerCard.yourGlyph") : t("readerCard.unavailable")) : value === "none" ? t("readerCard.nothing") : text ?? t("readerCard.unavailable");
};
const rightDetail = (value: FooterRight, text: string | null, locale: Locale) => {
  const t = translatorFor(locale);
  return value === "none" ? t("readerCard.nothing") : text ?? t("readerCard.unavailable");
};
const withText = (label: string, text: string | null) => (text ? `${label} · ${text}` : label);

function TileRow<T extends string>({ items, value, labels, available, crop, onPick }: { items: Array<{ option: T; input: ReaderCardBase | null }>; value: T | null; labels: Record<T, string>; available: number; crop?: CardCrop; onPick: (option: T) => void }) {
  const width = Math.floor((available - (TILE_COLUMNS - 1) * spacing.sm) / TILE_COLUMNS) - TILE_PADDING;
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

function PanelTrigger({ title, current, disabled = false, onPress }: { title: string; current: string; disabled?: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const t = useT();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${title}: ${current}`} accessibilityHint={t("readerCard.showsOptions")} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.trigger, { borderColor: colors.border, backgroundColor: colors.surface, opacity: disabled ? 0.5 : 1 }]}>
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
  const { counter, trait, motto: saved, footer, corners, finish, print } = input.style;
  const { locale } = input;
  const t = useT();
  const deferred = useDeferredValue(input);
  const counterThumbs = useMemo(() => COUNTERS.map((option) => ({ option, input: counterThumbnail(deferred, option) })), [deferred]);
  return (
    <>
      <Section title={t("readerCard.motto")}>
        <DraftField label={t("readerCard.yourMotto")} initial={saved?.text ?? null} max={MOTTO_MAX} onSave={motto.saveMotto} />
        <PanelTrigger title={t("readerCard.mottoLook")} current={mottoLookLabels(locale)[motto.look]} disabled={!saved} onPress={() => onOpen("look")} />
        {saved ? null : <Caption>{t("readerCard.writeMottoFirst")}</Caption>}
      </Section>
      <Section title={t("readerCard.bookMarks")}>
        <TileRow items={counterThumbs} value={counter} labels={counterLabels(locale)} available={windowWidth - spacing.xl * 2} onPick={(next) => void onChange({ counter: next })} />
        <Caption>{t("readerCard.onePerFinished")}</Caption>
      </Section>
      <Section title={t("readerCard.yourStreak")}>
        <Segmented accessibilityLabel={t("readerCard.yourStreak")} options={traitOptions(locale)} value={trait} onChange={(next) => void onChange({ trait: next })} />
        <Caption>{t("readerCard.streakHint")}</Caption>
      </Section>
      <Section title={t("readerCard.corners")}>
        <PanelTrigger title={t("readerCard.corners")} current={cornerLabels(locale)[corners]} onPress={() => onOpen("corners")} />
      </Section>
      <Section title={t("readerCard.finish")}>
        <PanelTrigger title={t("readerCard.finish")} current={finishLabels(locale)[finish]} onPress={() => onOpen("finish")} />
      </Section>
      <Section title={t("readerCard.bottomLeftText")}>
        <PanelTrigger title={t("readerCard.bottomLeftText")} current={withText(footerLeftLabels(locale)[footer.left], footerLeftText(footer.left, input.card, locale))} onPress={() => onOpen("footerLeft")} />
      </Section>
      <Section title={t("readerCard.bottomRightText")}>
        <PanelTrigger title={t("readerCard.bottomRightText")} current={withText(footerRightLabels(locale)[footer.right], footerRightText(footer.right, input.readerName))} onPress={() => onOpen("footerRight")} />
      </Section>
      <Section title={t("readerCard.colours")}>
        <Segmented accessibilityLabel={t("readerCard.colours")} options={printOptions(locale)} value={print} onChange={(next) => void onChange({ print: next })} />
        <Caption>{t("readerCard.coloursHint")}</Caption>
      </Section>
    </>
  );
}

export function LayoutOption({ layout, onChange }: { layout: Layout; onChange: SaveStyle }) {
  const locale = useLocale();
  const t = useT();
  return (
    <Section title={t("readerCard.layout")}>
      <Segmented accessibilityLabel={t("readerCard.layout")} options={layoutOptions(locale)} value={layout} onChange={(next) => void onChange({ layout: next })} />
      <Caption>{t(LAYOUT_HINT_KEYS[layout])}</Caption>
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
  const { locale } = input;
  const deferred = useDeferredValue(input, null);
  const thumbs = useMemo(() => MOTTO_LOOKS.map((option) => ({ option, input: deferred && styleThumbnail(deferred, { motto: { text: deferred.style.motto?.text ?? SAMPLE_MOTTO, look: option } }, "motto") })), [deferred]);
  return <TileRow items={thumbs} value={motto.look} labels={mottoLookLabels(locale)} available={available} crop="motto" onPick={motto.pickLook} />;
}

function CornersPanel({ input, available, onChange }: { input: ReaderCardBase; available: number; onChange: SaveStyle }) {
  const { locale } = input;
  const deferred = useDeferredValue(input, null);
  const thumbs = useMemo(() => CORNER_STYLES.map((option) => ({ option, input: deferred && styleThumbnail(deferred, { corners: option }, "corner") })), [deferred]);
  return <TileRow items={thumbs} value={input.style.corners} labels={cornerLabels(locale)} available={available} crop="corner" onPick={(next) => void onChange({ corners: next })} />;
}

function FooterPanel({ side, input, onChange }: { side: "footerLeft" | "footerRight"; input: ReaderCardBase; onChange: SaveStyle }) {
  const { footer } = input.style;
  const { locale } = input;
  return (
    <View accessibilityRole="radiogroup" style={styles.list}>
      {side === "footerLeft"
        ? FOOTER_LEFTS.map((value) => <OptionRow key={value} label={footerLeftLabels(locale)[value]} detail={leftDetail(value, footerLeftText(value, input.card, locale), input.card.state !== "unwritten" && Boolean(input.card.identity), locale)} selected={footer.left === value} onPress={() => void onChange({ footer: { ...footer, left: value } })} />)
        : FOOTER_RIGHTS.map((value) => <OptionRow key={value} label={footerRightLabels(locale)[value]} detail={rightDetail(value, footerRightText(value, input.readerName), locale)} selected={footer.right === value} onPress={() => void onChange({ footer: { ...footer, right: value } })} />)}
    </View>
  );
}

function FinishPanel({ finish, onChange }: { finish: Finish; onChange: SaveStyle }) {
  const locale = useLocale();
  const t = useT();
  return (
    <View accessibilityRole="radiogroup" style={styles.list}>
      {FINISHES.map((value) => <OptionRow key={value} label={finishLabels(locale)[value]} detail={t(FINISH_HINT_KEYS[value])} selected={finish === value} onPress={() => void onChange({ finish: value })} />)}
    </View>
  );
}

export function ReaderCardPanel({ panel, input, motto, onChange, onClose }: { panel: PanelId; input: ReaderCardBase; motto: Motto; onChange: SaveStyle; onClose: () => void }) {
  const { colors } = useTheme();
  const t = useT();
  const [available, setAvailable] = useState(0);
  return (
    <View style={[styles.panel, { backgroundColor: colors.background }]}>
      <View style={styles.panelHeader}>
        <Text accessibilityRole="header" style={[typography.title, styles.panelTitle, { color: colors.text }]}>{t(PANEL_TITLE_KEYS[panel])}</Text>
        <Button label={t("library.done")} variant="secondary" onPress={onClose} />
      </View>
      <ScrollView onLayout={(event) => setAvailable(event.nativeEvent.layout.width - spacing.xl * 2)} contentContainerStyle={styles.panelBody}>
        {available <= 0 ? null : panel === "look" ? <LookPanel input={input} motto={motto} available={available} /> : panel === "corners" ? <CornersPanel input={input} available={available} onChange={onChange} /> : panel === "finish" ? <FinishPanel finish={input.style.finish} onChange={onChange} /> : <FooterPanel side={panel} input={input} onChange={onChange} />}
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
