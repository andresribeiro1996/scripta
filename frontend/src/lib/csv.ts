// Minimal RFC4180-ish CSV parsing, shared by every CSV-based importer
// (lib/goodreads.ts, lib/storygraph.ts). Extracted from goodreads.ts,
// which was the first (and until now only) CSV importer here.

/** Handles quoted fields, commas and newlines inside quotes, and "" as an
 *  escaped quote. Both Goodreads' and StoryGraph's exports need all of
 *  this — review text routinely contains commas and line breaks. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  function pushField() {
    row.push(field);
    field = "";
  }
  function pushRow() {
    pushField();
    rows.push(row);
    row = [];
  }

  while (i < len) {
    const c = text.charAt(i);
    if (inQuotes) {
      if (c === '"') {
        if (text.charAt(i + 1) === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      pushField();
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      pushRow();
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field.length > 0 || row.length > 0) pushRow();

  return rows;
}

/** First row is the header; each following row becomes an object keyed by
 *  it. Drops trailing blank lines (a lone empty field from a final "\n"). */
export function csvRowsToObjects(rows: string[][]): Array<Record<string, string>> {
  if (!rows.length) return [];
  const header = rows[0];
  return rows
    .slice(1)
    .filter((r) => !(r.length === 1 && r[0] === ""))
    .map((r) => {
      const obj: Record<string, string> = {};
      header.forEach((h, i) => {
        obj[h] = r[i] ?? "";
      });
      return obj;
    });
}
