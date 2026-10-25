import { DatabaseSync } from "node:sqlite";
import { parseEnv } from "node:util";
import { devDataDirEnv } from "./devDataDir.mjs";

export function webUrls({ vitePort, apiPort, https }) {
  const scheme = https ? "https" : "http";
  return { web: `${scheme}://localhost:${vitePort}`, api: `${scheme}://localhost:${apiPort}` };
}

export function portsFromEnvLocal(text) {
  const env = parseEnv(text);
  const read = (key) => {
    if (!env[key]) throw new Error(`${key} is missing from frontend/.env.local; run node scripts/dev-web.mjs first`);
    return Number(env[key]);
  };
  return { vitePort: read("VITE_PORT"), apiPort: read("VITE_API_PORT") };
}

export function readDevUserId(authDbPath, email) {
  const db = new DatabaseSync(authDbPath, { readOnly: true });
  try {
    const row = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
    if (!row) throw new Error(`no user with email ${email} in ${authDbPath}`);
    return row.id;
  } finally {
    db.close();
  }
}

export function webBackendEnv({ adminUserId, https, vitePort, apiPort, certPath, keyPath }) {
  const env = { ...devDataDirEnv(), ADMIN_USER_ID: adminUserId };
  if (!https) return env;
  return {
    ...env,
    DEV_HTTPS_CERT_PATH: certPath,
    DEV_HTTPS_KEY_PATH: keyPath,
    FRONTEND_URL: `https://localhost:${vitePort}`,
    PUBLIC_API_URL: `https://localhost:${apiPort}`,
  };
}
