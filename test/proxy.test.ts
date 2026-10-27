import { afterAll, describe, expect, test } from "bun:test";
import { createProxy } from "../src/proxy";

// A fake upstream API that echoes back what it received.
const upstream = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/v1/redirect") {
      return new Response(null, { status: 302, headers: { location: "/v1/users?page=2" } });
    }
    if (url.pathname === "/v1/external-redirect") {
      return new Response(null, { status: 302, headers: { location: "https://example.com/login" } });
    }
    if (url.pathname === "/v1/gzip") {
      return new Response(Bun.gzipSync("compressed hello"), {
        headers: { "content-encoding": "gzip", "content-type": "text/plain" },
      });
    }
    return Response.json(
      {
        method: req.method,
        path: url.pathname,
        search: url.search,
        headers: Object.fromEntries(req.headers),
        body: await req.text(),
      },
      {
        headers: {
          "x-total-count": "42",
          "access-control-allow-origin": "https://upstream-only.example",
          "set-cookie": "session=abc",
        },
      },
    );
  },
});

afterAll(() => upstream.stop(true));

const base = `${upstream.url.origin}/v1`;
const proxy = createProxy({ upstream: base, allowedOrigins: "*" });
const restricted = createProxy({ upstream: base, allowedOrigins: ["https://app.example"] });

describe("preflight", () => {
  test("answers without contacting the upstream", async () => {
    const res = await proxy(
      new Request("http://proxy.test/users", {
        method: "OPTIONS",
        headers: {
          origin: "https://anywhere.example",
          "access-control-request-method": "PATCH",
          "access-control-request-headers": "authorization, content-type",
        },
      }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toBe("PATCH");
    expect(res.headers.get("access-control-allow-headers")).toBe("authorization, content-type");
    expect(res.headers.get("access-control-max-age")).toBe("86400");
  });

  test("echoes an allowed origin when origins are restricted", async () => {
    const res = await restricted(
      new Request("http://proxy.test/users", {
        method: "OPTIONS",
        headers: { origin: "https://app.example", "access-control-request-method": "GET" },
      }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://app.example");
    expect(res.headers.get("vary")).toContain("Origin");
  });
});

describe("forwarding", () => {
  test("forwards path, query and headers under the upstream base path", async () => {
    const res = await proxy(
      new Request("http://proxy.test/users/7?include=projects", {
        headers: {
          origin: "https://anywhere.example",
          referer: "https://anywhere.example/page",
          authorization: "Bearer token",
          "sec-fetch-site": "cross-site",
        },
      }),
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.path).toBe("/v1/users/7");
    expect(body.search).toBe("?include=projects");
    expect(body.headers.authorization).toBe("Bearer token");
    expect(body.headers.origin).toBeUndefined();
    expect(body.headers.referer).toBeUndefined();
    expect(body.headers["sec-fetch-site"]).toBeUndefined();
  });

  test("replaces upstream CORS headers and exposes the rest", async () => {
    const res = await proxy(new Request("http://proxy.test/users", { headers: { origin: "https://anywhere.example" } }));
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-expose-headers")).toContain("x-total-count");
    expect(res.headers.get("x-total-count")).toBe("42");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  test("forwards request bodies", async () => {
    const res = await proxy(
      new Request("http://proxy.test/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Orpheus" }),
      }),
    );
    const body = await res.json();
    expect(body.method).toBe("POST");
    expect(body.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(body.body)).toEqual({ name: "Orpheus" });
  });

  test("returns decoded bodies without a stale content-encoding", async () => {
    const res = await proxy(new Request("http://proxy.test/gzip"));
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(await res.text()).toBe("compressed hello");
  });

  test("rewrites redirects into the upstream API to point at the proxy", async () => {
    const res = await proxy(new Request("http://proxy.test/redirect"));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/users?page=2");
  });

  test("leaves redirects elsewhere untouched", async () => {
    const res = await proxy(new Request("http://proxy.test/external-redirect"));
    expect(res.headers.get("location")).toBe("https://example.com/login");
  });
});

describe("errors", () => {
  test("rejects origins that are not allowed", async () => {
    const res = await restricted(new Request("http://proxy.test/users", { headers: { origin: "https://evil.example" } }));
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("allows requests without an origin when origins are restricted", async () => {
    const res = await restricted(new Request("http://proxy.test/users"));
    expect(res.status).toBe(200);
  });

  test("returns 502 with CORS headers when the upstream is unreachable", async () => {
    const dead = createProxy({ upstream: "http://127.0.0.1:1", allowedOrigins: "*" });
    const res = await dead(new Request("http://proxy.test/users", { headers: { origin: "https://anywhere.example" } }));
    expect(res.status).toBe(502);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});
