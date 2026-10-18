const MAX_CODE_POINT = 0x10ffff;
const FIRST_SURROGATE = 0xd800;
const LAST_SURROGATE = 0xdfff;
const MAX_DECODE_PASSES = 4;
const BLOCK_TAG = /<\/?(?:p|div|br|hr|li|ul|ol|dl|dt|dd|h[1-6]|tr|table|blockquote|section|article|figure)\b[^<>]*>/i;
const LINE_BREAK_TAG = /<\/?br\b[^<>]*>/gi;
const PARAGRAPH_TAG = /<\/?(?:p|div|hr|li|ul|ol|dl|dt|dd|h[1-6]|tr|table|blockquote|section|article|figure)\b[^<>]*>/gi;
const CELL_TAG = /<\/?(?:td|th)\b[^<>]*>/gi;
const SCRIPT_OR_STYLE = /<(script|style)\b[\s\S]*?<\/\1\s*>/gi;
const COMMENT = /<!--[\s\S]*?-->/g;
const DECLARATION = /<[?!][^>]*>/g;
const TAG = /<\/?[a-z][a-z0-9]*\b[^<>]*>/gi;
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", shy: "",
  hellip: "…", ndash: "–", mdash: "—", laquo: "«", raquo: "»", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", ordm: "º", ordf: "ª",
  euro: "€", sect: "§", times: "×",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", agrave: "à", atilde: "ã", otilde: "õ", acirc: "â", ecirc: "ê", ocirc: "ô", ccedil: "ç",
  Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", Agrave: "À", Atilde: "Ã", Otilde: "Õ", Acirc: "Â", Ecirc: "Ê", Ocirc: "Ô", Ccedil: "Ç"
};

export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (whole, decimal, hex, name) => {
    if (decimal || hex) {
      const codePoint = decimal ? Number(decimal) : parseInt(hex, 16);
      const unusable = codePoint === 0 || codePoint > MAX_CODE_POINT || (codePoint >= FIRST_SURROGATE && codePoint <= LAST_SURROGATE);
      return unusable ? whole : String.fromCodePoint(codePoint);
    }
    const key = Object.hasOwn(NAMED_ENTITIES, name) ? name : name.toLowerCase();
    return Object.hasOwn(NAMED_ENTITIES, key) ? NAMED_ENTITIES[key]! : whole;
  });
}

function stripTags(text: string): string {
  return text.replace(COMMENT, "").replace(DECLARATION, "").replace(TAG, "");
}

function decodeAndStrip(text: string): string {
  let current = text;
  for (let pass = 0; pass < MAX_DECODE_PASSES; pass += 1) {
    const next = stripTags(decodeHtmlEntities(current));
    if (next === current) break;
    current = next;
  }
  return current;
}

function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function htmlToText(html: string): string {
  const source = html.replace(SCRIPT_OR_STYLE, " ");
  if (!BLOCK_TAG.test(source)) return tidy(decodeAndStrip(stripTags(source)));
  const marked = source
    .replace(COMMENT, "")
    .replace(/\s+/g, " ")
    .replace(LINE_BREAK_TAG, "\n")
    .replace(PARAGRAPH_TAG, "\n\n")
    .replace(CELL_TAG, " ");
  return tidy(decodeAndStrip(stripTags(marked)));
}
