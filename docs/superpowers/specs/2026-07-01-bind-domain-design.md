# Bind Domain — Design Spec

- **Date:** 2026-07-01
- **Status:** Approved (pending implementation plan)
- **Author:** TJ + Claude

## 1. Goal

Add a **Bind Domain** feature to the onboarding page. A second button next to
**New Mailbox** opens a modal that takes a domain name, persists it to a database
(no longer an env var), and **automatically configures Cloudflare Email Service**
for that domain — both **receiving** (Email Routing → this Worker) and **sending**
(Email Sending onboarding) — via the Cloudflare REST API.

## 2. Background — current state

- The app is `cf-agentic-inbox` (Cloudflare Workers + Durable Objects + R2 + Workers AI).
- Available domains are currently sourced from the `DOMAINS` env var, consumed at a
  **single runtime point**: `GET /api/v1/config` in `workers/index.ts:88-93`
  (`env.DOMAINS.split(",")`). The frontend domain dropdown and the
  `${prefix}@${selectedDomain}` address assembly all derive from this endpoint.
- Frontend domain usage lives in `app/routes/home.tsx` (dropdown `:271-291`,
  address assembly `:99`, header list `:158-162`), fetched via
  `app/services/api.ts` `getConfig()` (`:99-100`) with react-query key
  `app/queries/keys.ts:26`.
- Creating a mailbox: `app/queries/mailboxes.ts:27-36` → `api.ts:104-105`
  → `POST /api/v1/mailboxes` (`workers/index.ts:102-117`). The backend does **not**
  use `DOMAINS`; the full address is assembled on the frontend and sent up.
- **Persistence:** no D1. Two stores: R2 bucket `BUCKET` (holds
  `mailboxes/<email>.json`) and per-mailbox Durable Object SQLite. The natural home
  for a global domain list is a single R2 JSON file, mirroring the existing
  `listMailboxes()` pattern (`workers/lib/email-helpers.ts:37-45`).
- **Inbound email path:** Cloudflare Email Routing → Worker `email()` handler
  (`workers/app.ts:113`) → `receiveEmail()` (`workers/index.ts:348`). Today the
  routing → Worker wiring is done manually in the Cloudflare dashboard (per README).
  This feature automates that wiring.
- **API routing:** all business routes are Hono routes in `workers/index.ts`
  (prefix `/api/v1`), mounted at `workers/app.ts:94`. Cloudflare Access JWT auth
  wraps **all** requests at `workers/app.ts:46-81`, so new routes are protected
  automatically with no extra work.
- **Send binding:** `send_email` binding `EMAIL` already exists (`wrangler.jsonc`),
  used via `env.EMAIL.send()`.

## 3. Scope & explicit decisions

- **Auto-configure both receiving and sending** via the Cloudflare REST API.
- **Token is required.** A new `CLOUDFLARE_API_TOKEN` secret must be configured.
  **No compatibility / degradation branches** — if the token is missing or any
  Cloudflare call fails, the bind request returns an error.
- **All-or-nothing bind.** The domain is persisted to R2 **only after** all
  Cloudflare configuration steps succeed. On any failure, nothing is persisted.
- **No migration in code.** `config/domains.json` starts empty (absent → read as
  `[]`). The existing `findmychip.com` value is **not** seeded automatically; the
  user performs a one-time local migration after the feature ships. `GET /api/v1/config`
  stops reading `env.DOMAINS` entirely.
- **Delete does not roll back Cloudflare.** `DELETE` removes the domain from the R2
  list only; it does not disable routing or remove DNS records (avoids breaking live
  mail flow).

### Non-goals

- Seeding/migrating existing `DOMAINS` values (done manually, out of band).
- Any UI or logic to re-verify DNS propagation status over time.
- Rolling back Cloudflare configuration on unbind.
- Per-mailbox or fine-grained domain permissions (Access already gates everything).

## 4. Data model

New R2 object **`config/domains.json`** — a JSON array:

```json
[
  { "domain": "findmychip.com", "zoneId": "<zone_id>", "boundAt": "2026-07-01T..." }
]
```

Because bind is all-or-nothing, every persisted entry is fully configured — no
status enum or half-states are stored.

New helpers in `workers/lib/email-helpers.ts` (style aligned with `listMailboxes`):

- `listDomains(bucket): Promise<DomainEntry[]>` — read + parse, absent → `[]`.
- `addDomain(bucket, entry)` — append (dedupe by `domain`) + write.
- `removeDomain(bucket, domain)` — filter out + write.

## 5. Backend API

All routes added to `workers/index.ts`, protected by the existing Access middleware.

### `GET /api/v1/domains`
Returns `listDomains()`.

### `POST /api/v1/domains`  — bind + auto-configure (all-or-nothing)
Body: `{ domain: string }` (zod-validated domain format).

Steps (abort and return error on the first failure; persist nothing on failure):

1. **Resolve zone** — `GET /zones?name=<domain>` → take `result[0].id`.
   Not found → `400` `"Domain is not a zone in this Cloudflare account"`.
2. **Enable Email Routing** — `POST /zones/{zoneId}/email/routing/enable` (body `{}`).
   Auto-adds and locks the MX + SPF records for receiving.
3. **Catch-all → Worker** — `PUT /zones/{zoneId}/email/routing/rules/catch_all` with
   ```json
   {
     "actions":  [{ "type": "worker", "value": ["<WORKER_NAME>"] }],
     "matchers": [{ "type": "all" }],
     "enabled":  true,
     "name":     "cf-agentic-inbox catch-all"
   }
   ```
   Routes all inbound mail for the domain to this Worker.
