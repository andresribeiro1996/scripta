import assert from "node:assert/strict";
import Fastify from "fastify";
import { test } from "node:test";
import { TRUSTED_PROXIES } from "./trustedProxies.js";

async function clientIp(remoteAddress: string, forwardedFor: string) {
  const app = Fastify({ trustProxy: TRUSTED_PROXIES });
  app.get("/ip", async (request) => request.ip);
  const response = await app.inject({ url: "/ip", remoteAddress, headers: { "x-forwarded-for": forwardedFor } });
  await app.close();
  return response.payload;
}

test("a private peer's forwarded chain is read from the right, skipping Cloudflare and ignoring what the client wrote", async () => {
  assert.equal(await clientIp("10.0.0.5", "6.6.6.6, 203.0.113.9, 172.64.1.1"), "203.0.113.9");
});

test("a peer in 100.64.0.0/10 is a trusted proxy", async () => {
  assert.equal(await clientIp("100.64.3.4", "203.0.113.9"), "203.0.113.9");
});

test("a public peer is the client, whatever it forwards", async () => {
  assert.equal(await clientIp("203.0.113.50", "6.6.6.6"), "203.0.113.50");
});

test("an IPv4-mapped peer counts as its IPv4 address", async () => {
  assert.equal(await clientIp("::ffff:10.0.0.5", "203.0.113.9"), "203.0.113.9");
});

test("IPv6 private peers and Cloudflare IPv6 hops are trusted proxies", async () => {
  assert.equal(await clientIp("fd12:3456::7", "6.6.6.6, 203.0.113.9, 2606:4700::1111"), "203.0.113.9");
});
