import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const INK = "#201e1c";
const PAPER = "#f2f0ec";
const DARK_BG = "#141210";
const DARK_TEXT = "#ece8e3";

function master(name) {
  const svg = readFileSync(join(here, `${name}.svg`), "utf8");
  const [, width, height] = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  return { width: Number(width), height: Number(height), inner: svg.slice(svg.indexOf(">") + 1, svg.lastIndexOf("</svg>")) };
}

const masters = { mark: master("mark"), lockup: master("lockup") };

const exports = [
  ["frontend/public/favicon-48.png", 48, 48, "mark", 0.82, PAPER, DARK_BG],
  ["frontend/public/icon-192.png", 192, 192, "mark", 0.66, PAPER, DARK_BG],
  ["frontend/public/icon-512.png", 512, 512, "mark", 0.56, PAPER, DARK_BG],
  ["frontend/public/logo.png", 992, 1070, "lockup", 0.84, INK, null],
  ["mobile/assets/images/favicon.png", 48, 48, "mark", 0.82, PAPER, DARK_BG],
  ["mobile/assets/images/icon.png", 1024, 1024, "mark", 0.66, PAPER, DARK_BG],
  ["mobile/assets/images/adaptive-foreground.png", 1024, 1024, "mark", 0.43, PAPER, null],
  ["mobile/assets/images/adaptive-monochrome.png", 1024, 1024, "mark", 0.43, PAPER, null],
  ["mobile/assets/images/splash-icon.png", 512, 512, "mark", 0.84, INK, null],
  ["mobile/assets/images/splash-icon-dark.png", 512, 512, "mark", 0.84, DARK_TEXT, null],
  ["mobile/assets/images/amsicon-source.png", 1254, 1254, "mark", 0.86, INK, null],
];

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const [file, width, height, name, share, ink, ground] of exports) {
    const art = masters[name];
    const w = width * share;
    const h = (w * art.height) / art.width;
    await page.setViewportSize({ width, height });
    await page.setContent(
      `<body style="margin:0"><svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" style="display:block">` +
        (ground ? `<rect width="${width}" height="${height}" fill="${ground}"/>` : "") +
        `<svg x="${(width - w) / 2}" y="${(height - h) / 2}" width="${w}" height="${h}" viewBox="0 0 ${art.width} ${art.height}">${art.inner.replaceAll(INK, ink)}</svg></svg></body>`
    );
    const png = await page.screenshot({ omitBackground: !ground });
    await (ground ? sharp(png).removeAlpha() : sharp(png)).png({ compressionLevel: 9 }).toFile(join(root, file));
    console.log(`wrote ${file}`);
  }
} finally {
  await browser.close();
}
