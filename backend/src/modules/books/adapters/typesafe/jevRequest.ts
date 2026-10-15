import { SourceUnavailableError, UnusableAnswerError } from "../../domain/errors.js";
import type { Spend } from "../../typesafe.js";
import { readBody } from "../http/http.js";

export const JEV_MODEL = "jev-1.13.0";
const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const TIMEOUT_MS = 10_000;
const RETRIES = 4;

export type Sleep = (ms: number) => Promise<void>;
export const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function askJev(apiKey: string, spend: Spend, sleep: Sleep, state: unknown, questions: Record<string, unknown>): Promise<unknown> {
  const body = JSON.stringify({ state, model: JEV_MODEL, questions });
  for (let attempt = 0; ; attempt++) {
    spend();
    const response = await readBody("typesafe", () => fetch(ENDPOINT, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body, signal: AbortSignal.timeout(TIMEOUT_MS) }));
    if ((response.status === 429 || response.status === 529) && attempt < RETRIES) {
      await response.body?.cancel();
      await sleep(500 * 2 ** attempt);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new SourceUnavailableError("typesafe", `HTTP ${response.status}`, { status: response.status });
    }
    try {
      return await readBody("typesafe", () => response.json());
    } catch (error) {
      if (error instanceof SyntaxError) throw new UnusableAnswerError("typesafe", "invalid JSON");
      throw error;
    }
  }
}
