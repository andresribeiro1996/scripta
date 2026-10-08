import { PLATE_FONTS } from "@scripta/shared";

export interface CardFonts { serif: string; sans: string; mono: string; script: string }

export function readerCardXml(svg: string, fonts: CardFonts): string {
  return svg.replaceAll(PLATE_FONTS.serif, fonts.serif).replaceAll(PLATE_FONTS.sans, fonts.sans).replaceAll(PLATE_FONTS.mono, fonts.mono).replaceAll(PLATE_FONTS.script, fonts.script).replaceAll("&lt;", "<![CDATA[<]]>").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
}
