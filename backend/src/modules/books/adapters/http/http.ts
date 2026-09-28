import { SourceUnavailableError } from "../../domain/errors.js";

const TIMEOUT_MS = 10_000;
const USER_AGENT = "Atmyshelf/1.0 (book covers)";

export type Throttle = <T>(task: () => Promise<T>) => Promise<T>;

async function readBody<T>(source: string, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof TypeError || (error instanceof Error && error.name === "TimeoutError")) {
      throw new SourceUnavailableError(source, error.message);
    }
    throw error;
  }
}

async function request(source: string, url: string, headers: Record<string, string> = {}): Promise<Response> {
  return readBody(source, () => fetch(url, { headers: { "User-Agent": USER_AGENT, ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS) }));
}

export async function fetchJson(source: string, url: string, headers?: Record<string, string>): Promise<unknown> {
  const res = await request(source, url, headers);
  if (res.status === 404) return null;
  if (!res.ok) throw new SourceUnavailableError(source, `HTTP ${res.status}`);
  try {
    return await readBody(source, () => res.json());
  } catch (error) {
    if (error instanceof SyntaxError) throw new SourceUnavailableError(source, "invalid JSON");
    throw error;
  }
}

export async function fetchBytes(source: string, url: string): Promise<Buffer | null> {
  const res = await request(source, url);
  if (res.status === 429 || res.status >= 500) throw new SourceUnavailableError(source, `HTTP ${res.status}`);
  if (!res.ok) return null;
  return Buffer.from(await readBody(source, () => res.arrayBuffer()));
}

export function createThrottle(
  minGapMs: number,
  now: () => number = Date.now,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
): Throttle {
  let tail: Promise<unknown> = Promise.resolve();
  let lastStart = Number.NEGATIVE_INFINITY;
  return <T>(task: () => Promise<T>) => {
    const run = tail.then(async () => {
      const wait = lastStart + minGapMs - now();
      if (wait > 0) await sleep(wait);
      lastStart = now();
      return task();
    });
    tail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };
}
