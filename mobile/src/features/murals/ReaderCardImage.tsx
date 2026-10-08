import { useMemo } from "react";
import { SvgXml } from "react-native-svg";
import { renderReaderCard, type ReaderCardBase, type ReaderCardPage } from "@scripta/shared";
import { cardFontFamily, useTheme } from "../../ui";
import { CARD_MONO_FAMILY } from "../../ui/fontAssets";
import { readerCardXml } from "./readerCardXml";

export const PLATE_RATIO = 350 / 250;

export function ReaderCardImage({ input, page = "front", width }: { input: ReaderCardBase; page?: ReaderCardPage; width: number }) {
  const { mode } = useTheme();
  const xml = useMemo(
    () => readerCardXml(renderReaderCard({ ...input, print: mode === "dark" ? "reversed" : "paper" }, page), { serif: cardFontFamily("playfairDisplay"), sans: cardFontFamily("sans"), mono: CARD_MONO_FAMILY }),
    [input, page, mode],
  );
  return <SvgXml xml={xml} width={width} height={width * PLATE_RATIO} />;
}
