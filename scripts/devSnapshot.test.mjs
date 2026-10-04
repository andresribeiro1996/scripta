import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { formatListing, parseDensity, parseSnapshotArgs, takeSnapshot } from "./devSnapshot.mjs";

const SCREEN = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<hierarchy rotation="0">',
  '<node text="" content-desc="" clickable="false" enabled="true" bounds="[0,0][1080,2400]">',
  '<node text="Murals" content-desc="" clickable="false" enabled="true" bounds="[40,100][300,160]" />',
  '<node text="" content-desc="Back" clickable="true" enabled="true" bounds="[0,100][43,143]" />',
  '<node text="" content-desc="" clickable="true" enabled="true" bounds="[40,200][1040,300]">',
  '<node text="Summer reads" content-desc="" clickable="false" enabled="true" bounds="[60,210][600,250]" />',
  '<node text="12 books" content-desc="" clickable="false" enabled="true" bounds="[60,250][600,290]" />',
  '<node text="" content-desc="Delete Summer reads" clickable="true" enabled="true" bounds="[960,220][1040,300]" />',
  "</node>",
  '<node text="" content-desc="" clickable="true" enabled="true" bounds="[0,2300][44,2344]" />',
  '<node text="Save" content-desc="" clickable="true" enabled="false" bounds="[40,400][1040,500]" />',
  '<node text="Hidden" content-desc="" clickable="true" enabled="true" bounds="[0,0][0,0]" />',
  "</node>",
  "</hierarchy>",
].join("");

test("formatListing lists taps with centre, label and size, and text outside them", () => {
  assert.equal(
    formatListing({ name: "07-murals", pngPath: "out/07-murals.png", xml: SCREEN, density: 160 }),
    [
      "07-murals · 1080×2400dp · saved out/07-murals.png",
      '  · "Murals"',
      '  tap 22,122  desc="Back"  43×43dp  ⚠ <44dp',
      '  tap 540,250  "Summer reads · 12 books"  1000×100dp',
      '  tap 1000,260  desc="Delete Summer reads"  80×80dp',
      "  tap 22,2322  (no label)  44×44dp",
      '  tap 540,450  "Save"  1000×100dp  (disabled)',
    ].join("\n"),
  );
});

test("formatListing converts pixels to dp and flags just under 44dp, never printing 44 when flagged", () => {
  const xml =
    '<hierarchy><node text="" bounds="[0,0][1080,2400]">' +
    '<node text="A" clickable="true" bounds="[0,0][115,200]" />' +
    '<node text="B" clickable="true" bounds="[200,0][316,200]" />' +
    "</node></hierarchy>";
  assert.equal(
    formatListing({ name: "x", pngPath: "x.png", xml, density: 420 }),
    ["x · 411×914dp · saved x.png", '  tap 58,100  "A"  43×76dp  ⚠ <44dp', '  tap 258,100  "B"  44×76dp'].join("\n"),
  );
});

test("formatListing decodes entities, keeps each label on one line, and clips long labels", () => {
  const long = "a".repeat(100);
  const xml =
    '<hierarchy><node text="" bounds="[0,0][160,160]">' +
    '<node text="Can&apos;t reach&#10;the server" clickable="true" bounds="[0,0][100,100]" />' +
    `<node text="${long}" bounds="[0,100][100,150]" />` +
    "</node></hierarchy>";
  const rows = formatListing({ name: "x", pngPath: "x.png", xml, density: 160 }).split("\n");
  assert.equal(rows[1], `  tap 50,50  "Can't reach the server"  100×100dp`);
  assert.equal(rows[2], `  · "${"a".repeat(59)}…"`);
  assert.equal(rows.length, 3);
});

test("formatListing survives an empty dump and a stray closing tag", () => {
  assert.equal(formatListing({ name: "x", pngPath: "x.png", xml: '<hierarchy rotation="0"></hierarchy>', density: 420 }), "x · 0×0dp · saved x.png");
  const stray = '<hierarchy></node><node text="Hi" bounds="[0,0][160,160]" /></hierarchy>';
  assert.equal(formatListing({ name: "x", pngPath: "x.png", xml: stray, density: 160 }), 'x · 160×160dp · saved x.png\n  · "Hi"');
});

test("formatListing marks a tap whose centre lies under a later control that is not its descendant", () => {
  const xml =
    '<hierarchy><node text="" bounds="[0,0][400,400]">' +
    '<node text="Card" clickable="true" bounds="[0,0][200,200]" />' +
    '<node content-desc="Add a book" clickable="true" bounds="[50,50][150,150]" />' +
    "</node></hierarchy>";
  assert.equal(
    formatListing({ name: "x", pngPath: "x.png", xml, density: 160 }),
    ["x · 400×400dp · saved x.png", '  tap 100,100  "Card"  200×200dp  ⚠ under desc="Add a book"', '  tap 100,100  desc="Add a book"  100×100dp'].join("\n"),
  );
});

