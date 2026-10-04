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

test("the Cloudflare to Railway chain yields the client, skipping the edge and Cloudflare hops and ignoring what the client wrote", async () => {
  assert.equal(await clientIp("100.64.0.7", "6.6.6.6, 203.0.113.9, 172.64.1.1"), "203.0.113.9");
});

test("any peer in 100.64.0.0/10 is a trusted proxy, not only the observed addresses", async () => {
  assert.equal(await clientIp("100.64.3.4", "203.0.113.9"), "203.0.113.9");
  assert.equal(await clientIp("100.127.255.254", "203.0.113.9"), "203.0.113.9");
  assert.equal(await clientIp("::ffff:100.64.0.7", "203.0.113.9"), "203.0.113.9");
});

test("a client hitting Railway directly cannot claim a Cloudflare hop to pick its own address", async () => {
  assert.equal(await clientIp("100.64.0.7", "6.6.6.6, 172.64.1.1, 198.51.100.4"), "198.51.100.4");
  assert.equal(await clientIp("203.0.113.50", "6.6.6.6, 172.64.1.1"), "203.0.113.50");
});

test("a public peer is the client, whatever it forwards", async () => {
  assert.equal(await clientIp("203.0.113.50", "6.6.6.6"), "203.0.113.50");
});

test("loopback is a trusted proxy, as is its IPv4-mapped form", async () => {
  assert.equal(await clientIp("127.0.0.1", "203.0.113.9"), "203.0.113.9");
  assert.equal(await clientIp("::ffff:127.0.0.1", "203.0.113.9"), "203.0.113.9");
});

test("Cloudflare IPv6 hops are trusted proxies", async () => {
  assert.equal(await clientIp("100.64.0.7", "6.6.6.6, 203.0.113.9, 2606:4700::1111"), "203.0.113.9");
});

test("link-local and unique-local peers are the client, whatever they forward", async () => {
  for (const peer of ["169.254.1.1", "fe80::1", "10.0.0.5", "192.168.1.5", "172.16.0.5", "fd12:3456::7", "::ffff:10.0.0.5"]) {
    assert.equal(await clientIp(peer, "203.0.113.9"), peer);
  }
});
