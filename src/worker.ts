import { configFromEnv, type Env } from "./config";
import { createProxy } from "./proxy";

// Bindings don't change within an isolate, so the handler is built once on the first request.
let handler: ReturnType<typeof createProxy> | undefined;

export default {
  fetch(req: Request, env: Env) {
    handler ??= createProxy(configFromEnv(env));
    return handler(req);
  },
};
