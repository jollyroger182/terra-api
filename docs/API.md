# Terra API

Unofficial documentation for the API behind [Terra](https://terra.hackclub.com), Hack Club's "code each week, grow your farm" YSWS game. Everything here was worked out from the outside. See [How this was gathered](#how-this-was-gathered) for what was and wasn't verified.

The player-facing REST endpoints are also described as an OpenAPI 3.1 spec in [`openapi.yaml`](openapi.yaml).

The API changes with the game. Treat this as a snapshot from October 2026, not a contract.

## Overview

| | |
| --- | --- |
| REST API | `https://api.terra.hackclub.com` |
| Game server | `wss://game.terra.hackclub.com` (Colyseus) |
| Web client | `https://terra.hackclub.com` |
| CORS proxy | `https://terra-api.jollyy.dev` (this repo) |

### Conventions

- Request and response bodies are JSON. The web client sends `Content-Type: application/json` on every request.
- IDs are UUID strings. Timestamps are ISO 8601 strings.
- Errors use a non-2xx status and a body of `{ "error": "<message>" }`. Some errors also include a machine-readable `code` (for example `github_wrong_account`).
- `401 {"error":"No token provided"}` / `401 {"error":"Invalid token"}` mean missing or bad auth. `403` means the account lacks a required role.

### CORS

The API sends `Access-Control-Allow-Origin: https://terra.hackclub.com` regardless of the requesting origin, so browsers on other origins can't read responses. The OAuth endpoints (`/token`, `/register`, `/mcp`) allow `*`. Use the proxy in this repo to call the rest from another origin.

### Rate limits

Responses carry IETF `RateLimit` headers:

```
ratelimit-policy: "5-in-15min"; q=5; w=900, "100-in-1min"; q=100; w=60
ratelimit: "100-in-1min"; r=99; t=60
```

- **All endpoints:** 100 requests per minute.
- **Some auth endpoints (seen on `/auth/guest`):** 5 per 15 minutes.

It isn't known whether the limit is keyed by IP or by user.

## Authentication

Terra uses bearer tokens. Send them as:

```
Authorization: Bearer <token>
```

The token is an HS256 JWT with the claims `userId`, `username`, `tv`, `iat` and `exp`, valid for 7 days. `tv` is likely a token version that `POST /auth/logout-all` bumps to revoke every existing token. The web client stores the token in `localStorage` under `terra_auth_token` and treats it as expired once `exp` has passed.

### Login flow

Login goes through Hack Club Auth (OIDC with PKCE). The API does the OAuth dance itself, so clients only see the start and the end:

1. The browser navigates to `GET /auth/login` (optional query: `ref` for a referral code, `email` to prefill).
2. The API redirects to `https://auth.hackclub.com/oauth/authorize` with scopes `openid profile email slack_id verification_status name birthdate phone address`, and stores the PKCE verifier and state in short-lived `HttpOnly` cookies.
3. Hack Club Auth calls back to `https://api.terra.hackclub.com/auth/callback`.
4. The API redirects to `https://terra.hackclub.com/?code=<code>` (or `?error=<code>`).
5. The client calls `GET /auth/exchange?code=<code>` and receives `{ token, newUser }`.

Because steps 3–4 are fixed to Terra's own domains, third-party apps can't run this flow themselves.

### Guest login

`POST /auth/guest` returns `{ token }` for a throwaway account. It is currently disabled and returns `403 {"error":"Guest login is currently disabled"}`.

### Linking other accounts

To link GitHub, Hackatime, Slack chat or identity verification, the client first calls `POST /auth/link-code` to get `{ code }`. It then opens the API page for that provider in a popup, passing the one-time code as `?code=`. This is needed because a plain browser navigation can't carry the bearer token:

- `/auth/github/login`
- `/auth/hackatime/login`
- `/auth/slack-chat/login`
- `/auth/identity/start`

When the popup finishes, it lands on `/link-done` and posts the result to the opener. A GitHub link that comes back as `?github=pending&pendingId=…` is completed with `POST /auth/github/finalize { pendingId }`.

### OAuth for MCP clients

There is a separate OAuth 2.1 authorization server for MCP clients, described at `GET /.well-known/oauth-authorization-server`:

| Field | Value |
| --- | --- |
| `authorization_endpoint` | `/authorize` |
| `token_endpoint` | `/token` (`client_secret_post` or `none`) |
| `registration_endpoint` | `/register` (dynamic client registration) |
| `revocation_endpoint` | `/revoke` |
| Grants | `authorization_code` (PKCE `S256`), `refresh_token` |
| Scopes | `db:read` |

The MCP endpoint is `/mcp` (POST only; `GET` returns 405). The consent screen in the web client reads `GET /mcp-oauth/requests/:id` and approves or denies with `POST /mcp-oauth/requests/:id/:decision`. It isn't known whether `db:read` tokens work on the REST endpoints below.

## Player endpoints

Endpoints marked **observed** were called with a real account and the response shape below was recorded. Field values are omitted. Shapes use TypeScript-like notation, and `T | null` fields were `null` in the sample, so their non-null type is a guess. Everything else comes from how the web client calls the endpoint.

### Public

#### `GET /public/stats` (observed, no auth)

```ts
{ users: number; projects: number }
```

### Account

#### `GET /auth/me` (observed)

```ts
{
  user: {
    id: string; username: string; email: string; slackId: string;
    displayName: string; profilePictureUrl: string;
    roles: string[];            // e.g. ["reviewer"]
    bannedAt: string | null; isAdmin: boolean;
    yswsEligible: boolean; verificationStatus: string; identityCollected: boolean;
    githubLinked: boolean; githubLogin: string;
    hackatimeLinked: boolean; hackatimeUsername: string;
    addressLinked: boolean; addressCountry: string;
  }
}
```

#### `GET /auth/address` (observed)

```ts
{
  linked: boolean;
  address: { line1: string; line2: string; city: string; state: string; postalCode: string; country: string };
  country: string; city: string;
  supportedRegion: boolean;   // whether hardware rewards ship there
  summary: string;
}
```

#### Other account endpoints

| Method | Path | Body | Notes |
| --- | --- | --- | --- |
| `GET` | `/auth/address/candidates` | | Observed: `{ candidates: [] }`. Addresses on the user's Hack Club Auth account. |
| `POST` | `/auth/address/select` | `{ hackclubAddressId }` | Pick one of the candidates. |
| `GET` | `/auth/address/link` | | Part of address linking; response not recorded. |
| `GET` | `/auth/identity/pending/:pendingId` | | Identity verification in progress. |
| `POST` | `/auth/identity/finalize` | `{ pendingId, addressId }` | |
| `DELETE` | `/auth/github/unlink` | | |
| `DELETE` | `/auth/hackatime/unlink` | | |
| `POST` | `/auth/logout-all` | | Revokes every token for the account. |

### Users

#### `GET /users/:username/profile` (observed)

```ts
{
  username: string; displayName: string; slackId: string;
  coins: number; water: number; friendCount: number;
  projects: { id: string; title: string; repoFullName: string | null; devlogCount: number }[];
  quests: { questId: string; title: string; completed: boolean; totalTasks: number; completedTasks: number }[];
  friends: { username: string; displayName: string }[];
}
```

#### `GET /users/me/display-name` (observed)

```ts
{ displayName: string; canRename: boolean }
```

`PATCH /users/me/display-name` with `{ displayName }` renames the account when `canRename` is true.

#### `GET /users/:username/projects/:projectId/timeline` (observed)

```ts
{
  project: { id: string; title: string; codeUrl: string | null; demoUrl: string | null };
  devlogs: unknown[];
  shipments: unknown[];
}
```

#### `GET /users/by-project/:projectId` (observed)

```ts
{ username: string }
```

### Friends

#### `GET /friends` (observed)

```ts
type Friend = { friendshipId: string; userId: string; username: string; displayName: string; profilePictureUrl: string };
{ accepted: Friend[]; pendingIncoming: Friend[]; pendingOutgoing: Friend[] }
```

| Method | Path | Body |
| --- | --- | --- |
| `POST` | `/friends/request` | `{ toUsername }` |
| `POST` | `/friends/:friendshipId/respond` | `{ action }`, e.g. `"accept"` |
| `DELETE` | `/friends/:id` | Removes a friend or cancels a request. |

### Mail

In-game mail from the Terra team, sometimes with rewards attached.

#### `GET /mail` (observed)

```ts
{
  recipientId: string; messageId: string;
  subject: string; body: string;
  rewards: unknown | null;
  sentAt: string; readAt: string | null; claimedAt: string | null;
  senderName: string | null; createdByUsername: string; createdByDisplayName: string;
  waterExpired: boolean;
}[]
```

#### `GET /mail/unread` (observed)

```ts
{ count: number }
```

| Method | Path | Notes |
| --- | --- | --- |
| `PATCH` | `/mail/:recipientId/read` | Mark as read. |
| `POST` | `/mail/:recipientId/claim` | Claim attached rewards. |

### Referrals

#### `GET /referrals/me` (observed)

```ts
{
  referralCode: string; shareUrl: string;
  counts: { joined_verified: number; week_complete: number };
  milestones: {
    id: string; type: string; threshold: number; coins: number;
    accessoryItemId: string; accessoryName: string; accessorySprite: string; accessoryRarity: string;
    achieved: boolean; claimed: boolean;
  }[];
  referred: unknown[];
}
```

`POST /referrals/claim` with `{ milestoneId }` claims a milestone reward. Referral links take the form `https://terra.hackclub.com/r/:code`.

### Device upgrades

The laptop-reward tech tree.

#### `GET /device-upgrades` (observed)

```ts
{
  devices: {
    id: string; title: string; description: string; category: string;
    root: { x: number; y: number };
    nodes: {
      id: string; title: string; description: string;
      price: number; direction: string; maxPurchases: number | null;
      x: number; y: number;
    }[];
  }[];
  mainDevice: string;
  owned: Record<string, unknown>;
  purchases: unknown[];
  coins: number;
  address: { linked: boolean; country: string; supportedRegion: boolean };
}
```

| Method | Path | Body |
| --- | --- | --- |
| `POST` | `/device-upgrades/select-device` | `{ deviceId }` |
| `POST` | `/device-upgrades/purchase` | `{ nodeId }` |
| `POST` | `/device-upgrades/purchases/:id/refund` | |

### Chat

#### `GET /chat/status` (observed)

```ts
{ access: string; channelUrl: string; channelName: string }
```

#### `GET /chat/emojis?q=<query>` (observed)

```ts
{ emojis: string[] }
```

`POST /chat/consent` records consent to the in-game chat rules. Chat messages themselves go over the game server (see `chat.*` messages below).

### Feedback

#### `GET /feedback/nps` (observed)

```ts
{ due: boolean }
```

`POST /feedback/nps` with `{ rating, feedback }` (`feedback` may be `null`).

### YSWS: weeks

#### `GET /ysws/current-week` (observed)

```ts
{ number: number; label: string; rentRequired: boolean; startDate: string; endDate: string }
```

#### `GET /ysws/week-track` (observed)

The player's week-by-week progress, including rent (required coding hours per week).

```ts
{
  onTrack: boolean; debtOut: boolean;
  rows: {
    number: number; weekKey: string; label: string; startsAt: string; endsAt: string;
    rentWeek: boolean; state: string; hoursSeconds: number;
    projectTitle: string | null; shipState: string;
    shipped: boolean; approved: boolean; seedsClaimed: boolean;
    rentPaid: boolean; rentDueAt: string | null; excuseReason: string | null; rentDebt: number;
  }[];
}
```

#### `GET /ysws/rent-debt-notice` (observed)

```ts
{ notice: unknown | null }
```

`POST /ysws/rent-debt-notice/seen` with `{ weekKey, stage }` dismisses it.

### YSWS: linked services

#### `GET /ysws/services/status` (observed)

```ts
{
  github: { linked: boolean; login: string };
  hackatime: { linked: boolean; username: string; hasApiKey: boolean };
}
```

#### `GET /ysws/github/repos` (observed)

Optional `?q=` search.

```ts
{ fullName: string; name: string; owner: string; description: string }[]
```

`GET /ysws/github/repos/:repo/branches` lists branches.

#### `GET /ysws/hackatime/projects` (observed)

```ts
{ name: string; totalSeconds: number; aiSeconds: number; languages: string[] }[]
```

### YSWS: projects

#### `GET /ysws/projects` (observed)

An array of the user's projects, each shaped like the single-project response below.

#### `GET /ysws/projects/:id` (observed)

```ts
{
  id: string; userId: string; title: string; description: string | null;
  isUpdate: boolean; parentProjectId: string | null; parentProject: unknown | null;
  screenshotUrl: string | null; codeUrl: string | null; demoUrl: string | null;
  repoOwner: string | null; repoName: string | null; repoFullName: string | null; repoId: unknown | null;
  defaultBranch: string | null; lastDevlogHeadSha: string | null;
  hackatimeProjectName: string | null;
  what: unknown | null; madeWith: unknown[];
  weekNumber: number;
  programWeek: { weekKey: string; weekNumber: number; label: string; startDate: string; endDate: string };
  devlogsCloseAt: string;
  createdAt: string; updatedAt: string; deletedAt: string | null;
}
```

#### Other project endpoints

| Method | Path | Body / response |
| --- | --- | --- |
| `POST` | `/ysws/projects` | `{ title, isUpdate, parentProjectId }` |
| `PATCH` | `/ysws/projects/:id` | Partial project fields. |
| `GET` | `/ysws/projects/:id/time` | Observed: `{ totalSeconds: number; linked: boolean }`. Optional `?start_date=`. |
| `GET` | `/ysws/projects/:id/suggest-hackatime` | Observed: `{ suggestion: unknown \| null }` |
| `GET` | `/ysws/projects/:id/commits` | Observed: array (empty in sample). |
| `GET` | `/ysws/projects/:id/reward-estimate` | Observed: `{ water: number; wholeWater: number; time: unknown \| null; totals: { water: number } }` |
| `GET` | `/ysws/projects/:id/devlogs` | Observed: array (empty in sample). |
| `POST` | `/ysws/projects/:id/devlogs` | `{ title, body, commitShas: string[], imageIds: string[] }` |
| — | `/ysws/projects/:id/screenshot` | Screenshot upload URL. Method and encoding not confirmed. |

#### Images

`/upload/image` is the image upload URL used for devlog images. Method and encoding are not confirmed. `DELETE /upload/image?id=<id>` removes an upload.

### YSWS: shipping

| Method | Path | Body / response |
| --- | --- | --- |
| `GET` | `/ysws/projects/:id/ship-check?platforms=<list>` | Pre-ship checks and warnings. |
| `POST` | `/ysws/projects/:id/ship` | `{ notes, aiDeclaration, platforms: string[], acknowledgedWarnings: string[] }` |
| `GET` | `/ysws/projects/:id/shipments` | Observed: array (empty in sample). |
| `GET` | `/ysws/shipments/:id/review` | Review result for a shipment. |
| `POST` | `/ysws/shipments/:id/reship` | `{ notes, aiDeclaration, platforms, screenshotId?, acknowledgedWarnings }` |

### YSWS: community voting

Players vote on other players' shipments. These endpoints were not exercised.

| Method | Path | Body |
| --- | --- | --- |
| `GET` | `/ysws/vote/quota` | |
| `GET` | `/ysws/vote/next` | |
| `POST` | `/ysws/vote/shipment/:shipmentId` | `{ stars, verdict, justification }` |
| `POST` | `/ysws/vote/shipment/:shipmentId/skip` | `{ reason }` |

## Game server

The game world is a [Colyseus](https://colyseus.io) server at `wss://game.terra.hackclub.com`. This section comes from the web client only. Nothing here was sent to the live server.

### Joining

The client joins the `world` room (`world_loadtest` when the page has `?loadtest`) with `joinOrCreate`, or `joinById` when it has a specific room ID. The join options are:

```ts
{
  token: string;          // the same bearer token as the REST API
  levelId: string;        // e.g. "town-square"
  farmOwnerId?: string;   // whose farm to enter; the server rejects farm levels without it (code 4411, "farm_owner_missing")
  fromSessionId?: string; // previous session ID, kept in sessionStorage as terra_session_id
  takeover?: boolean;     // replace an existing session for this account
  protocol: 2;
}
```

The client supports Colyseus reconnection tokens and handles `serverMigrate`, `redirectToLevel` and `sessionKicked` messages by rejoining or leaving.

### Client → server messages

Movement is sent at up to 30 messages per second:

```ts
room.send("move", { x, z, seq, posX, posZ, sprinting });
```

| Message | Payload |
| --- | --- |
| `pongCheck` | `{ id }`, the reply to `pingCheck` |
| `chat.request` | none, requests history |
| `chat.send` | `{ text, channel }` |
| `currency.request`, `inventory.request`, `hud.request`, `market.request`, `quest.requestDefs`, `friend.presence` | `{}` |
| `hud.tipsSeen` | `{ ids }` |
| `tutorial.wakeUpDone`, `tutorial.moveDone` | `{}` |
| `player.setClothesHue` | `{ hue }` |
| `accessory.equip` | `{ itemId }` |
| `accessory.unequip` | `{ subtype }` |
| `useItem` | `{ itemId }` |
| `farm.place` | `{ inventoryItemId }` |
| `farm.interact` | `{ farmItemId }` |
| `farm.pickup` | `{ farmItemId }` |
| `friend.join` | `{ userId }`, to visit a friend |
| `npcInteracted` | `{ npcId }` |
| `npc.getDialogueStart` | `{ npcId, prefetch? }` |
| `npc.dialogueAdvance` | `{ npcId, nodeId }` |
| `npc.openShop`, `npc.openLoans`, `npc.openEncyclopedia`, `npc.giveReward`, `npc.claimWeeklySeeds`, `npc.turnInRent`, `disappear_npc` | `{ npcId, nodeId }` |
| `npc.sellCrops` | `{ npcId, nodeId, selections }` |
| `quest.start` | `{ questId, source }`, where `source` is `{ type: "zone", zoneId }` or `{ type: "npc", npcId, nodeId }` |
| `quest.completeTask` | `{ questId, taskId, source }` |
| `shop.requestStock`, `shop.close` | `{}` |
| `shop.purchase` | `{ stockEntryId, requestId, expectedPriceCoins }` |
| `loan.take` | `{ amountCoins, requestId }` |
| `loan.repay` | `{ requestId }` |
| `loan.close` | `{}` |
| `plotLoan.request` | `{}` |
| `plotLoan.seen` | `{ loanIds }` |

### Server → client messages

Payloads weren't extracted for these.

| Area | Messages |
| --- | --- |
| Session | `joinComplete`, `pingCheck`, `positionCorrection`, `forceTeleport`, `redirectToLevel`, `serverMigrate`, `sessionKicked`, `refreshPrompt` |
| Player | `player.currency`, `inventory.sync`, `accessories.sync`, `hud.state`, `hours.update`, `rentDebt.check` |
| Chat | `chat.access`, `chat.history`, `chat.message`, `chat.edited`, `chat.deleted`, `chat.error` |
| Farm and economy | `farm.notice`, `market.items`, `market.notice`, `market.saleResult`, `shop.stock`, `shop.purchaseResult`, `loan.state`, `loan.result`, `plotLoan.notice`, `ratticus.notice`, `ratticus.rentResult`, `ratticus.seedResult` |
| NPCs and quests | `npc.dialogueStart`, `npc.rewardResult`, `npc.disappeared`, `npc.fadeOut`, `quest.definitions`, `quest.started`, `quest.progress`, `quest.taskCompleted`, `quest.targets`, `objective.update` |
| Friends | `friend.presence`, `friend.joinRoom`, `friend.joinError` |

## How this was gathered

- **Endpoint list, methods and request bodies:** extracted from the public JavaScript that `terra.hackclub.com` serves (built 2026-10-27). The Terra source repository was not consulted.
- **Response shapes for endpoints marked "observed":** recorded by calling them read-only (`GET` only) with a regular player account that has the `reviewer` role. Only field names and types were kept.
- **Everything else is unverified.** No state-changing request was sent, and nothing was sent to the game server. Paths with several plausible parameter names use the name the client uses, which may differ from the server's.
