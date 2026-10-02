import assert from "node:assert/strict";
import { test } from "node:test";
import { saveFailureMessage } from "./saveFailure.js";

class StatusError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const generic = "Couldn't save the status change.";

test("a 413 shows the server's own message", () => {
  const message = "Your library is over 10 MB, the most Scripta can store. Remove some books or highlights and try again.";
  assert.equal(saveFailureMessage(new StatusError(413, message), generic), message);
});

test("a 413 with no message of its own keeps the generic text", () => {
  assert.equal(saveFailureMessage(new StatusError(413, ""), generic), generic);
});

test("any other failure keeps the generic text", () => {
  assert.equal(saveFailureMessage(new StatusError(500, "Request failed (500)"), generic), generic);
  assert.equal(saveFailureMessage(new StatusError(409, "The library changed elsewhere."), generic), generic);
  assert.equal(saveFailureMessage(new Error("Network request failed"), generic), generic);
  assert.equal(saveFailureMessage({ status: 413, message: "not an Error" }, generic), generic);
  assert.equal(saveFailureMessage(undefined, generic), generic);
});
