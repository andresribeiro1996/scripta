// Walks through the full BookArena flow against a running dev server and
// prints each step's result. Not a test framework — see
// scripts/test-auth-flow.mjs's own header comment for why this shape.
// Requires the server already running (npm run dev) in another terminal.
//
// Usage:
//   node scripts/test-arena-flow.mjs
//   node scripts/test-arena-flow.mjs http://localhost:3000   (custom base URL)

const base = process.argv[2] || "http://localhost:3000";
const unique = Date.now();
const email = `arena-test-${unique}@example.com`;
const username = `arenatest${unique}`;
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

function book(n) {
  return { key: `book-${unique}-${n}`, title: `Test Book ${n}`, author: `Author ${n}`, cover: null };
}

async function main() {
  console.log(`Testing against ${base}\nUsing throwaway account: ${email} / @${username}\n`);

  console.log("1. Sign up a throwaway account");
  const signupRes = await fetch(`${base}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, username, password })
  });
  const { accessToken } = await signupRes.json();
  check("signup returns an access token", typeof accessToken === "string");
  const authHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` };

  console.log("\n2. Create a 4-book tournament");
  const createRes = await fetch(`${base}/arenas`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ name: "Test Bracket", bracketSize: 4, roundDurationMinutes: 60 })
  });
  const { tournament } = await createRes.json();
  check("create returns 201", createRes.status === 201, `got ${createRes.status}`);
  check("status starts as seeding", tournament?.status === "seeding");
  const tournamentId = tournament.id;

  console.log("\n3. Reject bracket sizes that aren't a power of two");
  const badSizeRes = await fetch(`${base}/arenas`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ name: "Bad", bracketSize: 6, roundDurationMinutes: 60 })
  });
  check("non-power-of-two bracket size returns 400", badSizeRes.status === 400, `got ${badSizeRes.status}`);

  console.log("\n4. Manually seed all 4 slots");
  const seedRes = await fetch(`${base}/arenas/${tournamentId}/slots`, {
    method: "PUT",
    headers: authHeaders,
    body: JSON.stringify({
      slots: [0, 1, 2, 3].map((i) => ({ slotIndex: i, book: book(i) }))
    })
  });
  check("seeding returns 204", seedRes.status === 204, `got ${seedRes.status}`);

  console.log("\n5. Start the tournament");
  const startRes = await fetch(`${base}/arenas/${tournamentId}/start`, { method: "POST", headers: authHeaders, body: JSON.stringify({}) });
  check("start returns 204", startRes.status === 204, `got ${startRes.status}`);

  console.log("\n6. Read the bracket publicly, no auth header");
  const viewRes = await fetch(`${base}/arenas/${tournamentId}`);
  const { tournament: view } = await viewRes.json();
  check("public GET returns 200", viewRes.status === 200, `got ${viewRes.status}`);
  check("round 1 has 2 duels", view.duels.length === 2);
  const [duelA, duelB] = view.duels;

  console.log("\n7. Vote from two different anonymous tokens, then early-settle");
  await fetch(`${base}/arenas/${tournamentId}/duels/${duelA.id}/vote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ voterToken: crypto.randomUUID(), bookKey: duelA.bookA.key })
  });
  const secondVoteToken = crypto.randomUUID();
  const firstVoteRes = await fetch(`${base}/arenas/${tournamentId}/duels/${duelA.id}/vote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ voterToken: secondVoteToken, bookKey: duelA.bookA.key })
  });
  check("second distinct voter's vote is accepted", firstVoteRes.status === 204, `got ${firstVoteRes.status}`);
  const dupeVoteRes = await fetch(`${base}/arenas/${tournamentId}/duels/${duelA.id}/vote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ voterToken: secondVoteToken, bookKey: duelA.bookB.key })
  });
  check("same voter voting again on the same duel returns 409", dupeVoteRes.status === 409, `got ${dupeVoteRes.status}`);

  const settleARes = await fetch(`${base}/arenas/${tournamentId}/duels/${duelA.id}/settle`, { method: "POST", headers: authHeaders, body: JSON.stringify({}) });
  check("owner early-settle returns 204", settleARes.status === 204, `got ${settleARes.status}`);

  console.log("\n8. Settle the second duel with NO votes at all (a tie: 0-0) and resolve it");
  const settleBRes = await fetch(`${base}/arenas/${tournamentId}/duels/${duelB.id}/settle`, { method: "POST", headers: authHeaders, body: JSON.stringify({}) });
  check("settling an unvoted duel returns 204", settleBRes.status === 204, `got ${settleBRes.status}`);
  const afterTieRes = await fetch(`${base}/arenas/${tournamentId}`);
  const { tournament: afterTie } = await afterTieRes.json();
  const settledDuelB = afterTie.duels.find((d) => d.id === duelB.id);
  check("a 0-0 duel is tied_pending_tiebreak, not auto-decided", settledDuelB.status === "tied_pending_tiebreak");

  const tiebreakRes = await fetch(`${base}/arenas/${tournamentId}/duels/${duelB.id}/tiebreak`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ winnerBookKey: duelB.bookA.key })
  });
  check("owner tie-break returns 204", tiebreakRes.status === 204, `got ${tiebreakRes.status}`);

  console.log("\n9. Confirm round 2 (the final) was generated");
  const round2Res = await fetch(`${base}/arenas/${tournamentId}`);
  const { tournament: round2 } = await round2Res.json();
  const final = round2.duels.find((d) => d.roundNumber === 2);
  check("the final duel exists", Boolean(final));
  check("tournament is still active, awaiting the final", round2.status === "active");

  console.log("\n10. Settle the final and confirm the tournament completes");
  await fetch(`${base}/arenas/${tournamentId}/duels/${final.id}/vote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ voterToken: crypto.randomUUID(), bookKey: final.bookA.key })
  });
  await fetch(`${base}/arenas/${tournamentId}/duels/${final.id}/settle`, { method: "POST", headers: authHeaders, body: JSON.stringify({}) });
  const finalRes = await fetch(`${base}/arenas/${tournamentId}`);
  const { tournament: completed } = await finalRes.json();
  check("tournament status is completed", completed.status === "completed", `got ${completed.status}`);

  console.log("\n11. It shows up in the public directory, and can be deleted");
  const publicRes = await fetch(`${base}/arenas/public`);
  const { tournaments: publicList } = await publicRes.json();
  check("the tournament appears in /arenas/public", publicList.some((t) => t.id === tournamentId));

  const deleteRes = await fetch(`${base}/arenas/${tournamentId}`, { method: "DELETE", headers: authHeaders, body: JSON.stringify({}) });
  check("delete returns 204", deleteRes.status === 204, `got ${deleteRes.status}`);
  const afterDeleteRes = await fetch(`${base}/arenas/${tournamentId}`);
  check("it 404s after deletion", afterDeleteRes.status === 404, `got ${afterDeleteRes.status}`);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
