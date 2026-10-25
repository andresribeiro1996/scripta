import assert from "node:assert/strict";
import { test } from "node:test";
import { formatWebListing, parseWebSnapshotArgs } from "./webSnapshot.mjs";

test("args keep steps in order and apply defaults", () => {
  const args = parseWebSnapshotArgs(["03-murals", "--out", "/o", "--path", "/murals", "--click", "button:New mural", "--fill", "Title=Summer", "--click-at", "340,24", "--press", "Enter", "--wait", "Summer"]);
  assert.equal(args.width, 1280);
  assert.deepEqual(args.steps.map((s) => s.kind), ["click", "fill", "clickAt", "press", "wait"]);
  assert.deepEqual(args.steps[0], { kind: "click", role: "button", name: "New mural" });
  assert.deepEqual(args.steps[1], { kind: "fill", label: "Title", text: "Summer" });
  assert.deepEqual(args.steps[2], { kind: "clickAt", x: 340, y: 24 });
  assert.throws(() => parseWebSnapshotArgs(["x", "--out", "/o", "--click", "nocolon"]), /--click/);
  assert.throws(() => parseWebSnapshotArgs(["x", "--out", "/o", "--click-at", "12"]), /--click-at/);
  assert.throws(() => parseWebSnapshotArgs(["x"]), /--out/);
  assert.throws(() => parseWebSnapshotArgs(["x", "--out", "/o", "--bogus", "1"]), /unknown flag/);
  assert.throws(() => parseWebSnapshotArgs(["x", "--out", "/o", "--fill", "nope"]), /--fill/);
});

test("listing flags small, unlabelled, disabled and covered controls", () => {
  const text = formatWebListing({
    name: "07-murals", pngPath: "/o/07-murals.png", width: 360, height: 900,
    headings: [{ level: 1, text: "Murals" }],
    elements: [
      { role: "button", name: "", x: 340, y: 24, w: 32, h: 32 },
      { role: "link", name: "Summer reads", x: 180, y: 200, w: 300, h: 96, href: "/murals/1" },
      { role: "textbox", name: "", x: 180, y: 400, w: 300, h: 40, value: "https://x.test/shared/library/tok" },
      { role: "button", name: "Save", x: 180, y: 860, w: 300, h: 52, disabled: true, coveredBy: "Close" },
    ],
    consoleErrors: ["TypeError: x is undefined"], failedRequests: ["GET 500 /murals"], note: "page was still changing — snapshot again",
  });
  assert.match(text, /^07-murals · 360×900px · saved \/o\/07-murals\.png · page was still changing — snapshot again/);
  assert.match(text, /h1 "Murals"/);
  assert.match(text, /button \(no label\)  @340,24  32×32px  ⚠ <44px/);
  assert.match(text, /link "Summer reads"  @180,200  300×96px  → \/murals\/1/);
  assert.match(text, /textbox \(no label\)  @180,400  300×40px  = "https:\/\/x\.test\/shared\/library\/tok"/);
  assert.match(text, /button "Save"  @180,860  300×52px  \(disabled\)  ⚠ under "Close"/);
  assert.match(text, /console errors \(1\):\n  TypeError/);
  assert.match(text, /failed requests \(1\):\n  GET 500 \/murals/);
});
