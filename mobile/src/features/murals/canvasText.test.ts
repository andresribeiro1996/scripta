import assert from "node:assert/strict";
import { test } from "node:test";
import { foldersButtonLabel, quoteText } from "./canvasText.js";

test("typographic quotes wrap a real passage and never the placeholder", () => {
  assert.equal(quoteText("Call me Ishmael.", "No eligible passage available"), "“Call me Ishmael.”");
  assert.equal(quoteText(undefined, "No eligible passage available"), "No eligible passage available");
});

test("the folders button label is not repeated when no folder is selected", () => {
  const compose = (label: string) => `Folders, ${label}`;
  assert.equal(foldersButtonLabel("Folders", "Folders", compose), "Folders");
  assert.equal(foldersButtonLabel("Unfiled", "Folders", compose), "Folders, Unfiled");
});
