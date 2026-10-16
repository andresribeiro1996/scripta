import assert from "node:assert/strict";
import { test } from "node:test";
import type { DigestItem } from "@scripta/shared";
import { homeFeedSections, shouldMarkFeedSeen } from "./homeModel.js";

const actor = { userId: "u1", username: "alice", avatarUrl: null };
const createdAt = "2026-10-14T10:00:00.000Z";

test("personal events precede the circle while preserving order within each section", () => {
  const reading: DigestItem = { kind: "reading", id: "r", actor, book: { title: "Dune", author: "Frank Herbert", coverUrl: null }, finished: true, createdAt };
  const follow: DigestItem = { kind: "follow", id: "f", actor, viewerFollows: false, createdAt };
  const sections = homeFeedSections([reading, follow, reading]);
  assert.deepEqual(sections.map(section => [section.title, section.data.map(item => item.id)]), [["Around your shelf", ["f"]], ["Your reading circle", ["r", "r"]]]);
  assert.deepEqual(homeFeedSections([]), [{ title: "Your reading circle", personal: false, data: [] }]);
});

test("the feed counts as seen only when focused, a row is on screen, the data is loaded and idle, and it wasn't sent yet", () => {
  const ready = { focused: true, rowVisible: true, loaded: true, failed: false, fetching: false, sent: false };
  assert.equal(shouldMarkFeedSeen(ready), true);
  assert.equal(shouldMarkFeedSeen({ ...ready, focused: false }), false);
  assert.equal(shouldMarkFeedSeen({ ...ready, rowVisible: false }), false);
  assert.equal(shouldMarkFeedSeen({ ...ready, loaded: false }), false);
  assert.equal(shouldMarkFeedSeen({ ...ready, failed: true }), false);
  assert.equal(shouldMarkFeedSeen({ ...ready, fetching: true }), false);
  assert.equal(shouldMarkFeedSeen({ ...ready, sent: true }), false);
});
