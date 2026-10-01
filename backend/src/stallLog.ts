import type { FastifyInstance } from "fastify";

export const STALL_MS = 200;

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
}
