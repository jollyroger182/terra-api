import { expect, test } from "bun:test";
import { configFromEnv, DEFAULT_TERRA_API_URL } from "../src/config";

test("defaults to the Terra API and any origin", () => {
  expect(configFromEnv({})).toEqual({ upstream: DEFAULT_TERRA_API_URL, allowedOrigins: "*" });
  expect(configFromEnv({ TERRA_API_URL: "", ALLOWED_ORIGINS: " * " })).toEqual({
    upstream: DEFAULT_TERRA_API_URL,
    allowedOrigins: "*",
  });
});

test("parses a comma-separated origin list", () => {
  expect(configFromEnv({ ALLOWED_ORIGINS: "https://a.example, https://b.example,," }).allowedOrigins).toEqual([
    "https://a.example",
    "https://b.example",
  ]);
});
