const WINDOWS_1252_HIGH =
  "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ";
const BYTE_OF = new Map<string, number>();
for (let byte = 0; byte < 256; byte++) BYTE_OF.set(String.fromCharCode(byte), byte);
for (let index = 0; index < WINDOWS_1252_HIGH.length; index++) BYTE_OF.set(WINDOWS_1252_HIGH[index]!, 0x80 + index);

const CONTINUATION = `[\\u0080-\\u00bf${WINDOWS_1252_HIGH}]`;
const SEQUENCE = new RegExp(`[\\u00c2-\\u00df]${CONTINUATION}|[\\u00e0-\\u00ef]${CONTINUATION}{2}|[\\u00f0-\\u00f4]${CONTINUATION}{3}`, "g");
const NON_SORTING_MARKER = new RegExp(`(${SEQUENCE.source})|[\\u0098\\u009c]`, "g");
const WORD_END = /^[\xa0©®»–—’”…™]+$/;
const LOWERCASE_LETTER = /\p{Ll}/u;
const LETTER = /\p{L}/u;
const LOSSY = /�|\p{L}©\p{L}/u;

const isUpper = (char: string) => char !== char.toLowerCase();

function suspiciousSequences(text: string): number {
  let count = 0;
  for (const { 0: sequence, index } of text.matchAll(SEQUENCE)) {
    const before = text[index - 1] ?? "";
    const after = text[index + sequence.length] ?? "";
    const continuation = sequence.slice(1);
    const notText = sequence[0] === "Ã" && (continuation === "©" || continuation === "®" || (continuation === "»" && LOWERCASE_LETTER.test(after)));
    const endsAWord = !notText && LETTER.test(before) && !(isUpper(sequence[0]!) && !isUpper(before)) && WORD_END.test(continuation);
    if (!endsAWord) count++;
  }
  return count;
}

function decodeOnce(text: string): string | null {
  const suspicious = suspiciousSequences(text);
  if (suspicious === 0) return null;
  const bytes: number[] = [];
  for (const char of text) {
    const byte = BYTE_OF.get(char);
    if (byte === undefined) return null;
    bytes.push(byte);
  }
  const decoded = new TextDecoder().decode(Uint8Array.from(bytes));
  return decoded.includes("�") || suspiciousSequences(decoded) >= suspicious ? null : decoded;
}

export function repairMojibake(text: string): string {
  for (let next = decodeOnce(text); next !== null; next = decodeOnce(text)) text = next;
  return text;
}

export function hasMojibake(text: string): boolean {
  return suspiciousSequences(text) > 0 || LOSSY.test(text);
}

export function stripNonSortingMarkers(text: string): string {
  return text.replace(NON_SORTING_MARKER, (_marker, sequence: string | undefined) => sequence ?? "");
}
