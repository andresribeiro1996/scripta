import assert from "node:assert/strict";
import { test } from "node:test";
import { saveWithViewTransition } from "../src/lib/viewTransition.ts";

function withDocument(startViewTransition: unknown, run: () => Promise<void>) {
  Object.defineProperty(globalThis, "document", { value: { startViewTransition }, configurable: true });
  return run().finally(() => { Reflect.deleteProperty(globalThis, "document"); });
}

test("the save promise is returned even when the browser runs the transition callback later", () =>
  withDocument(
    (cb: () => void) => {
      queueMicrotask(cb);
      return { ready: Promise.resolve(), finished: Promise.resolve() };
    },
    async () => {
      let started = false;
      const saving = saveWithViewTransition(async () => { started = true; throw new Error("Save failed"); });
      assert.equal(started, false);
      await assert.rejects(saving, /Save failed/);
      assert.equal(started, true);
    },
  ));

test("without startViewTransition the save starts at once and resolves", () =>
  withDocument(undefined, async () => {
    let started = false;
    const saving = saveWithViewTransition(async () => { started = true; return 7; });
    assert.equal(started, true);
    assert.equal(await saving, 7);
  }));
