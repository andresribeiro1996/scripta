import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks";

export const STALL_MS = 200;
const CHECK_EVERY_MS = 10_000;

export type WarnLog = Pick<FastifyBaseLogger, "warn">;
export type StepLog = Pick<FastifyBaseLogger, "warn" | "info">;

export function timeSync<T>(log: WarnLog, job: string, fn: () => T): T {
  const start = performance.now();
  try {
    return fn();
  } finally {
    const blockedMs = performance.now() - start;
    if (blockedMs > STALL_MS) log.warn({ job, blockedMs: Math.round(blockedMs) }, "job blocked the event loop");
  }
}

export function timeStep<T>(log: StepLog, step: string, fn: () => T): T {
  const start = performance.now();
  try {
    return fn();
  } finally {
    const ms = performance.now() - start;
    if (ms > STALL_MS) log.warn({ job: step, blockedMs: Math.round(ms) }, "job blocked the event loop");
    else log.info({ step, ms: Math.round(ms) }, "startup step");
  }
}

export function timedMethods<T extends object>(target: T, log: WarnLog, prefix: string): T {
  const timed: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(target)) {
    timed[name] = typeof value === "function"
      ? (...args: unknown[]) => timeSync(log, `${prefix}:${name}`, () => value.apply(target, args))
      : value;
  }
  return timed as T;
}

export function checkEventLoop(histogram: Pick<IntervalHistogram, "max" | "reset">, log: Pick<FastifyBaseLogger, "warn">) {
  const maxMs = histogram.max / 1e6;
  if (maxMs > STALL_MS) log.warn({ maxMs: Math.round(maxMs) }, "event loop stalled");
  histogram.reset();
}

export function registerStallLog(app: FastifyInstance) {
  app.addHook("onRoute", (routeOptions) => {
    const { handler, url } = routeOptions;
    routeOptions.handler = function (request, reply) {
      const start = performance.now();
      try {
        return handler.call(this, request, reply);
      } finally {
        const blockedMs = performance.now() - start;
        if (blockedMs > STALL_MS) {
          request.log.warn({ method: request.method, route: url, blockedMs: Math.round(blockedMs) }, "handler blocked the event loop");
        }
      }
    };
  });

  const histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();
  const timer = setInterval(() => checkEventLoop(histogram, app.log), CHECK_EVERY_MS).unref();
  app.addHook("onClose", async () => {
    clearInterval(timer);
    histogram.disable();
  });
}
