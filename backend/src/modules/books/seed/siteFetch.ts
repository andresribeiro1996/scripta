import { USER_AGENT } from "../adapters/http/http.js";
import { SourceUnavailableError } from "../domain/errors.js";

const TIMEOUT_MS = 30_000;

async function guarded<T>(url: string, timeoutMs: number, read: (res: Response) => Promise<T>): Promise<T> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(timeoutMs) });
    if (res.status === 429 || res.status >= 500) throw new SourceUnavailableError(new URL(url).hostname, `HTTP ${res.status}`, { status: res.status });
    return await read(res);
  } catch (error) {
    if (error instanceof TypeError || (error instanceof Error && error.name === "TimeoutError")) throw new SourceUnavailableError(new URL(url).hostname, error.message);
    throw error;
  }
}

export const fetchText = (url: string, timeoutMs = TIMEOUT_MS) => guarded(url, timeoutMs, async (res) => ({ status: res.status, text: await res.text() }));

export const fetchBytes = (url: string, timeoutMs = TIMEOUT_MS) => guarded(url, timeoutMs, async (res) => (res.ok ? Buffer.from(await res.arrayBuffer()) : null));
