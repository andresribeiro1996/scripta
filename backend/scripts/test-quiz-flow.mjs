// Walks through the full cover-quiz flow against a running dev server and
// prints each step's result. Same shape as scripts/test-arena-flow.mjs.
// Requires the server already running (npm run dev) in another terminal.
//
// Usage:
//   node scripts/test-quiz-flow.mjs
//   node scripts/test-quiz-flow.mjs http://localhost:3100   (custom base URL)

const base = process.argv[2] || "http://localhost:3000";
const unique = Date.now();
const email = `quiz-test-${unique}@example.com`;
const username = `quiztest${unique}`;
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

const books = Array.from({ length: 5 }, (_, i) => ({
  title: `Test Book ${unique} ${i}`,
  author: `Author ${i}`,
  coverUrl: `https://covers.example.test/${i}.jpg`,
  quote: `A famous line from Test Book ${i}.`,
  blurb: null
}));
books.push({ title: `Test Book ${unique} quoteless`, author: "Author X", coverUrl: null, quote: "A line from the coverless book.", blurb: null });

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

  console.log("\n2. Create a quiz from six books");
  const createRes = await fetch(`${base}/quizzes`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      name: "Flow Quiz",
      data: { sourceLabel: "Shelf", questionCount: 5, allowedTypes: ["cover_title", "title_cover", "quote_title"], books, questions: null }
    })
  });
  const quiz = await createRes.json();
  check("create returns 201", createRes.status === 201, `got ${createRes.status}`);
  check("starts as a draft", quiz?.voteCode === null && quiz?.playOpen === false);
  const quizId = quiz.id;

  console.log("\n3. Draft quizzes stay editable");
  const renameRes = await fetch(`${base}/quizzes/${quizId}`, {
    method: "PUT",
    headers: authHeaders,
    body: JSON.stringify({ name: "Renamed Flow Quiz" })
  });
  check("rename returns 200", renameRes.status === 200, `got ${renameRes.status}`);
  const dupRes = await fetch(`${base}/quizzes/${quizId}`, {
    method: "PUT",
    headers: authHeaders,
    body: JSON.stringify({ data: { sourceLabel: "Shelf", questionCount: 5, allowedTypes: ["cover_title"], books: [books[0], books[0]] } })
  });
  check("two copies of one work are a 409", dupRes.status === 409, `got ${dupRes.status}`);

  console.log("\n4. Publish mints a code and opens play");
  const publishRes = await fetch(`${base}/quizzes/${quizId}/publish`, { method: "POST", headers: authHeaders, body: JSON.stringify({}) });
  const published = await publishRes.json();
  check("publish returns 201", publishRes.status === 201, `got ${publishRes.status}`);
  const code = published.voteCode;
  check("vote code present", typeof code === "string" && code.length > 0);
  const publishedQuestions = published.quiz?.data?.questions ?? [];
  check("five questions seeded", publishedQuestions.length === 5, `got ${publishedQuestions.length}`);
  const lockedRes = await fetch(`${base}/quizzes/${quizId}`, { method: "PUT", headers: authHeaders, body: JSON.stringify({ name: "Nope" }) });
  check("published quiz is locked (404)", lockedRes.status === 404, `got ${lockedRes.status}`);

  console.log("\n5. The public board never carries the answer key");
  const boardRes = await fetch(`${base}/quizzes/voting/${code}`);
  const { board } = await boardRes.json();
  check("board returns 200", boardRes.status === 200);
  check("five public questions", board?.questions?.length === 5);
  check("no answerIndex anywhere", board.questions.every((q) => !("answerIndex" in q)));
  check("every question has a prompt and 4 options", board.questions.every((q) => q.prompt.length > 0 && q.options.length === 4));

  console.log("\n6. An anonymous player can play once");
  const playAnswers = board.questions.map((q) => ({ questionId: q.id, choiceIndex: 0 }));
  const playRes = await fetch(`${base}/quizzes/voting/${code}/play`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answers: playAnswers, durationMs: 42000, playerName: "Guest One" })
  });
  const play = await playRes.json();
  check("play returns 200 with a score", playRes.status === 200 && typeof play.score === "number", `got ${playRes.status}`);
  check("per-question verdicts returned", Object.keys(play.correct ?? {}).length === 5);
  const recoverRes = await fetch(`${base}/quizzes/voting/${code}/play/${play.playId}`);
  check("play recoverable by id", recoverRes.status === 200 && (await recoverRes.json()).playId === play.playId);
  const shapedRes = await fetch(`${base}/quizzes/voting/${code}/play`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answers: [{ questionId: board.questions[0].id, choiceIndex: 0 }], durationMs: 1 })
  });
  check("wrong-shaped submission is a 400", shapedRes.status === 400, `got ${shapedRes.status}`);

  console.log("\n7. The signed-in owner can play once, then is locked");
  const ownerPlayRes = await fetch(`${base}/quizzes/voting/${code}/play`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ answers: playAnswers, durationMs: 1000, playerName: "Owner" })
  });
  check("owner play returns 200", ownerPlayRes.status === 200, `got ${ownerPlayRes.status}`);
  const ownerAgainRes = await fetch(`${base}/quizzes/voting/${code}/play`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ answers: playAnswers, durationMs: 1000, playerName: "Owner" })
  });
  check("second owner play is a 409", ownerAgainRes.status === 409, `got ${ownerAgainRes.status}`);

  console.log("\n8. Leaderboards");
  const publicResultsRes = await fetch(`${base}/quizzes/voting/${code}/results`);
  const publicResults = await publicResultsRes.json();
  check("public leaderboard returns 200 with 2 plays", publicResultsRes.status === 200 && publicResults.plays.length === 2);
  check("public rows hide playId", publicResults.plays.every((p) => !("playId" in p)));
  const ownerResultsRes = await fetch(`${base}/quizzes/${quizId}/results`, { headers: authHeaders });
  const ownerResults = await ownerResultsRes.json();
  check("owner results carry stats and questionCount", ownerResults.stats.length > 0 && ownerResults.questionCount === 5);
  check("owner plays ordered score-then-speed", ownerResults.plays[0].durationMs <= ownerResults.plays[1].durationMs);
  const foreignResultsRes = await fetch(`${base}/quizzes/${quizId}/results`, {
    method: "GET",
    headers: { "Content-Type": "application/json", Authorization: "Bearer not-a-token" }
  });
  check("owner results need a real session", foreignResultsRes.status === 401 || foreignResultsRes.status === 403, `got ${foreignResultsRes.status}`);

  console.log("\n9. Closing the quiz locks play and the board");
  await fetch(`${base}/quizzes/${quizId}/voting`, { method: "PUT", headers: authHeaders, body: JSON.stringify({ open: false }) });
  const closedBoardRes = await fetch(`${base}/quizzes/voting/${code}`);
  check("closed board is a 403", closedBoardRes.status === 403, `got ${closedBoardRes.status}`);
  const closedPlayRes = await fetch(`${base}/quizzes/voting/${code}/play`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answers: playAnswers, durationMs: 1 })
  });
  check("closed play is a 403", closedPlayRes.status === 403, `got ${closedPlayRes.status}`);

  console.log("\n10. Cleanup");
  // Arena-flow precedent: the JSON body keeps Fastify's empty-JSON-body
  // check (FST_ERR_CTP_EMPTY_JSON_BODY) from 400ing a content-typed DELETE.
  const deleteRes = await fetch(`${base}/quizzes/${quizId}`, { method: "DELETE", headers: authHeaders, body: JSON.stringify({}) });
  check("delete returns 204", deleteRes.status === 204, `got ${deleteRes.status}`);
  const goneRes = await fetch(`${base}/quizzes/voting/${code}`);
  check("code is dead after delete", goneRes.status === 404, `got ${goneRes.status}`);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
