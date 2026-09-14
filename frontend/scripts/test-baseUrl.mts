import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveApiUrl } from "../src/api/resolveApiUrl.ts";

test("an explicit VITE_API_URL always wins", () => {
  const url = resolveApiUrl({ apiUrl: "https://api.example.com", apiPort: "3200" }, { protocol: "http:", hostname: "localhost" });
  assert.equal(url, "https://api.example.com");
});

test("the slot's port is used with the page's own host", () => {
  const url = resolveApiUrl({ apiPort: "3200" }, { protocol: "http:", hostname: "localhost" });
  assert.equal(url, "http://localhost:3200");
});

test("a phone on the LAN reaches the same slot on the host it loaded from", () => {
  const url = resolveApiUrl({ apiPort: "3200" }, { protocol: "http:", hostname: "192.168.1.24" });
  assert.equal(url, "http://192.168.1.24:3200");
});

test("with no VITE_API_PORT it falls back to 3000", () => {
  const url = resolveApiUrl({}, { protocol: "http:", hostname: "localhost" });
  assert.equal(url, "http://localhost:3000");
});
