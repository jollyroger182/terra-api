# terra-api-proxy

A small CORS proxy that lets browsers on other origins call the Terra API.

Every request to the proxy is forwarded to the same path under `TERRA_API_URL`, and the response comes back with CORS headers added:

```
GET https://terra-api.jollyy.dev/auth/me  ->  GET $TERRA_API_URL/auth/me
```

Unofficial documentation for the Terra API itself is in [`docs/API.md`](docs/API.md), with an OpenAPI 3.1 spec in [`docs/openapi.yaml`](docs/openapi.yaml).

## What it does

- Answers CORS preflight (`OPTIONS`) requests itself, allowing whatever method and headers the browser asks for.
- Adds `Access-Control-Allow-Origin` to every response, and exposes all upstream response headers to the browser.
- Strips `Origin`, `Referer` and `Sec-Fetch-*` from forwarded requests, so the upstream sees an ordinary server-to-server call.
- Passes `Authorization` and other headers through unchanged. Clients authenticate with the Terra API exactly as they would if they called it directly.
- Rewrites redirects that point back into the Terra API so they stay on the proxy.
- Drops `Set-Cookie` from responses, since cookies would be scoped to the proxy's domain.
- Returns `502` (with CORS headers) when the upstream can't be reached.

The proxy does not add credentials of its own. If it did, any allowed origin could act with them.

## Configuration

| Variable          | Default | Description                                                                                       |
| ----------------- | ------- | ------------------------------------------------------------------------------------------------- |
| `TERRA_API_URL`   | `https://api.terra.hackclub.com` | Base URL of the Terra API, including any path prefix.                      |
| `ALLOWED_ORIGINS` | `*`     | Comma-separated list of origins allowed to call the proxy, or `*` for any origin.                 |
| `PORT`            | `3000`  | Port to listen on.                                                                                |

When `ALLOWED_ORIGINS` is a list, browser requests from other origins get a `403`. Requests without an `Origin` header (curl, servers) are always forwarded, since CORS doesn't apply to them.

## Development

Requires [Bun](https://bun.sh).

```sh
bun install
bun run dev
bun test
```

## Deployment

The proxy runs either as a Bun server or as a Cloudflare Worker. Both entry points (`src/index.ts` and `src/worker.ts`) wrap the same handler in `src/proxy.ts`.

### Cloudflare Workers

Configuration lives in `vars` in `wrangler.jsonc`.

```sh
bun run worker:dev      # local workerd on http://localhost:8787
bun run worker:deploy
```

### Docker

```sh
docker build -t terra-api-proxy .
docker run -p 3000:3000 terra-api-proxy
```

## Calling it from a browser

```js
const res = await fetch("https://terra-api.jollyy.dev/auth/me", {
  headers: { Authorization: `Bearer ${token}` },
});
const { user } = await res.json();
```

Unauthenticated endpoints such as `/public/stats` work without a token.

## Why this is needed

`api.terra.hackclub.com` answers every request with `Access-Control-Allow-Origin: https://terra.hackclub.com`, so browsers block responses for any other origin. The OAuth endpoints (`/token`, `/register`, `/mcp`) are the exception and already allow `*`.

## How Terra authenticates

Observed from the outside (the public site bundle and the API's responses):

- **Login** goes through Hack Club Auth. `GET /auth/login` redirects to `auth.hackclub.com/oauth/authorize` (OIDC with PKCE), which calls back to `api.terra.hackclub.com/auth/callback`. The API then redirects to `terra.hackclub.com/?code=…`, and the site calls `GET /auth/exchange?code=…` to get `{ token, newUser }`.
- **Guests** get a token from `POST /auth/guest`.
- **Requests** send the token as `Authorization: Bearer <token>`. The site keeps it in `localStorage` under `terra_auth_token`. It is a JWT with an `exp` claim, which the site checks before reusing it.
- **Account linking** (Hackatime, GitHub) uses a short-lived code from `POST /auth/link-code`, passed to an API page as `?code=`.
- **Third-party/MCP clients** get a separate OAuth 2.1 server, described at `/.well-known/oauth-authorization-server`: PKCE, dynamic client registration at `/register`, public clients, refresh tokens, and a single `db:read` scope.

Because login ends with a redirect to `terra.hackclub.com` and the proxy drops cookies, the login flow can't run through the proxy. Clients have to bring a token they got some other way.

Terra auth doesn't use cookies, so a site can't act as a Terra user through the proxy unless it already holds that user's token.
