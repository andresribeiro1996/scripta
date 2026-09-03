#!/usr/bin/env node
// `node scripts/gen-mobile-certs.mjs` — one-time setup for testing the
// PWA install/offline flow on a real phone. Run from the repo root.
//
// Why this exists at all: service workers (and "Add to Home Screen")
// only run in a "secure context", and a plain LAN address over HTTP
// isn't one — that's what makes `npm run dev:mobile` (backend/README,
// frontend/README) enough for browsing the app on a phone but NOT
// enough for installing it or testing offline caching. This generates
// one cert covering this machine's LAN address, localhost and loopback,
// written to .certs/ (gitignored — see root .gitignore) so both dev
// servers pick it up automatically:
//
//   backend/src/config/devCerts.ts   Fastify serves https when it finds it
//   frontend/vite.config.ts          Vite (dev AND preview) does the same
//
// Nothing else changes: no certs generated, nothing here runs, both
// servers behave exactly as before.
//
// Prefers mkcert (https://github.com/FiloSottile/mkcert) — it installs a
// local root CA into this machine's trust store, so the cert it issues
// is trusted with zero browser warnings once that CA is also on the
// phone (this script prints the one-time steps for that). Falls back to
// a plain self-signed cert via openssl when mkcert isn't installed —
// works exactly the same, just with an "unsafe site" warning to tap
// through on first load, since there's no CA to install anywhere.

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { CERT_DIR, CERT_PATH, KEY_PATH } from "./mobileCertPaths.mjs";
import { pickLanAddress } from "./lanAddress.mjs";

function commandExists(cmd) {
  try {
    execFileSync(process.platform === "win32" ? "where" : "which", [cmd], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const lanIp = process.env.LAN_IP ?? pickLanAddress();
if (!lanIp) {
  console.error(
    "gen-mobile-certs: couldn't find a LAN address on any network interface.\n" +
      "Is this machine on Wi-Fi/Ethernet? You can also pass one explicitly:\n" +
      "  LAN_IP=192.168.1.20 node scripts/gen-mobile-certs.mjs"
  );
  process.exit(1);
}

// Every hostname the phone or this machine might use to reach either dev
// server: the LAN address (what the phone actually uses), localhost and
// both loopback forms (what this machine uses when you check things from
// its own browser first).
const names = [lanIp, "localhost", "127.0.0.1", "::1"];

mkdirSync(CERT_DIR, { recursive: true });

if (commandExists("mkcert")) {
  console.log("Using mkcert.\n");
  // Idempotent — safe to run every time; a no-op once the CA already
  // exists and is installed.
  execFileSync("mkcert", ["-install"], { stdio: "inherit" });
  execFileSync("mkcert", ["-cert-file", CERT_PATH, "-key-file", KEY_PATH, ...names], { stdio: "inherit" });

  const caRootDir = execFileSync("mkcert", ["-CAROOT"]).toString().trim();
  const caRootPem = `${caRootDir}/rootCA.pem`;
  const caCopyPath = `${CERT_DIR}/rootCA.pem`;
  copyFileSync(caRootPem, caCopyPath);

  console.log(`\nCert written to ${CERT_PATH}`);
  console.log(`Root CA copied to ${caCopyPath} — this is the file the phone needs to trust.\n`);
  console.log("One-time step on the phone:");
  console.log(`  1. Get ${caCopyPath} onto the phone (AirDrop, a USB cable, or serve`);
  console.log(`     the repo root over http and download it — it's not secret, just a`);
  console.log(`     local CA cert).`);
  console.log("  2. Open it on the phone. iOS: Settings > General > VPN & Device");
  console.log('     Management, install the profile, then Settings > General > About >');
  console.log('     Certificate Trust Settings, enable full trust for it. Android: Settings');
  console.log('     > Security > Encryption & credentials > Install a certificate > CA');
  console.log("     certificate.");
} else if (commandExists("openssl")) {
  console.log("mkcert not found — falling back to a plain self-signed cert via openssl.");
  console.log("(brew install mkcert / choco install mkcert / apt install mkcert avoids");
  console.log("the browser warning below entirely — worth it if you'll do this more than once.)\n");

  const subjectAltNames = names
    .map((name, i) => (/^[\d:.a-fA-F]+$/.test(name) ? `IP.${i + 1}:${name}` : `DNS.${i + 1}:${name}`))
    .join(",");
  const opensslConfig = `[req]
distinguished_name = req
[san]
subjectAltName = ${subjectAltNames}
`;
  const configPath = `${CERT_DIR}/openssl.cnf`;
  writeFileSync(configPath, opensslConfig);

  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "825",
      "-keyout",
      KEY_PATH,
      "-out",
      CERT_PATH,
      "-subj",
      "/CN=scripta-mobile-dev",
      "-extensions",
      "san",
      "-config",
      configPath
    ],
    { stdio: "inherit" }
  );

  console.log(`\nCert written to ${CERT_PATH}`);
  console.log("This cert isn't signed by anything the phone trusts, so its browser will");
  console.log('show an "unsafe site" / "connection not private" warning on first load —');
  console.log("that's expected here, not a bug. Tap through it (usually \"Advanced\" >");
  console.log('"proceed anyway"). Once accepted, the page IS a secure context and the');
  console.log("service worker / install prompt behave normally.");
} else {
  console.error(
    "gen-mobile-certs: neither mkcert nor openssl found on PATH.\n" +
      "Install one of them and re-run this script:\n" +
      "  macOS:   brew install mkcert\n" +
      "  Windows: choco install mkcert\n" +
      "  Linux:   see https://github.com/FiloSottile/mkcert#installation"
  );
  process.exit(1);
}

console.log(`\nCovers: ${names.join(", ")}`);
console.log("\nNow just run the normal commands — both pick the cert up automatically:");
console.log("  cd backend  && npm run dev:mobile");
console.log("  cd frontend && npm run preview:mobile");
console.log(
  '\n(preview, not dev, for the frontend — it builds fresh and serves that, since the\n' +
    "service worker is only emitted in a production build; see frontend/README.md's PWA\n" +
    "section. Regular `dev:mobile` still works over https too, for everything except\n" +
    "install/offline.)"
);
