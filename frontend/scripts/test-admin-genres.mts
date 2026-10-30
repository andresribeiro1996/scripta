import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { QueryClient } from "@tanstack/react-query";
import type { GenreReview, GenreReviewAction } from "@scripta/shared";

const store = new Map<string, string>();
const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } };
Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
Object.defineProperty(globalThis, "sessionStorage", { value: storage, configurable: true });

const { area, footerAreas } = await import("../src/lib/areas");
const { GenreReviewList, GenreReviewRowView, submitDecision } = await import("../src/components/GenreReviewList");
const { decideGenre } = await import("../src/pages/AdminGenresPage");

const item = (workId: string, evidence: GenreReview["items"][number]["evidence"]) => ({ workId, title: `Title ${workId}`, author: "Author", coverUrl: null, synopsis: "A synopsis.", holders: 2, finished: true, evidence });
const rejected = item("r", { group: "rejected", status: 400, reason: "HTTP 400", attempts: 3, lastAt: "2026-10-15T00:00:00.000Z" });
const none = item("n", { group: "none", confidence: 0.91 });
const unsure = item("u", { group: "unsure", genre: "Poetry", confidence: 0.34 });
const possible = item("p", { group: "possible", genre: "History", confidence: 0.62 });
const review: GenreReview = { items: [rejected, none, unsure, possible], total: 4 };

const render = () => renderToString(createElement(GenreReviewList, { review, onDecide: async () => {} }));

test("each group shows its heading, count and evidence", () => {
  const html = render();
  for (const text of ["Rejected by TypeSafe (1)", "Jev found no genre (1)", "Jev was unsure (1)", "Possible genres (1)", "Rejected 3× · HTTP 400", "Jev: none (0.91)", "Jev: Poetry? (0.34)", "Possibly History (0.62)"]) {
    assert.ok(html.includes(text), text);
  }
});

test("Retry is offered on rejected rows only, and Jev's guess is preselected", () => {
  const html = render();
  assert.equal(html.split(">Retry<").length - 1, 1);
  assert.equal(html.split(">No genre<").length - 1, 4);
  assert.match(html, /aria-pressed="true"[^>]*>Poetry</);
  assert.match(html, /aria-pressed="true"[^>]*>History</);
});

test("the genre review link shows only for the admin", () => {
  assert.ok(footerAreas(true).some((a) => a.id === "admin" && a.to === "/admin/genres"));
  assert.ok(area("admin").tabs.some((t) => t.to === "/admin/genres"));
  assert.deepEqual(footerAreas(false), []);
});

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return isValidElement(node) ? textOf((node.props as { children?: ReactNode }).children) : "";
}

function buttons(node: ReactNode): ReactElement<{ onClick?: () => void; disabled?: boolean }>[] {
  if (Array.isArray(node)) return node.flatMap(buttons);
  if (!isValidElement(node)) return [];
  const own = node.type === "button" ? [node as ReactElement<{ onClick?: () => void; disabled?: boolean }>] : [];
  return [...own, ...buttons((node.props as { children?: ReactNode }).children)];
}

function press(view: ReactNode, label: string) {
  const button = buttons(view).find((candidate) => textOf(candidate) === label);
  assert.ok(button, label);
  button.props.onClick?.();
}

function rowView(row: typeof rejected, picked: string[], onDecide: (action: GenreReviewAction) => void) {
  return GenreReviewRowView({ item: row, picked, busy: false, error: null, onToggle: () => {}, onDecide });
}

test("Save sends the picked genres, No genre sends none, Retry asks again", () => {
  const sent: GenreReviewAction[] = [];
  const view = rowView(rejected, ["Poetry", "History"], (action) => sent.push(action));
  press(view, "Save");
  press(view, "No genre");
  press(view, "Retry");
  assert.deepEqual(sent, [{ genres: ["Poetry", "History"] }, { genres: [] }, { retry: true }]);
});

test("Retry is not a button on a row that was not rejected", () => {
  const labels = buttons(rowView(unsure, ["Poetry"], () => {})).map(textOf);
  assert.ok(labels.includes("Save") && labels.includes("No genre"));
  assert.ok(!labels.includes("Retry"));
});

test("Save is disabled until a genre is picked", () => {
  const save = (picked: string[]) => buttons(rowView(none, picked, () => {})).find((button) => textOf(button) === "Save")!;
  assert.equal(save([]).props.disabled, true);
  assert.equal(save(["Poetry"]).props.disabled, false);
});

test("a failed decision keeps the row's error and a good one reports none", async () => {
  assert.equal(await submitDecision(async () => {}, "r", { retry: true }), null);
  assert.equal(await submitDecision(async () => { throw new Error("TypeSafe is down"); }, "r", { retry: true }), "TypeSafe is down");
  const html = renderToString(GenreReviewRowView({ item: rejected, picked: [], busy: false, error: "TypeSafe is down", onToggle: () => {}, onDecide: () => {} }));
  assert.match(html, /role="alert"[^>]*>TypeSafe is down</);
});

async function withFetch(handler: (url: string, init: RequestInit) => Response) {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init: init ?? {} }); return handler(String(url), init ?? {}); };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test("a saved decision posts to the work and removes its row", async () => {
  const client = new QueryClient();
  client.setQueryData<GenreReview>(["genre-review"], review);
  const http = await withFetch(() => Response.json({ workId: "u", editions: 2 }));
  try {
    await decideGenre(client, "u", { genres: ["Poetry"] });
    assert.ok(http.calls[0]!.url.endsWith("/books/genre-review/u"));
    assert.equal(http.calls[0]!.init.method, "POST");
    assert.deepEqual(JSON.parse(String(http.calls[0]!.init.body)), { genres: ["Poetry"] });
    const left = client.getQueryData<GenreReview>(["genre-review"])!;
    assert.deepEqual(left.items.map((entry) => entry.workId), ["r", "n", "p"]);
    assert.equal(left.total, 3);
  } finally { http.restore(); }
});

test("a failed decision leaves the list as it was and rejects", async () => {
  const client = new QueryClient();
  client.setQueryData<GenreReview>(["genre-review"], review);
  const http = await withFetch(() => Response.json({ error: "No such work" }, { status: 404 }));
  try {
    await assert.rejects(decideGenre(client, "u", { genres: [] }), /No such work/);
    assert.equal(client.getQueryData<GenreReview>(["genre-review"]), review);
  } finally { http.restore(); }
});

test("review queues are list panels; Not found uses the shared primary", () => {
  const read = (f: string) => readFileSync(new URL(`../src/${f}.tsx`, import.meta.url), "utf8");
  for (const f of ["components/GenreReviewList", "components/SynopsisReviewList", "components/TranslationReviewList"]) assert.match(read(f), /LIST_PANEL/, f);
  assert.match(read("pages/NotFoundPage"), /BUTTON_PRIMARY/);
  assert.match(read("pages/NotFoundPage"), /framed \? "min-h-\[calc\(100dvh-var\(--app-top\)\)\]" : "min-h-dvh"/);
  for (const f of ["AdminTranslationsPage", "AdminSynopsesPage", "AdminDailyChapterPage", "AdminGenresPage"]) assert.match(read(`pages/${f}`), /<NotFoundPage framed \/>/, f);
  assert.match(readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8"), /path="\*" element=\{<NotFoundPage \/>\}/);
  for (const f of ["components/GenreReviewList", "components/SynopsisReviewList", "components/TranslationReviewList"]) assert.doesNotMatch(read(f), /BUTTON_PRIMARY/, f);
});
