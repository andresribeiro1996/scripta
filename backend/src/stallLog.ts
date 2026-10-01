import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks";

export const STALL_MS = 200;
const CHECK_EVERY_MS = 10_000;

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
