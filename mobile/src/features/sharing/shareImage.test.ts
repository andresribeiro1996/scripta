import assert from "node:assert/strict";
import { test } from "node:test";
import { contentUrl, snapshotSize } from "./shareImage";

test("share links use the configured website and reject external or executable paths", () => {
  assert.equal(contentUrl("https://atmyshelf.com/", "/vote/abc123"), "https://atmyshelf.com/vote/abc123");
  assert.equal(contentUrl("http://192.168.1.20:5173", "/arena/id"), "http://192.168.1.20:5173/arena/id");
  for (const path of ["//evil.test", "https://evil.test", "/\\evil.test"]) assert.throws(() => contentUrl("https://atmyshelf.com", path));
  assert.throws(() => contentUrl("javascript:alert(1)", "/vote/abc"));
});

test("snapshot resolution preserves the entire composition within bitmap limits", () => {
  assert.deepEqual(snapshotSize(360, 640), { width: 1080, height: 1920 });
  const tall = snapshotSize(360, 20000);
  assert.equal(tall.height, 16000);
  assert.equal(tall.width / tall.height, 360 / 20000);
  assert.throws(() => snapshotSize(0, 0));
});
