// Walks through the full auth flow against a running dev server and
// prints each step's result. Not a test framework — just a readable,
// repeatable way to poke every endpoint without juggling curl + tokens
// by hand. Requires the server already running (npm run dev) in another
// terminal.
//
// Usage:
//   node scripts/test-auth-flow.mjs
//   node scripts/test-auth-flow.mjs http://localhost:3000   (custom base URL)

const base = process.argv[2] || "http://localhost:3000";
const unique = Date.now();
const email = `test-${unique}@example.com`;
const username = `testuser${unique}`;
const password = "a perfectly fine password";

let passed = 0;
let failed = 0;

function check(label, condition, detail) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

async function main() {
  console.log(`Testing against ${base}\nUsing throwaway account: ${email} / @${username}\n`);

  console.log("1. Health check");
  const health = await fetch(`${base}/health`);
  check("GET /health returns ok", health.status === 200);

  console.log("\n2. Signup");
  const signupRes = await fetch(`${base}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, username, password })
  });
  const signup = await signupRes.json();
  check("signup returns 201", signupRes.status === 201, `got ${signupRes.status}`);
  check("signup returns an access token", typeof signup.accessToken === "string");
  check("signup returns a refresh token", typeof signup.refreshToken === "string");
  check("signup echoes back the username", signup.user?.username === username);

  console.log("\n3. Duplicate email/username are rejected");
  const dupeEmailRes = await fetch(`${base}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, username: `${username}_other`, password })
  });
  check("duplicate email returns 409", dupeEmailRes.status === 409, `got ${dupeEmailRes.status}`);

  const dupeUsernameRes = await fetch(`${base}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: `other-${unique}@example.com`, username, password })
  });
  check("duplicate username returns 409", dupeUsernameRes.status === 409, `got ${dupeUsernameRes.status}`);

  console.log("\n4. Login by email");
  const loginRes = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: email, password })
  });
  const login = await loginRes.json();
  check("login by email returns 200", loginRes.status === 200, `got ${loginRes.status}`);

  console.log("\n5. Login by username");
  const loginByUsernameRes = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: username, password })
  });
  const loginByUsername = await loginByUsernameRes.json();
  check("login by username returns 200", loginByUsernameRes.status === 200, `got ${loginByUsernameRes.status}`);
  check("resolves to the same account", loginByUsername.user?.id === login.user?.id);

  console.log("\n6. Wrong password is rejected");
  const wrongRes = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: email, password: "definitely wrong" })
  });
  check("wrong password returns 401", wrongRes.status === 401, `got ${wrongRes.status}`);

  console.log("\n7. Authenticated route (/auth/me)");
  const meNoAuth = await fetch(`${base}/auth/me`);
  check("no token returns 401", meNoAuth.status === 401, `got ${meNoAuth.status}`);

  const meRes = await fetch(`${base}/auth/me`, {
    headers: { Authorization: `Bearer ${login.accessToken}` }
  });
  const me = await meRes.json();
  check("valid token returns 200", meRes.status === 200, `got ${meRes.status}`);
  check("returns the right user", me.user?.email === email && me.user?.username === username);

  console.log("\n8. Refresh token rotation");
  const refresh1Res = await fetch(`${base}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: login.refreshToken })
  });
  const refresh1 = await refresh1Res.json();
  check("refresh returns 200 with a new pair", refresh1Res.status === 200 && typeof refresh1.accessToken === "string");

  const replayRes = await fetch(`${base}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: login.refreshToken }) // the OLD one, already used
  });
  check("reusing the old (rotated-away) token returns 401", replayRes.status === 401, `got ${replayRes.status}`);

  const afterReplayRes = await fetch(`${base}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: refresh1.refreshToken }) // even the fresh one
  });
  check(
    "replay also revokes the fresh token (every session killed)",
    afterReplayRes.status === 401,
    `got ${afterReplayRes.status}`
  );

  console.log("\n9. Logout");
  const login2 = await (
    await fetch(`${base}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: email, password })
    })
  ).json();

  const logoutRes = await fetch(`${base}/auth/logout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: login2.refreshToken })
  });
  check("logout returns 204", logoutRes.status === 204, `got ${logoutRes.status}`);

  const refreshAfterLogout = await fetch(`${base}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: login2.refreshToken })
  });
  check("refresh after logout returns 401", refreshAfterLogout.status === 401, `got ${refreshAfterLogout.status}`);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("\nScript crashed — is the server running? (npm run dev)\n");
  console.error(err);
  process.exit(1);
});
