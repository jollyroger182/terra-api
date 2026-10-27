import { configFromEnv } from "./config";
import { createProxy } from "./proxy";

const config = configFromEnv(process.env);

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  idleTimeout: 60,
  fetch: createProxy(config),
});

console.log(`Proxying ${server.url} -> ${config.upstream} (allowed origins: ${config.allowedOrigins})`);
