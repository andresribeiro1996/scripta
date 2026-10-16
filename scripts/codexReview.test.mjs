import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildPrompt, codexFailure, codexUsage, codexVerdict, configuredModel, parseFindings, parseReviewArgs, renderCodexReport } from "./codexReview.mjs";

const USAGE = { model: "gpt-6.1-sol", tokens: { input: 1300, cached: 1000, output: 350 } };
const FINDING = { severity: "blocking", file: "backend/src/a.ts", line: 12, summary: "Token leaks", scenario: "A shared link returns the owner's token." };

test("parseReviewArgs accepts only branch mode and needs a spec", () => {
  assert.throws(() => parseReviewArgs(["plan", "s.md", "p.md"]), /usage: codex-review.mjs branch/);
  assert.deepEqual(parseReviewArgs(["branch", "s.md"]), { mode: "branch", spec: "s.md", plan: undefined });
  assert.throws(() => parseReviewArgs(["branch"]), /usage: /);
  assert.throws(() => parseReviewArgs(["review", "s.md"]), /usage: /);
  assert.throws(() => parseReviewArgs(["constructor", "s.md"]), /usage: /);
});

test("buildPrompt appends the files to review after the brief", () => {
  assert.equal(buildPrompt("Brief.\n", { spec: "s.md", plan: "p.md" }), "Brief.\n\nSpec: s.md\nPlan: p.md\n");
  assert.equal(buildPrompt("Brief.", { spec: "s.md" }), "Brief.\n\nSpec: s.md\n");
});

test("codexUsage sums usage across turns and skips non-JSON lines", () => {
  const jsonl = [
    '{"type":"thread.started","thread_id":"t1"}',
    "warning: something on stdout",
    '{"type":"turn.completed","usage":{"input_tokens":1200,"cached_input_tokens":1000,"output_tokens":300}}',
    '{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":0,"output_tokens":50}}',
    "",
  ].join("\n");
  assert.deepEqual(codexUsage(jsonl), { model: null, tokens: { input: 1300, cached: 1000, output: 350 } });
});

test("codexUsage reads the recorded Codex run, which names no model", () => {
  const usage = codexUsage(readFileSync(new URL("./fixtures/codex-exec.jsonl", import.meta.url), "utf8"));
  assert.ok(usage.tokens.input > 0);
  assert.ok(usage.tokens.output > 0);
  assert.equal(usage.model, null);
});

test("configuredModel reads the top-level model from Codex's config", () => {
  assert.equal(configuredModel('model = "gpt-6.1-sol"\nmodel_reasoning_effort = "xhigh"\n\n[profiles.fast]\nmodel = "gpt-6.1-mini"\n'), "gpt-6.1-sol");
  assert.equal(configuredModel('model_reasoning_effort = "xhigh"\n[profiles.fast]\nmodel = "gpt-6.1-mini"\n'), null);
  assert.equal(configuredModel(""), null);
});

test("codexFailure reads why a turn failed, which Codex's exit code hides", () => {
  const failed = readFileSync(new URL("./fixtures/codex-exec-failed.jsonl", import.meta.url), "utf8");
  assert.equal(codexFailure(failed), "The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account.");
  assert.equal(codexFailure(readFileSync(new URL("./fixtures/codex-exec.jsonl", import.meta.url), "utf8")), null);
  assert.equal(codexFailure('{"type":"turn.failed","error":{"message":"plain text"}}'), "plain text");
});

test("parseFindings accepts the schema's shape", () => {
  assert.deepEqual(parseFindings(JSON.stringify({ verdict: "fail", findings: [FINDING] })), { verdict: "fail", findings: [FINDING] });
});

test("parseFindings refuses empty or malformed output", () => {
  assert.throws(() => parseFindings(""), SyntaxError);
  assert.throws(() => parseFindings('{"verdict":"maybe","findings":[]}'), /verdict/);
  assert.throws(() => parseFindings('{"verdict":"pass"}'), /findings/);
  assert.throws(() => parseFindings(JSON.stringify({ verdict: "fail", findings: [{ ...FINDING, severity: "nit" }] })), /severity/);
  assert.throws(() => parseFindings(JSON.stringify({ verdict: "fail", findings: [{ ...FINDING, scenario: " " }] })), /scenario/);
  assert.throws(() => parseFindings(JSON.stringify({ verdict: "fail", findings: [{ ...FINDING, line: "12" }] })), /line/);
});

test("a pass verdict with a blocking finding is still a fail", () => {
  assert.equal(codexVerdict({ verdict: "pass", findings: [FINDING] }), "CODEX: FAIL — 1 blocking");
  assert.equal(codexVerdict({ verdict: "fail", findings: [] }), "CODEX: FAIL — 0 blocking");
  assert.equal(codexVerdict({ verdict: "pass", findings: [{ ...FINDING, severity: "follow-up" }] }), "CODEX: PASS");
});

test("a report groups findings by severity and ends on the verdict", () => {
  const followUp = { ...FINDING, severity: "follow-up", summary: "Later" };
  const report = renderCodexReport({ mode: "branch", round: 2, seconds: 412, usage: USAGE, result: { verdict: "fail", findings: [followUp, FINDING] }, error: null });
  assert.match(report, /^# Codex branch review r2\n/);
  assert.match(report, /Model: gpt-6.1-sol · 412s · tokens in 1300 \(cached 1000\), out 350/);
  assert.match(report, /## Blocking\n\n1\. `backend\/src\/a.ts:12` — Token leaks\n {3}Scenario: A shared link/);
  assert.ok(report.indexOf("## Blocking") < report.indexOf("## Follow-ups"));
  assert.equal(report.trimEnd().split("\n").at(-1), "CODEX: FAIL — 1 blocking");
});

test("a clean report says so and passes", () => {
  const report = renderCodexReport({ mode: "branch", round: 1, seconds: 60, usage: { model: null, tokens: { input: 1, cached: 0, output: 1 } }, result: { verdict: "pass", findings: [] }, error: null });
  assert.match(report, /Model: unknown/);
  assert.match(report, /No findings\./);
  assert.equal(report.trimEnd().split("\n").at(-1), "CODEX: PASS");
});

test("an error report never says pass", () => {
  const report = renderCodexReport({ mode: "branch", round: 1, seconds: 3, usage: USAGE, result: null, error: "codex exited 1" });
  assert.equal(report.trimEnd().split("\n").at(-1), "CODEX: ERROR — codex exited 1");
  assert.doesNotMatch(report, /CODEX: PASS/);
});

test("parseFindings refuses keys the schema forbids and non-objects", () => {
  assert.throws(() => parseFindings('{"verdict":"pass","findings":[],"unexpected":true}'), /unexpected key/);
  assert.throws(() => parseFindings(JSON.stringify({ verdict: "fail", findings: [{ ...FINDING, note: "x" }] })), /unexpected key/);
  assert.throws(() => parseFindings("null"), /JSON object/);
  assert.throws(() => parseFindings("[]"), /JSON object/);
});

test("codexFailure ignores a non-fatal error event when the turn completed", () => {
  const jsonl = [
    '{"type":"error","message":"Reconnecting... 1/5"}',
    '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1}}',
  ].join("\n");
  assert.equal(codexFailure(jsonl), null);
  assert.equal(codexFailure('{"type":"error","message":"boom"}'), "boom");
});

test("codexUsage reads the model from an event", () => {
  assert.equal(codexUsage('{"type":"thread.started","model":"gpt-6.1-sol"}\n').model, "gpt-6.1-sol");
});
