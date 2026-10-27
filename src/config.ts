import type { ProxyConfig } from "./proxy";

export const DEFAULT_TERRA_API_URL = "https://api.terra.hackclub.com";

export type Env = {
  TERRA_API_URL?: string;
  ALLOWED_ORIGINS?: string;
};

export function configFromEnv(env: Env): ProxyConfig {
  const origins = env.ALLOWED_ORIGINS?.trim();
  return {
    upstream: env.TERRA_API_URL || DEFAULT_TERRA_API_URL,
    allowedOrigins:
      !origins || origins === "*"
        ? "*"
        : origins
            .split(",")
            .map((origin) => origin.trim())
            .filter(Boolean),
  };
}
