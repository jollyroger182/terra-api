// Headers that describe a single connection and must not be forwarded by a proxy.
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

// Request headers that would make the upstream treat the call as a cross-site browser request,
// or that fetch() sets itself.
const DROP_REQUEST = ["host", "origin", "referer", "content-length", "accept-encoding"];

// fetch() decodes compressed bodies, so the upstream's encoding and length no longer apply.
// Cookies would be scoped to the proxy's domain, not the API's, so they are dropped too.
const DROP_RESPONSE = new Set(["content-encoding", "content-length", "set-cookie"]);

export type ProxyConfig = {
  /** Base URL of the upstream API, e.g. "https://api.example.com/v1". */
  upstream: string;
  /** Origins allowed to call the proxy, or "*" for any origin. */
  allowedOrigins: string[] | "*";
  /** How long browsers may cache a preflight response, in seconds. */
  maxAge?: number;
};

export function createProxy(config: ProxyConfig) {
  const upstream = new URL(config.upstream);
  const basePath = upstream.pathname.replace(/\/+$/, "");
  const maxAge = String(config.maxAge ?? 86400);

  function isAllowed(origin: string) {
    return config.allowedOrigins === "*" || config.allowedOrigins.includes(origin);
  }

  function corsHeaders(origin: string | null) {
    const headers = new Headers();
    if (config.allowedOrigins === "*") {
      headers.set("access-control-allow-origin", "*");
    } else {
      headers.set("vary", "Origin");
      if (origin !== null && isAllowed(origin)) headers.set("access-control-allow-origin", origin);
    }
    return headers;
  }

  // Rewrites a redirect that points back into the upstream API so the browser stays on the proxy.
  function rewriteLocation(location: string, target: URL) {
    const resolved = new URL(location, target);
    if (resolved.origin !== upstream.origin) return location;
    if (resolved.pathname !== basePath && !resolved.pathname.startsWith(`${basePath}/`)) return location;
    return (resolved.pathname.slice(basePath.length) || "/") + resolved.search + resolved.hash;
  }

  return async function handle(req: Request): Promise<Response> {
    const origin = req.headers.get("origin");

    // Requests without an Origin header come from non-browser clients, which CORS doesn't apply to.
    if (origin !== null && !isAllowed(origin)) {
      return json(403, { error: "Origin not allowed" }, corsHeaders(origin));
    }

    if (req.method === "OPTIONS" && req.headers.has("access-control-request-method")) {
      const headers = corsHeaders(origin);
      headers.set("access-control-allow-methods", req.headers.get("access-control-request-method")!);
      const requestedHeaders = req.headers.get("access-control-request-headers");
      if (requestedHeaders) headers.set("access-control-allow-headers", requestedHeaders);
      headers.set("access-control-max-age", maxAge);
      headers.append("vary", "Access-Control-Request-Method, Access-Control-Request-Headers");
      return new Response(null, { status: 204, headers });
    }

    const incoming = new URL(req.url);
    const target = new URL(upstream.origin + basePath + incoming.pathname + incoming.search);

    const headers = new Headers();
    req.headers.forEach((value, name) => {
      if (HOP_BY_HOP.has(name) || DROP_REQUEST.includes(name) || name.startsWith("sec-fetch-")) return;
      headers.append(name, value);
    });

    let res: Response;
    try {
      res = await fetch(target, {
        method: req.method,
        headers,
        body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer(),
        redirect: "manual",
      });
    } catch (err) {
      console.error(`${req.method} ${target} failed:`, err);
      return json(502, { error: "Upstream request failed" }, corsHeaders(origin));
    }

    const out = corsHeaders(origin);
    const exposed = new Set<string>();
    res.headers.forEach((value, name) => {
      if (HOP_BY_HOP.has(name) || DROP_RESPONSE.has(name) || name.startsWith("access-control-")) return;
      out.append(name, name === "location" ? rewriteLocation(value, target) : value);
      exposed.add(name);
    });
    if (exposed.size > 0) out.set("access-control-expose-headers", [...exposed].join(", "));

    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
  };
}

function json(status: number, body: unknown, headers: Headers) {
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify(body), { status, headers });
}
