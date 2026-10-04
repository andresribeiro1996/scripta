import assert from "node:assert/strict";
import { test } from "node:test";
import { isbnFromBarcode } from "./isbnBarcode.js";

test("scans book ISBNs and ignores other product barcodes", () => {
  assert.equal(isbnFromBarcode("9780441013593"), "9780441013593");
  assert.equal(isbnFromBarcode("9791090636071"), "9791090636071");
  assert.equal(isbnFromBarcode("0-441-01359-7"), "0441013597");
  assert.equal(isbnFromBarcode("080442957x"), "080442957X");
  for (const data of ["4006381333931", "012345678905", "51299", "https://example.com", "", "978044101359"]) {
    assert.equal(isbnFromBarcode(data), "");
  }
});
