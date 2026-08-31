// Proves what TRUST_PROXY actually does to `request.ip`, which is what
// every module's rate limiter keys on.
//
// Asserted against a real Fastify instance rather than just the parser,
// because the failure mode being guarded here is behavioural: get this
// wrong in one direction and every user shares one rate-limit bucket
// (all requests appear to come from the proxy); get it wrong in the
// other and any client can pick its own bucket by sending an
// X-Forwarded-For header.

import assert from "node:assert/strict";
import Fastify from "fastify";
import { describe, it } from "node:test";

import { parseTrustProxy } from "../src/config/env.js";

/** Boots a throwaway app with the given trustProxy setting and reports
 *  what it thinks the client IP is for a request carrying a spoofed
 *  X-Forwarded-For. */
async function reportedIp(trustProxy: boolean | string[], forwardedFor: string | undefined): Promise<string> {
  const app = Fastify({ logger: false, trustProxy });
  app.get("/whoami", async (request) => ({ ip: request.ip }));

  const response = await app.inject({
    method: "GET",
    url: "/whoami",
    remoteAddress: "10.1.1.1",
    headers: forwardedFor === undefined ? {} : { "x-forwarded-for": forwardedFor }
  });

  await app.close();
  return (response.json() as { ip: string }).ip;
}

describe("parseTrustProxy", () => {
  it("defaults to not trusting the header", () => {
    assert.equal(parseTrustProxy(""), false);
    assert.equal(parseTrustProxy("false"), false);
    assert.equal(parseTrustProxy("FALSE"), false);
  });

  it("accepts true", () => {
    assert.equal(parseTrustProxy("true"), true);
    assert.equal(parseTrustProxy("  True  "), true);
  });

  it("accepts a comma-separated list of trusted proxies", () => {
    assert.deepEqual(parseTrustProxy("10.0.0.0/8, 192.168.1.1"), ["10.0.0.0/8", "192.168.1.1"]);
  });
});

describe("request.ip under each setting", () => {
  it("ignores a spoofed X-Forwarded-For when not behind a proxy", async () => {
    // The mirror-image bug to the one this variable exists to fix: with
    // blanket trust and no proxy in front, this would return the spoofed
    // address and let a client hop rate-limit buckets at will.
    assert.equal(await reportedIp(false, "1.2.3.4"), "10.1.1.1");
  });

  it("uses the forwarded address when configured to trust the proxy", async () => {
    assert.equal(await reportedIp(true, "1.2.3.4"), "1.2.3.4");
  });

  it("falls back to the socket address when the proxy sends no header", async () => {
    assert.equal(await reportedIp(true, undefined), "10.1.1.1");
  });

  it("distinguishes two clients behind the same proxy", async () => {
    // The actual point: without this, both of these are the proxy's own
    // address and they share one rate-limit bucket.
    const first = await reportedIp(true, "203.0.113.7");
    const second = await reportedIp(true, "203.0.113.8");
    assert.notEqual(first, second);
  });

  it("only trusts a listed proxy", async () => {
    // 10.1.1.1 is the peer and is on the trusted list, so the forwarded
    // value is honoured...
    assert.equal(await reportedIp(["10.1.1.1"], "1.2.3.4"), "1.2.3.4");
    // ...but an unlisted peer's header is ignored.
    assert.equal(await reportedIp(["192.168.5.5"], "1.2.3.4"), "10.1.1.1");
  });
});