test("formatListing does not mark a tap covered only by its own clickable child", () => {
  const xml =
    '<hierarchy><node text="" bounds="[0,0][160,160]">' +
    '<node text="Card" clickable="true" bounds="[0,0][100,100]">' +
    '<node text="" clickable="true" bounds="[40,40][60,60]" />' +
    "</node></node></hierarchy>";
  assert.equal(
    formatListing({ name: "x", pngPath: "x.png", xml, density: 160 }),
    ["x · 160×160dp · saved x.png", '  tap 50,50  "Card"  100×100dp', "  tap 50,50  (no label)  20×20dp  ⚠ <44dp"].join("\n"),
  );
});

test("formatListing does not mark a tap that sits on top of an earlier control", () => {
  const xml =
    '<hierarchy><node text="" bounds="[0,0][160,160]">' +
    '<node text="Backdrop" clickable="true" bounds="[0,0][160,160]" />' +
    '<node text="Pin" clickable="true" bounds="[100,100][140,140]" />' +
    "</node></hierarchy>";
  assert.equal(
    formatListing({ name: "x", pngPath: "x.png", xml, density: 160 }),
    ["x · 160×160dp · saved x.png", '  tap 80,80  "Backdrop"  160×160dp', '  tap 120,120  "Pin"  40×40dp  ⚠ <44dp'].join("\n"),
  );
});

test("formatListing names the last covering control in tree order", () => {
  const xml =
    '<hierarchy><node text="" bounds="[0,0][160,160]">' +
    '<node text="Card" clickable="true" bounds="[0,0][100,100]" />' +
    '<node content-desc="First" clickable="true" bounds="[40,40][60,60]" />' +
    '<node content-desc="Second" clickable="true" bounds="[45,45][55,55]" />' +
    "</node></hierarchy>";
  const rows = formatListing({ name: "x", pngPath: "x.png", xml, density: 160 }).split("\n");
  assert.equal(rows[1], '  tap 50,50  "Card"  100×100dp  ⚠ under desc="Second"');
});

test("formatListing skips a non-clickable node whose text is only whitespace", () => {
  const xml = '<hierarchy><node text="" bounds="[0,0][160,160]"><node text=" " bounds="[0,0][100,100]" /></node></hierarchy>';
  assert.equal(formatListing({ name: "x", pngPath: "x.png", xml, density: 160 }), "x · 160×160dp · saved x.png");
});

test("formatListing falls through to (no label) when a clickable's text or description is only whitespace", () => {
  const xml =
    '<hierarchy><node text="" bounds="[0,0][400,400]">' +
    '<node text="" clickable="true" bounds="[0,0][100,100]"><node text="  " bounds="[0,0][50,50]" /></node>' +
    '<node text="" content-desc=" " clickable="true" bounds="[200,0][300,100]" />' +
    "</node></hierarchy>";
  assert.equal(
    formatListing({ name: "x", pngPath: "x.png", xml, density: 160 }),
    ["x · 400×400dp · saved x.png", "  tap 50,50  (no label)  100×100dp", "  tap 250,50  (no label)  100×100dp"].join("\n"),
  );
});

test("formatListing ends a tap row with <44dp, then (disabled), then under", () => {
  const xml =
    '<hierarchy><node text="" bounds="[0,0][160,160]">' +
    '<node text="Card" clickable="true" enabled="false" bounds="[0,0][40,40]" />' +
    '<node content-desc="Pin" clickable="true" bounds="[10,10][30,30]" />' +
    "</node></hierarchy>";
  assert.equal(formatListing({ name: "x", pngPath: "x.png", xml, density: 160 }).split("\n")[1], '  tap 20,20  "Card"  40×40dp  ⚠ <44dp  (disabled)  ⚠ under desc="Pin"');
});

test("formatListing appends a note to the header line", () => {
  assert.equal(formatListing({ name: "x", pngPath: "x.png", xml: "<hierarchy></hierarchy>", density: 160, note: " · hello" }), "x · 0×0dp · saved x.png · hello");
});

test("parseDensity prefers the override and rejects anything else", () => {
  assert.equal(parseDensity("Physical density: 420\n"), 420);
  assert.equal(parseDensity("Physical density: 420\nOverride density: 480\n"), 480);
  assert.throws(() => parseDensity("error: no devices/emulators found"), /unexpected `wm density` output/);
});

function pngHeader(width, height) {
  const header = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header);
  header.write("IHDR", 12);
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return header;
}

function fakeAdb(calls, screencap = pngHeader(1080, 2400)) {
  return (command, args) => {
    calls.push([command, ...args].join(" "));
    if (args.includes("screencap")) return screencap;
    if (args.includes("density")) return "Physical density: 160\n";
    return "";
  };
}

function fakeRead(calls, dumps) {
  return () => {
    calls.push("dump");
    return dumps.shift();
  };
}

const SCREEN_TWO = SCREEN.replace("Murals", "Collections");

