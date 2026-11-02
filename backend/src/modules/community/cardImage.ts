import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderAsync } from "@resvg/resvg-js";
import { renderReaderCard, type ReaderCardInput } from "@scripta/shared/readerCards";
import sharp from "sharp";

const FONTS = fileURLToPath(new URL("../../../assets/fonts/", import.meta.url));
const FONT_FILES = readdirSync(FONTS).filter((name) => name.endsWith(".ttf")).map((name) => `${FONTS}${name}`);
const WIDTH = 600;

export async function renderCardImage(input: ReaderCardInput): Promise<Buffer> {
  const svg = renderReaderCard({ ...input, width: WIDTH });
  const rendered = await renderAsync(svg, {
    fitTo: { mode: "width", value: WIDTH },
    font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: "Roboto", sansSerifFamily: "Roboto", serifFamily: "Playfair Display" }
  });
  return sharp(rendered.asPng()).flatten({ background: "#ffffff" }).jpeg({ quality: 82 }).toBuffer();
}
