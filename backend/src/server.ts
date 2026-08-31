import { env } from "./config/env.js";
import { buildApp } from "./app.js";

const app = buildApp();

app
  .listen({ port: env.PORT, host: "::" })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
