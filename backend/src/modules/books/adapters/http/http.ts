import { SourceUnavailableError } from "../../domain/errors.js";

const TIMEOUT_MS = 10_000;
export const USER_AGENT = "Atmyshelf/1.0 (+https://atmyshelf.com)";

export type Throttle = <T>(task: () => Promise<T>, options?: { urgent?: boolean }) => Promise<T>;

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

function rateLimitField(header: string | null, field: string): number | undefined {
  const value = header?.match(new RegExp(`${field}=(\\d+)`))?.[1];
  return value === undefined ? undefined : Number(value);
}

async function failure(source: string, res: Response): Promise<SourceUnavailableError> {
  if (res.status !== 429) return new SourceUnavailableError(source, `HTTP ${res.status}`, { status: res.status });
  const ratelimit = res.headers.get("ratelimit");
  const retryAfter = Number(res.headers.get("retry-after"));
  const seconds = retryAfter > 0 ? retryAfter : rateLimitField(ratelimit, "reset");
  let body = "";
  try {
    body = await readBody(source, () => res.text());
  } catch (error) {
    if (!(error instanceof SourceUnavailableError)) throw error;
  }
  return new SourceUnavailableError(source, `HTTP 429 ${body.slice(0, 200)}`.trim(), {
    status: 429,
    retryAt: seconds === undefined ? undefined : Date.now() + seconds * 1000,
    quota: rateLimitField(ratelimit, "remaining") === 0 ? true : undefined
  });
}

export async function fetchJson(source: string, url: string, headers?: Record<string, string>): Promise<unknown> {
  const res = await request(source, url, headers);
  if (res.status === 404) return null;
  if (!res.ok) throw await failure(source, res);
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
  const urgent: Array<() => Promise<void>> = [];
  const normal: Array<() => Promise<void>> = [];
  let running = false;
  let lastStart = Number.NEGATIVE_INFINITY;

  async function pump() {
    running = true;
    while (urgent.length > 0 || normal.length > 0) {
      const wait = lastStart + minGapMs - now();
      if (wait > 0) await sleep(wait);
      const job = (urgent.shift() ?? normal.shift())!;
      lastStart = now();
      await job();
    }
    running = false;
  }

  return <T>(task: () => Promise<T>, options?: { urgent?: boolean }) =>
    new Promise<T>((resolve, reject) => {
      (options?.urgent ? urgent : normal).push(() => task().then(resolve, reject));
      if (!running) void pump();
    });
}
