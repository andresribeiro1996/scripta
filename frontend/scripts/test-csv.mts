// Characterization test for lib/csv.ts's RFC4180-ish parser — written
// before it moved into packages/shared/src/library/csv.ts (Task 3A),
// since it had no test at all before this. Same one-off verification
// script style as scripts/test-merge.mts. Run with:
//   npx tsx scripts/test-csv.mts

import { csvRowsToObjects, parseCsv } from "../src/lib/csv";

let passed = 0;
let failed = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

console.log("1. parseCsv — plain fields, no quoting");
{
  const rows = parseCsv("a,b,c\n1,2,3\n");
  check("two rows parsed", rows.length === 2);
  check("header row split on commas", JSON.stringify(rows[0]) === JSON.stringify(["a", "b", "c"]));
  check("data row split on commas", JSON.stringify(rows[1]) === JSON.stringify(["1", "2", "3"]));
}

console.log("\n2. parseCsv — quoted fields containing commas and newlines");
{
  const rows = parseCsv('Title,Review\n"Neuromancer","great, read it\nagain"\n');
  check("quoted comma doesn't split the field", rows[1][0] === "Neuromancer" && rows[1][1] === "great, read it\nagain");
}

console.log("\n3. parseCsv — \"\" inside a quoted field is an escaped quote");
{
  const rows = parseCsv('Title\n"She said ""hello"""\n');
  check('escaped "" becomes a literal "', rows[1][0] === 'She said "hello"');
}

console.log("\n4. parseCsv — CRLF line endings are treated like LF");
{
  const rows = parseCsv("a,b\r\n1,2\r\n");
  check("two rows despite \\r\\n endings", rows.length === 2);
  check("no stray \\r left in fields", rows[1][1] === "2");
}

console.log("\n5. parseCsv — a final row with no trailing newline is still captured");
{
  const rows = parseCsv("a,b\n1,2");
  check("trailing row without a final newline is kept", rows.length === 2 && JSON.stringify(rows[1]) === JSON.stringify(["1", "2"]));
}

console.log("\n6. parseCsv — empty input produces no rows");
{
  check("empty string -> zero rows", parseCsv("").length === 0);
}

console.log("\n7. csvRowsToObjects — maps each data row onto the header's column names");
{
  const rows = parseCsv("Title,Author\nDune,Frank Herbert\nNeuromancer,William Gibson\n");
  const objs = csvRowsToObjects(rows);
  check("two objects produced", objs.length === 2);
  check("first object keyed by header", objs[0].Title === "Dune" && objs[0].Author === "Frank Herbert");
  check("second object keyed by header", objs[1].Title === "Neuromancer" && objs[1].Author === "William Gibson");
}

console.log("\n8. csvRowsToObjects — a short row backfills missing columns with an empty string");
{
  const objs = csvRowsToObjects([["A", "B", "C"], ["1", "2"]]);
  check("missing trailing column becomes \"\"", objs[0].A === "1" && objs[0].B === "2" && objs[0].C === "");
}

console.log("\n9. csvRowsToObjects — drops a trailing blank line (a lone empty field)");
{
  const objs = csvRowsToObjects(parseCsv("Title\nDune\n"));
  check("no phantom row for the trailing newline", objs.length === 1);
}

console.log("\n10. csvRowsToObjects — header-only input produces no objects");
{
  check("no rows -> no objects", csvRowsToObjects(parseCsv("Title,Author\n")).length === 0);
}

console.log("\n11. csvRowsToObjects — empty rows array produces an empty array, not an error");
{
  check("[] in -> [] out", csvRowsToObjects([]).length === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