4. **Onboard sending** — `POST /zones/{zoneId}/email/sending/subdomains` with
   `{ "name": "<domain>" }`. Enables Email Sending, generates the DKIM key, and
   (for a Cloudflare-managed zone) provisions the `cf-bounce` MX/SPF/DKIM/DMARC records.
5. **Persist** — on all-success, `addDomain(bucket, { domain, zoneId, boundAt })`.

Return the new domain entry. Receiving works immediately; sending works once DNS
propagates (typically 5–15 min for Cloudflare-managed zones).

### `DELETE /api/v1/domains/:domain`
`removeDomain()` only. No Cloudflare rollback.

### `GET /api/v1/config` (modified)
`domains` is now sourced from `listDomains()` (R2). Remove the `env.DOMAINS` read.
`emailAddresses` behavior is unchanged.

### Cloudflare API client

Extract a small injectable `emailServiceClient` (base
`https://api.cloudflare.com/client/v4`, `Authorization: Bearer ${CLOUDFLARE_API_TOKEN}`)
so `fetch` can be mocked in tests. If `CLOUDFLARE_API_TOKEN` is unset, the client
throws immediately (no degradation path).

**Required token scopes:** Zone\:Read, Email Routing\:Edit, DNS\:Edit, Email Sending\:Edit.

## 6. Frontend

`app/routes/home.tsx`:

- Wrap the header actions in `<div className="flex items-center gap-2">` and add a
  `Bind Domain` `Button` (`variant="secondary"`) next to `New Mailbox`
  (`:145-163`).
- Add a Bind Domain `Dialog` — a simplified copy of the Create Mailbox modal
  (`:244-321`): one Kumo `Input` for the domain + submit with loading state and
  `Text variant="error"` for errors.
- On success: toast + `invalidateQueries` for `config` and `domains` so the dropdown
  refreshes immediately. On failure: surface the backend error message verbatim in a
  toast / inline error.

Supporting files:

- `app/queries/domains.ts` — `useDomains()` / `useBindDomain()` (mirror
  `app/queries/mailboxes.ts`).
- `app/services/api.ts` — `listDomains()`, `bindDomain(domain)`, `unbindDomain(domain)`.
- `app/queries/keys.ts` — add a `domains` key.

## 7. Configuration & secrets

- **New secret:** `wrangler secret put CLOUDFLARE_API_TOKEN` (scopes above).
  Document in `.dev.vars.example` (`CLOUDFLARE_API_TOKEN=...` for local dev).
- **New var:** `WORKER_NAME` in `wrangler.jsonc` (default `cf-agentic-inbox`), used
  for the catch-all worker action value.
- **`DOMAINS`:** no longer read by code. Leave the line in `wrangler.jsonc` as a
  reference value for the one-time local migration, annotated as unused.
- **README:** Bind Domain usage; token creation steps; note that inbound routing is
  immediate while sending DNS may take 5–15 min to propagate.

## 8. Error handling

- Invalid domain format → `400` from zod.
- Domain not a zone in the account → `400` with a clear message.
- Missing token or any Cloudflare API non-2xx → surface the Cloudflare error
  message, return an error status, persist nothing.
- Idempotency: `routing/enable` and `sending/subdomains` are safe to re-run, so a
  retry after a partial failure re-applies cleanly.

## 9. Testing

No test framework exists yet; add one (vitest). Focus:

- Pure functions: domain validation; `listDomains/addDomain/removeDomain` R2 read/write
  (absent → `[]`, dedupe, remove).
- `emailServiceClient` with mocked `fetch`: assert each step's request shape, and the
  bind flow's branches — full success (persist happens), zone-not-found, routing enable
  failure, catch-all failure, sending onboard failure, missing token (each: no persist,
  error surfaced).
- `npm run typecheck` must pass.

## 10. Implementation-time verification items

1. **Sending DNS auto-provisioning:** confirm `POST /zones/{zoneId}/email/sending/subdomains`
   auto-writes the `cf-bounce` DNS records for a Cloudflare-managed zone. If it instead
   returns records to add, add them via the DNS API using the response's `dkim_selector`
   / `return_path_domain`, and adjust step 4 accordingly.
2. **Sending name value:** confirm the apex domain (e.g. `findmychip.com`) is accepted as
   `name`, not just a strict subdomain.
3. **Catch-all worker eligibility:** confirm this Worker is a valid Email Routing
   destination for the `worker` action (it already receives mail today via manual
   routing, so it should be eligible; verify the `value` is the Worker script name).

## 11. Files to change

| Layer | File | Change |
|---|---|---|
| Backend read | `workers/index.ts:88-93` | `/api/v1/config` reads R2, not `env.DOMAINS`; add `GET/POST/DELETE /api/v1/domains` |
| Backend helpers | `workers/lib/email-helpers.ts` | add `listDomains/addDomain/removeDomain` |
| Backend CF client | new `workers/lib/email-service-client.ts` | injectable Cloudflare Email Service client |
| Frontend UI | `app/routes/home.tsx:145-163`, `:244-321` | Bind Domain button + modal |
| Frontend API | `app/services/api.ts` | `listDomains/bindDomain/unbindDomain` |
| Frontend hooks | new `app/queries/domains.ts` | `useDomains/useBindDomain` |
| Frontend keys | `app/queries/keys.ts:26` | add `domains` key |
| Config | `wrangler.jsonc`, `.dev.vars.example` | add `WORKER_NAME` var + `CLOUDFLARE_API_TOKEN` secret; annotate `DOMAINS` unused |
| Docs | `README.md` | Bind Domain + token setup + sending propagation note |

Unchanged: `workers/db/schema.ts`, `workers/durableObject/*`, `requireMailbox`,
Access middleware, all `fromDomain` derivation logic.
