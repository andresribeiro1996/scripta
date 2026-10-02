import { AsyncLocalStorage } from "node:async_hooks";
import type { FastifyInstance } from "fastify";

const storage = new AsyncLocalStorage<{ traceId: string; source: string }>();

export function registerTrace(app: FastifyInstance) {
  app.addHook("onRequest", (request, _reply, done) => {
    storage.run({ traceId: request.id, source: `${request.method} ${request.routeOptions.url ?? request.url}` }, done);
  });
}

export function currentTrace() {
  return storage.getStore();
}