test("takeSnapshot dumps, then captures, then reads density and dumps again, retrying only the first empty dump", () => {
  const dir = mkdtempSync(join(tmpdir(), "dev-snapshot-"));
  const calls = [];
  const dumps = ["", SCREEN, SCREEN];
  const output = takeSnapshot("emulator-5554", "07-murals", dir, { exec: fakeAdb(calls), read: fakeRead(calls, dumps) });
  const pngPath = join(dir, "07-murals.png");
  assert.deepEqual(readFileSync(pngPath), pngHeader(1080, 2400));
  assert.deepEqual(calls, [
    "dump",
    "dump",
    "adb -s emulator-5554 exec-out screencap -p",
    `sips -Z 1200 ${pngPath}`,
    "adb -s emulator-5554 shell wm density",
    "dump",
  ]);
  assert.equal(output.split("\n")[0], `07-murals · 1080×2400dp · saved ${pngPath}`);
  assert.equal(dumps.length, 0);
});

test("takeSnapshot leaves a small screenshot at its own size", () => {
  const dir = mkdtempSync(join(tmpdir(), "dev-snapshot-"));
  const calls = [];
  takeSnapshot("emulator-5554", "01-library", dir, { exec: fakeAdb(calls, pngHeader(320, 640)), read: () => SCREEN });
  assert.deepEqual(calls, ["adb -s emulator-5554 exec-out screencap -p", "adb -s emulator-5554 shell wm density"]);
});

test("takeSnapshot builds the listing from the second dump and says the screen was still changing when the text differs", () => {
  const dir = mkdtempSync(join(tmpdir(), "dev-snapshot-"));
  const dumps = [SCREEN, SCREEN_TWO];
  const output = takeSnapshot("emulator-5554", "07-murals", dir, { exec: fakeAdb([]), read: () => dumps.shift() });
  const [header, firstRow] = output.split("\n");
  assert.equal(header, `07-murals · 1080×2400dp · saved ${join(dir, "07-murals.png")} · screen was still changing — snapshot again`);
  assert.equal(firstRow, '  · "Collections"');
});

test("takeSnapshot adds no note when both dumps show the same text", () => {
  const dir = mkdtempSync(join(tmpdir(), "dev-snapshot-"));
  const output = takeSnapshot("emulator-5554", "07-murals", dir, { exec: fakeAdb([]), read: () => SCREEN });
  assert.equal(output.split("\n")[0], `07-murals · 1080×2400dp · saved ${join(dir, "07-murals.png")}`);
});

test("takeSnapshot falls back to the first dump, without a note, when the second is empty", () => {
  const dir = mkdtempSync(join(tmpdir(), "dev-snapshot-"));
  const dumps = [SCREEN, ""];
  const output = takeSnapshot("emulator-5554", "07-murals", dir, { exec: fakeAdb([]), read: () => dumps.shift() });
  assert.equal(output.split("\n")[0], `07-murals · 1080×2400dp · saved ${join(dir, "07-murals.png")}`);
  assert.equal(output.split("\n")[1], '  · "Murals"');
});

test("takeSnapshot rejects a screencap that is not a PNG", () => {
  const dir = mkdtempSync(join(tmpdir(), "dev-snapshot-"));
  assert.throws(
    () => takeSnapshot("emulator-5554", "x", dir, { exec: fakeAdb([], Buffer.from("garbage")), read: () => SCREEN }),
    /screencap returned 7 bytes, not a PNG/,
  );
});

test("takeSnapshot keeps the screenshot and says so when the dump fails twice", () => {
  const dir = mkdtempSync(join(tmpdir(), "dev-snapshot-"));
  const calls = [];
  const output = takeSnapshot("emulator-5554", "02-splash", dir, { exec: fakeAdb(calls), read: fakeRead(calls, ["", ""]) });
  assert.equal(output, `02-splash · dump failed — screenshot only · saved ${join(dir, "02-splash.png")}`);
  assert.deepEqual(calls, ["dump", "dump", "adb -s emulator-5554 exec-out screencap -p", `sips -Z 1200 ${join(dir, "02-splash.png")}`]);
  assert.deepEqual(readFileSync(join(dir, "02-splash.png")), pngHeader(1080, 2400));
});

test("takeSnapshot lets a failed screencap propagate", () => {
  const dir = mkdtempSync(join(tmpdir(), "dev-snapshot-"));
  const exec = () => {
    throw new Error("adb: device 'emulator-5554' not found");
  };
  assert.throws(() => takeSnapshot("emulator-5554", "x", dir, { exec, read: () => SCREEN }), /not found/);
});

test("parseSnapshotArgs takes the name and --out in either order and rejects a missing one", () => {
  assert.deepEqual(parseSnapshotArgs(["07-murals", "--out", "shots"]), { name: "07-murals", outDir: "shots" });
  assert.deepEqual(parseSnapshotArgs(["--out", "shots", "07-murals"]), { name: "07-murals", outDir: "shots" });
  assert.throws(() => parseSnapshotArgs(["07-murals"]), /usage/);
  assert.throws(() => parseSnapshotArgs(["--out", "shots"]), /usage/);
  assert.throws(() => parseSnapshotArgs(["07-murals", "--out"]), /usage/);
});
