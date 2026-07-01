# Bind Domain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Bind Domain button + modal to the onboarding page that persists a domain to R2 and auto-configures Cloudflare Email Service (routing + sending) via the REST API.

**Architecture:** A new R2-backed store (`config/domains.json`) replaces the `DOMAINS` env var as the source of available domains. A new injectable Cloudflare Email Service client performs a 4-step, all-or-nothing configuration on bind (zone lookup → enable routing → catch-all→Worker → onboard sending). New Hono routes under `/api/v1/domains` glue them together; the frontend adds a second header button and a Kumo dialog.

**Tech Stack:** Cloudflare Workers, Hono, Zod, R2, React Router v7, @tanstack/react-query, @cloudflare/kumo, Vitest.

## Global Constraints

- **Token required, no degradation:** `CLOUDFLARE_API_TOKEN` must be set; if missing or any Cloudflare call fails, the bind request returns an error. Do not add fallback/skip branches.
- **All-or-nothing bind:** persist to R2 only after all Cloudflare steps succeed; on any failure persist nothing.
- **No migration in code:** `config/domains.json` starts empty (absent → `[]`). Do not seed from `DOMAINS`.
- **Delete does not roll back Cloudflare** config — R2 removal only.
- **Token scopes:** Zone\:Read, Email Routing\:Edit, DNS\:Edit, Email Sending\:Edit.
- **Style:** tab indentation; add the Apache license header to every new file:
  ```
  // Copyright (c) 2026 Cloudflare, Inc.
  // Licensed under the Apache 2.0 license found in the LICENSE file or at:
  //     https://opensource.org/licenses/Apache-2.0
  ```
- **Cloudflare API base:** `https://api.cloudflare.com/client/v4`; auth header `Authorization: Bearer <token>`.
- **Worker script name:** `cf-agentic-inbox` (from `wrangler.jsonc` `name`).

## File Structure

| File | Responsibility |
|---|---|
| `workers/lib/domains.ts` (new) | `DomainEntry` type, `isValidDomain`, R2 store (`listDomains/addDomain/removeDomain`) |
| `workers/lib/email-service-client.ts` (new) | Injectable Cloudflare Email Service client |
| `workers/routes/domains.ts` (new) | Hono sub-app: `GET/POST/DELETE /api/v1/domains` |
| `workers/index.ts` (modify) | Mount domains sub-app; migrate `/api/v1/config` to R2 |
| `workers/types.ts` (modify) | Add `CLOUDFLARE_API_TOKEN` to `Env` |
| `wrangler.jsonc` (modify) | Add `WORKER_NAME` var; annotate `DOMAINS` as unused |
| `.dev.vars.example` (modify) | Document `CLOUDFLARE_API_TOKEN` |
| `app/services/api.ts` (modify) | `DomainEntry` type + `listDomains/bindDomain/unbindDomain` |
| `app/queries/keys.ts` (modify) | Add `domains` query key |
| `app/queries/domains.ts` (new) | `useDomains/useBindDomain/useUnbindDomain` |
| `app/routes/home.tsx` (modify) | Bind Domain button + dialog |
| `vitest.config.ts` (new) | Vitest config (node env, `workers/**/*.test.ts`) |
| `package.json` (modify) | `vitest` devDep + `test` script |
| `README.md` (modify) | Bind Domain usage + token setup |

**Testing note:** backend logic (Tasks 1-3) is unit-tested with Vitest. Frontend glue (Tasks 5-6) has no automated tests; its "test cycle" is `npm run typecheck` + manual check in `npm run dev`.

---

### Task 1: Domain store & validation + Vitest setup

**Files:**
- Create: `workers/lib/domains.ts`
- Create: `vitest.config.ts`
- Create: `workers/lib/domains.test.ts`
- Modify: `package.json` (scripts + devDependency)

**Interfaces:**
- Produces: `DomainEntry = { domain: string; zoneId: string; boundAt: string }`; `isValidDomain(domain: string): boolean`; `listDomains(bucket): Promise<DomainEntry[]>`; `addDomain(bucket, entry): Promise<void>`; `removeDomain(bucket, domain): Promise<void>`.

- [ ] **Step 1: Install Vitest**

Run: `npm install -D vitest`
Expected: `vitest` added to `devDependencies`.

- [ ] **Step 2: Add the `test` script**

In `package.json` `scripts`, add:
```json
"test": "vitest run",
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["workers/**/*.test.ts"],
	},
});
```

- [ ] **Step 4: Write the failing test** (`workers/lib/domains.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { addDomain, isValidDomain, listDomains, removeDomain } from "./domains";

type Bucket = Parameters<typeof listDomains>[0];

function fakeBucket(initial?: string) {
	let store = initial;
	const bucket = {
		async get(_key: string) {
			if (store === undefined) return null;
			const value = store;
			return { json: async () => JSON.parse(value), text: async () => value };
		},
		async put(_key: string, value: string) {
			store = value;
		},
	};
	return bucket as unknown as Bucket;
}

describe("isValidDomain", () => {
	it("accepts a normal domain", () => expect(isValidDomain("example.com")).toBe(true));
	it("accepts a multi-label subdomain", () => expect(isValidDomain("mail.example.co.uk")).toBe(true));
	it("rejects empty", () => expect(isValidDomain("")).toBe(false));
	it("rejects a bare label", () => expect(isValidDomain("localhost")).toBe(false));
	it("rejects spaces", () => expect(isValidDomain("ex ample.com")).toBe(false));
});

describe("domain store", () => {
	it("returns [] when the file is absent", async () => {
		expect(await listDomains(fakeBucket())).toEqual([]);
	});
	it("adds a domain", async () => {
		const b = fakeBucket();
		await addDomain(b, { domain: "a.com", zoneId: "z1", boundAt: "t" });
		expect(await listDomains(b)).toEqual([{ domain: "a.com", zoneId: "z1", boundAt: "t" }]);
	});
	it("dedupes by domain", async () => {
		const b = fakeBucket();
		await addDomain(b, { domain: "a.com", zoneId: "z1", boundAt: "t" });
		await addDomain(b, { domain: "a.com", zoneId: "z2", boundAt: "t2" });
		expect(await listDomains(b)).toHaveLength(1);
	});
	it("removes a domain", async () => {
		const b = fakeBucket(JSON.stringify([{ domain: "a.com", zoneId: "z1", boundAt: "t" }]));
		await removeDomain(b, "a.com");
		expect(await listDomains(b)).toEqual([]);
	});
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `./domains`.

- [ ] **Step 6: Implement `workers/lib/domains.ts`**

```ts
// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/** Global store for domains bound to this inbox, kept in a single R2 object. */

export interface DomainEntry {
	domain: string;
	zoneId: string;
	boundAt: string;
}

const DOMAINS_KEY = "config/domains.json";
const DOMAIN_REGEX = /^(?=.{1,253}$)([a-z0-9](-?[a-z0-9])*\.)+[a-z]{2,}$/;

export function isValidDomain(domain: string): boolean {
	return DOMAIN_REGEX.test(domain);
}

export async function listDomains(bucket: R2Bucket): Promise<DomainEntry[]> {
	const obj = await bucket.get(DOMAINS_KEY);
	if (!obj) return [];
	try {
		return (await obj.json()) as DomainEntry[];
	} catch {
		return [];
	}
}

export async function addDomain(bucket: R2Bucket, entry: DomainEntry): Promise<void> {
	const domains = await listDomains(bucket);
	if (domains.some((d) => d.domain === entry.domain)) return;
	domains.push(entry);
	await bucket.put(DOMAINS_KEY, JSON.stringify(domains));
}

export async function removeDomain(bucket: R2Bucket, domain: string): Promise<void> {
	const domains = await listDomains(bucket);
	await bucket.put(DOMAINS_KEY, JSON.stringify(domains.filter((d) => d.domain !== domain)));
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npm test`
Expected: PASS (10 tests).

- [ ] **Step 8: Commit**

```bash
git add workers/lib/domains.ts workers/lib/domains.test.ts vitest.config.ts package.json package-lock.json
git commit -m "feat: add R2 domain store, validation, and vitest setup"
```

---

### Task 2: Cloudflare Email Service client

**Files:**
- Create: `workers/lib/email-service-client.ts`
- Create: `workers/lib/email-service-client.test.ts`

**Interfaces:**
- Consumes: nothing from prior tasks.
- Produces: `createEmailServiceClient(token: string, fetchImpl?: typeof fetch): EmailServiceClient` where `EmailServiceClient` has `findZoneId(domain): Promise<string | null>`, `enableRouting(zoneId): Promise<void>`, `setCatchAllToWorker(zoneId, workerName): Promise<void>`, `onboardSending(zoneId, domain): Promise<void>`. Throws on empty token or any non-2xx / `success:false` Cloudflare response.

- [ ] **Step 1: Write the failing test** (`workers/lib/email-service-client.test.ts`)

```ts
import { describe, expect, it, vi } from "vitest";
import { createEmailServiceClient } from "./email-service-client";

function jsonResponse(body: unknown, ok = true, status = 200) {
	return { ok, status, json: async () => body } as unknown as Response;
}

describe("createEmailServiceClient", () => {
	it("throws when the token is empty", () => {
		expect(() => createEmailServiceClient("")).toThrow(/CLOUDFLARE_API_TOKEN/);
	});

	it("findZoneId returns the first matching zone id", async () => {
		const fetchMock = vi.fn(async () => jsonResponse({ success: true, result: [{ id: "zone123" }] }));
		const client = createEmailServiceClient("tok", fetchMock as unknown as typeof fetch);
		expect(await client.findZoneId("example.com")).toBe("zone123");
		expect(fetchMock).toHaveBeenCalledWith(
			"https://api.cloudflare.com/client/v4/zones?name=example.com",
			expect.objectContaining({ method: "GET" }),
		);
	});

	it("findZoneId returns null when no zone matches", async () => {
		const fetchMock = vi.fn(async () => jsonResponse({ success: true, result: [] }));
		const client = createEmailServiceClient("tok", fetchMock as unknown as typeof fetch);
		expect(await client.findZoneId("nope.com")).toBeNull();
	});

	it("throws the Cloudflare error message on failure", async () => {
		const fetchMock = vi.fn(async () => jsonResponse({ success: false, errors: [{ code: 1, message: "boom" }] }, false, 400));
		const client = createEmailServiceClient("tok", fetchMock as unknown as typeof fetch);
		await expect(client.enableRouting("z")).rejects.toThrow("boom");
	});

	it("setCatchAllToWorker PUTs the worker action", async () => {
		const fetchMock = vi.fn(async () => jsonResponse({ success: true, result: {} }));
		const client = createEmailServiceClient("tok", fetchMock as unknown as typeof fetch);
		await client.setCatchAllToWorker("z", "my-worker");
		const opts = fetchMock.mock.calls[0][1] as RequestInit;
		expect(opts.method).toBe("PUT");
		expect(JSON.parse(opts.body as string)).toEqual({
			actions: [{ type: "worker", value: ["my-worker"] }],
			matchers: [{ type: "all" }],
			enabled: true,
			name: "cf-agentic-inbox catch-all",
		});
	});

	it("onboardSending POSTs the domain name to the sending subdomains endpoint", async () => {
		const fetchMock = vi.fn(async () => jsonResponse({ success: true, result: {} }));
		const client = createEmailServiceClient("tok", fetchMock as unknown as typeof fetch);
		await client.onboardSending("z", "example.com");
		const url = fetchMock.mock.calls[0][0] as string;
		const opts = fetchMock.mock.calls[0][1] as RequestInit;
		expect(url).toBe("https://api.cloudflare.com/client/v4/zones/z/email/sending/subdomains");
		expect(JSON.parse(opts.body as string)).toEqual({ name: "example.com" });
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `./email-service-client`.

- [ ] **Step 3: Implement `workers/lib/email-service-client.ts`**

```ts
// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/** Thin, injectable client for the Cloudflare Email Service REST API. */

const CF_API_BASE = "https://api.cloudflare.com/client/v4";

interface CloudflareResponse<T> {
	success: boolean;
	errors?: { code: number; message: string }[];
	result: T;
}

export interface EmailServiceClient {
	findZoneId(domain: string): Promise<string | null>;
	enableRouting(zoneId: string): Promise<void>;
	setCatchAllToWorker(zoneId: string, workerName: string): Promise<void>;
	onboardSending(zoneId: string, domain: string): Promise<void>;
}

export function createEmailServiceClient(
	token: string,
	fetchImpl: typeof fetch = fetch,
): EmailServiceClient {
	if (!token) throw new Error("CLOUDFLARE_API_TOKEN is not configured");

	async function cfRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
		const res = await fetchImpl(`${CF_API_BASE}${path}`, {
			method,
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: body != null ? JSON.stringify(body) : undefined,
		});
		const data = (await res.json().catch(() => ({}))) as Partial<CloudflareResponse<T>>;
		if (!res.ok || data.success === false) {
			const msg = data.errors?.map((e) => e.message).join("; ") || `Cloudflare API error (${res.status})`;
			throw new Error(msg);
		}
		return data.result as T;
	}

	return {
		async findZoneId(domain) {
			const zones = await cfRequest<{ id: string }[]>("GET", `/zones?name=${encodeURIComponent(domain)}`);
			return zones?.[0]?.id ?? null;
		},
		async enableRouting(zoneId) {
			await cfRequest("POST", `/zones/${zoneId}/email/routing/enable`, {});
		},
		async setCatchAllToWorker(zoneId, workerName) {
			await cfRequest("PUT", `/zones/${zoneId}/email/routing/rules/catch_all`, {
				actions: [{ type: "worker", value: [workerName] }],
				matchers: [{ type: "all" }],
				enabled: true,
				name: "cf-agentic-inbox catch-all",
			});
		},
		async onboardSending(zoneId, domain) {
			await cfRequest("POST", `/zones/${zoneId}/email/sending/subdomains`, { name: domain });
		},
	};
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS (all client tests).

- [ ] **Step 5: Commit**

```bash
git add workers/lib/email-service-client.ts workers/lib/email-service-client.test.ts
git commit -m "feat: add Cloudflare Email Service client"
```

---

### Task 3: Domain API routes (isolated sub-app) + config wiring

**Files:**
- Create: `workers/routes/domains.ts`
- Create: `workers/routes/domains.test.ts`
- Modify: `workers/types.ts` (add `CLOUDFLARE_API_TOKEN`)
- Modify: `wrangler.jsonc` (add `WORKER_NAME` var)
- Modify: `.dev.vars.example` (document `CLOUDFLARE_API_TOKEN`)

**Interfaces:**
- Consumes: `listDomains/addDomain/removeDomain/isValidDomain` (Task 1), `createEmailServiceClient` (Task 2).
- Produces: `domainRoutes` — a `Hono<{ Bindings: Env }>` sub-app exposing `GET/POST/DELETE /api/v1/domains`. Env now includes `CLOUDFLARE_API_TOKEN: string` and (via wrangler) `WORKER_NAME: string`.

- [ ] **Step 1: Add `CLOUDFLARE_API_TOKEN` to `Env`** (`workers/types.ts`)

Replace the interface body:
```ts
export interface Env extends Cloudflare.Env {
	POLICY_AUD: string;
	TEAM_DOMAIN: string;
	CLOUDFLARE_API_TOKEN: string;
}
```

- [ ] **Step 2: Add `WORKER_NAME` var** (`wrangler.jsonc`)

In the `vars` object, add `WORKER_NAME` and annotate `DOMAINS`. Keep any existing entries (e.g. `EMAIL_ADDRESSES`). Target state:
```jsonc
	"vars": {
		// DOMAINS is no longer read by the app — domains live in R2 (config/domains.json).
		// Kept only as a reference value for the one-time local migration.
		"DOMAINS": "findmychip.com",
		"EMAIL_ADDRESSES": [],
		// Worker script name, used for the Email Routing catch-all "send to worker" action.
		"WORKER_NAME": "cf-agentic-inbox"
	},
```

- [ ] **Step 3: Document the secret** (`.dev.vars.example`)

Append:
```
# Cloudflare API token for Bind Domain auto-configuration (required).
# Scopes: Zone:Read, Email Routing:Edit, DNS:Edit, Email Sending:Edit.
CLOUDFLARE_API_TOKEN=your-cloudflare-api-token
```

- [ ] **Step 4: Regenerate types**

Run: `npx wrangler types`
Expected: `worker-configuration.d.ts` now contains `WORKER_NAME`.

- [ ] **Step 5: Write the failing test** (`workers/routes/domains.test.ts`)

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { domainRoutes } from "./domains";

type Bucket = { get(k: string): Promise<unknown>; put(k: string, v: string): Promise<void> };

function fakeBucket(initial?: string): Bucket {
	let store = initial;
	return {
		async get() {
			if (store === undefined) return null;
			const value = store;
			return { json: async () => JSON.parse(value), text: async () => value };
		},
		async put(_k: string, value: string) {
			store = value;
		},
	};
}

function env(bucket: Bucket, overrides: Record<string, unknown> = {}) {
	return { BUCKET: bucket, CLOUDFLARE_API_TOKEN: "tok", WORKER_NAME: "cf-agentic-inbox", ...overrides } as never;
}

function jsonResponse(body: unknown, ok = true, status = 200) {
	return { ok, status, json: async () => body } as unknown as Response;
}

afterEach(() => vi.unstubAllGlobals());

describe("domain routes", () => {
	it("POST binds a domain when all Cloudflare steps succeed", async () => {
		vi.stubGlobal("fetch", vi.fn(async (url: string) =>
			url.includes("/zones?name=")
				? jsonResponse({ success: true, result: [{ id: "z1" }] })
				: jsonResponse({ success: true, result: {} }),
		));
		const bucket = fakeBucket();
		const res = await domainRoutes.request("/api/v1/domains", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ domain: "Example.com" }),
		}, env(bucket));
		expect(res.status).toBe(201);
		const body = await res.json();
		expect(body.domain).toBe("example.com");
		expect(body.zoneId).toBe("z1");
		expect((await (await bucket.get("") as any).json())[0].domain).toBe("example.com");
	});

	it("POST returns 400 when the domain is not a zone", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ success: true, result: [] })));
		const res = await domainRoutes.request("/api/v1/domains", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ domain: "nope.com" }),
		}, env(fakeBucket()));
		expect(res.status).toBe(400);
	});

	it("POST returns 400 for an invalid domain", async () => {
		const res = await domainRoutes.request("/api/v1/domains", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ domain: "not a domain" }),
		}, env(fakeBucket()));
		expect(res.status).toBe(400);
	});

	it("POST returns 409 when already bound", async () => {
		const bucket = fakeBucket(JSON.stringify([{ domain: "a.com", zoneId: "z", boundAt: "t" }]));
		const res = await domainRoutes.request("/api/v1/domains", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ domain: "a.com" }),
		}, env(bucket));
		expect(res.status).toBe(409);
	});

	it("GET lists bound domains", async () => {
		const bucket = fakeBucket(JSON.stringify([{ domain: "a.com", zoneId: "z", boundAt: "t" }]));
		const res = await domainRoutes.request("/api/v1/domains", {}, env(bucket));
		expect(await res.json()).toEqual([{ domain: "a.com", zoneId: "z", boundAt: "t" }]);
	});

	it("DELETE removes a domain", async () => {
		const bucket = fakeBucket(JSON.stringify([{ domain: "a.com", zoneId: "z", boundAt: "t" }]));
		const res = await domainRoutes.request("/api/v1/domains/a.com", { method: "DELETE" }, env(bucket));
		expect(res.status).toBe(200);
		expect(await (await bucket.get("") as any).json()).toEqual([]);
	});
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `./domains` route module.

- [ ] **Step 7: Implement `workers/routes/domains.ts`**

```ts
// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../types";
import { addDomain, isValidDomain, listDomains, removeDomain } from "../lib/domains";
import { createEmailServiceClient } from "../lib/email-service-client";

const BindDomainBody = z.object({ domain: z.string().min(1) });

export const domainRoutes = new Hono<{ Bindings: Env }>();

domainRoutes.get("/api/v1/domains", async (c) => {
	return c.json(await listDomains(c.env.BUCKET));
});

domainRoutes.post("/api/v1/domains", async (c) => {
	const { domain: raw } = BindDomainBody.parse(await c.req.json());
	const domain = raw.trim().toLowerCase();
	if (!isValidDomain(domain)) return c.json({ error: "Invalid domain name" }, 400);

	const existing = await listDomains(c.env.BUCKET);
	if (existing.some((d) => d.domain === domain)) {
		return c.json({ error: "Domain already bound" }, 409);
	}

	const token = c.env.CLOUDFLARE_API_TOKEN;
	if (!token) return c.json({ error: "CLOUDFLARE_API_TOKEN is not configured" }, 500);

	const client = createEmailServiceClient(token);
	try {
		const zoneId = await client.findZoneId(domain);
		if (!zoneId) {
			return c.json({ error: `${domain} is not a zone in this Cloudflare account` }, 400);
		}
		await client.enableRouting(zoneId);
		await client.setCatchAllToWorker(zoneId, c.env.WORKER_NAME);
		await client.onboardSending(zoneId, domain);

		const entry = { domain, zoneId, boundAt: new Date().toISOString() };
		await addDomain(c.env.BUCKET, entry);
		return c.json(entry, 201);
	} catch (err) {
		const message = err instanceof Error ? err.message : "Failed to configure domain";
		return c.json({ error: message }, 502);
	}
});

domainRoutes.delete("/api/v1/domains/:domain", async (c) => {
	const domain = c.req.param("domain").toLowerCase();
	await removeDomain(c.env.BUCKET, domain);
	return c.json({ ok: true });
});
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npm test`
Expected: PASS (all domain-route tests).

- [ ] **Step 9: Commit**

```bash
git add workers/routes/domains.ts workers/routes/domains.test.ts workers/types.ts wrangler.jsonc .dev.vars.example worker-configuration.d.ts
git commit -m "feat: add /api/v1/domains routes + WORKER_NAME/CLOUDFLARE_API_TOKEN config"
```

---

### Task 4: Mount routes + migrate `/api/v1/config` to R2

**Files:**
- Modify: `workers/index.ts`

**Interfaces:**
- Consumes: `domainRoutes` (Task 3), `listDomains` (Task 1).

- [ ] **Step 1: Import the new modules** (`workers/index.ts`)

After the existing `email-helpers` import block (around line 17), add:
```ts
import { listDomains } from "./lib/domains";
import { domainRoutes } from "./routes/domains";
```

- [ ] **Step 2: Mount the domain routes**

Immediately after `app.use("/api/v1/mailboxes/:mailboxId/*", requireMailbox);` (line 84), add:
```ts
app.route("/", domainRoutes);
```

- [ ] **Step 3: Migrate the config route to R2**

Replace the existing `/api/v1/config` handler (lines 88-93):
```ts
app.get("/api/v1/config", async (c) => {
	const domains = (await listDomains(c.env.BUCKET)).map((d) => d.domain);
	const emailAddresses = c.env.EMAIL_ADDRESSES ?? [];
	return c.json({ domains, emailAddresses });
});
```

- [ ] **Step 4: Verify types compile**

Run: `npm run typecheck`
Expected: PASS (no errors).

- [ ] **Step 5: Verify existing tests still pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Manual smoke check**

Run: `npm run dev`, then in another shell:
`curl -s http://localhost:5173/api/v1/config` (adjust port if different).
Expected: JSON `{ "domains": [], "emailAddresses": [] }` (empty domains — no migration).
Stop the dev server.

- [ ] **Step 7: Commit**

```bash
git add workers/index.ts
git commit -m "feat: mount domain routes and source config domains from R2"
```

---

### Task 5: Frontend API client + query hooks

**Files:**
- Modify: `app/services/api.ts`
- Modify: `app/queries/keys.ts`
- Create: `app/queries/domains.ts`

**Interfaces:**
- Produces: `DomainEntry` (exported from `~/services/api`); `api.listDomains/bindDomain/unbindDomain`; `useDomains/useBindDomain/useUnbindDomain`; `queryKeys.domains`.

- [ ] **Step 1: Add `DomainEntry` type + API methods** (`app/services/api.ts`)

After the imports (line 5), add the exported type:
```ts
export interface DomainEntry {
	domain: string;
	zoneId: string;
	boundAt: string;
}
```

In the `api` object, after the `getConfig` entry (line 100), add:
```ts
	// Domains
	listDomains: () => get<DomainEntry[]>("/api/v1/domains"),
	bindDomain: (domain: string) => post<DomainEntry>("/api/v1/domains", { domain }),
	unbindDomain: (domain: string) =>
		del<{ ok: boolean }>(`/api/v1/domains/${encodeURIComponent(domain)}`),
```

- [ ] **Step 2: Add the `domains` query key** (`app/queries/keys.ts`)

After `config: ["config"] as const,` (line 26), add:
```ts
	domains: ["domains"] as const,
```

- [ ] **Step 3: Create `app/queries/domains.ts`**

```ts
// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "~/services/api";
import type { DomainEntry } from "~/services/api";
import { queryKeys } from "./keys";

export function useDomains() {
	return useQuery<DomainEntry[]>({
		queryKey: queryKeys.domains,
		queryFn: () => api.listDomains(),
	});
}

export function useBindDomain() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (domain: string) => api.bindDomain(domain),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: queryKeys.domains });
			qc.invalidateQueries({ queryKey: queryKeys.config });
		},
	});
}

export function useUnbindDomain() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (domain: string) => api.unbindDomain(domain),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: queryKeys.domains });
			qc.invalidateQueries({ queryKey: queryKeys.config });
		},
	});
}
```

- [ ] **Step 4: Verify types compile**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/services/api.ts app/queries/keys.ts app/queries/domains.ts
git commit -m "feat: add domains API client and query hooks"
```

---

### Task 6: Bind Domain button + dialog

**Files:**
- Modify: `app/routes/home.tsx`

**Interfaces:**
- Consumes: `useBindDomain` (Task 5).

- [ ] **Step 1: Import the icon and hook** (`app/routes/home.tsx`)

In the `@phosphor-icons/react` import (line 15), add `GlobeIcon`:
```ts
import { EnvelopeIcon, GlobeIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
```

After the `~/queries/keys` import (line 25), add:
```ts
import { useBindDomain } from "~/queries/domains";
```

- [ ] **Step 2: Add bind state + handler**

After `const deleteMailbox = useDeleteMailbox();` (line 35), add:
```ts
	const bindDomain = useBindDomain();
```

After the `isDeleting` state (line 57), add:
```ts
	const [isBindOpen, setIsBindOpen] = useState(false);
	const [newDomain, setNewDomain] = useState("");
	const [isBinding, setIsBinding] = useState(false);
	const [bindError, setBindError] = useState<string | null>(null);
```

After `handleDelete` (line 129), add:
```ts
	const handleBind = async (e: FormEvent) => {
		e.preventDefault();
		setBindError(null);
		const domain = newDomain.trim().toLowerCase();
		if (!domain) {
			setBindError("Please enter a domain");
			return;
		}
		setIsBinding(true);
		try {
			await bindDomain.mutateAsync(domain);
			toastManager.add({ title: `Domain ${domain} bound successfully!` });
			setIsBindOpen(false);
			setNewDomain("");
		} catch (err: unknown) {
			const message = (err instanceof Error ? err.message : null) || "Failed to bind domain";
			setBindError(message);
		} finally {
			setIsBinding(false);
		}
	};
```

- [ ] **Step 3: Add the Bind Domain button to the header**

Replace the header actions block (lines 146-157) so the buttons share a flex row and Bind Domain is always visible:
```tsx
					<div className="flex items-center justify-between">
						<h1 className="text-2xl font-bold text-kumo-default">Mailboxes</h1>
						<div className="flex items-center gap-2">
							<Button
								variant="secondary"
								icon={<GlobeIcon size={16} />}
								onClick={() => setIsBindOpen(true)}
							>
								Bind Domain
							</Button>
							{!isConfigured && (
								<Button
									variant="primary"
									icon={<PlusIcon size={16} />}
									onClick={() => setIsCreateOpen(true)}
								>
									New Mailbox
								</Button>
							)}
						</div>
					</div>
```

- [ ] **Step 4: Add the Bind Domain dialog**

Immediately before the `{/* Delete Dialog */}` comment (line 323), add:
```tsx
			{/* Bind Domain Dialog */}
			<Dialog.Root open={isBindOpen} onOpenChange={setIsBindOpen}>
				<Dialog size="sm" className="p-6">
					<Dialog.Title className="text-base font-semibold mb-2">
						Bind Domain
					</Dialog.Title>
					<Dialog.Description className="text-kumo-subtle text-sm mb-5">
						Enter a domain in your Cloudflare account. Email Routing and Sending
						will be configured automatically.
					</Dialog.Description>
					<form onSubmit={handleBind} className="space-y-4">
						{bindError && (
							<Text variant="error" size="sm">
								{bindError}
							</Text>
						)}
						<Input
							label="Domain"
							placeholder="example.com"
							size="sm"
							value={newDomain}
							onChange={(e) => setNewDomain(e.target.value)}
							required
						/>
						<div className="flex justify-end gap-2 pt-2">
							<Dialog.Close
								render={(props) => (
									<Button {...props} variant="secondary" size="sm">
										Cancel
									</Button>
								)}
							/>
							<Button type="submit" variant="primary" size="sm" loading={isBinding}>
								Bind
							</Button>
						</div>
					</form>
				</Dialog>
			</Dialog.Root>
```

- [ ] **Step 5: Verify types compile**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Manual check**

Run: `npm run dev`. Open the app; confirm a **Bind Domain** button appears next to the Mailboxes heading, clicking it opens the dialog, and submitting an invalid domain shows an inline error. Stop the dev server.

- [ ] **Step 7: Commit**

```bash
git add app/routes/home.tsx
git commit -m "feat: add Bind Domain button and dialog to onboarding page"
```

---

### Task 7: Documentation + final verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document the feature** (`README.md`)

In the `### Configuration` section (after the R2 bucket step), add:
```markdown
3. Create a Cloudflare API token with **Zone:Read**, **Email Routing:Edit**,
   **DNS:Edit**, and **Email Sending:Edit**, then set it as a secret:
   `wrangler secret put CLOUDFLARE_API_TOKEN`
   (for local dev, put `CLOUDFLARE_API_TOKEN=...` in `.dev.vars`).

### Binding a domain

Use the **Bind Domain** button on the home page (next to New Mailbox) to add a
domain that is already in your Cloudflare account. The app automatically enables
Email Routing (with a catch-all rule to this Worker) and onboards the domain for
Email Sending. Inbound routing works immediately; sending DNS records may take
5–15 minutes to propagate for Cloudflare-managed zones. Domains are stored in R2
(`config/domains.json`), not in the `DOMAINS` var.
```

- [ ] **Step 2: Full verification**

Run: `npm test`
Expected: PASS (all backend tests).

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run build`
Expected: build completes with no errors.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document Bind Domain and CLOUDFLARE_API_TOKEN setup"
```

---

## Self-Review

**Spec coverage:**
- R2 store `config/domains.json` → Task 1. ✅
- `listDomains/addDomain/removeDomain` → Task 1. ✅
- 4-step all-or-nothing bind (zone → routing enable → catch-all→worker → sending onboard) → Tasks 2 (client) + 3 (route). ✅
- Token required, no degradation → Task 3 (500 on missing token; 502 on CF error; nothing persisted). ✅
- `GET/DELETE /api/v1/domains`, delete no rollback → Task 3. ✅
- `/api/v1/config` reads R2, drops `env.DOMAINS` → Task 4. ✅
- No migration (empty → `[]`) → Task 1 `listDomains`; verified in Task 4 Step 6. ✅
- `CLOUDFLARE_API_TOKEN` secret + `WORKER_NAME` var + `DOMAINS` annotated → Task 3. ✅
- Frontend button + dialog + hooks → Tasks 5-6. ✅
- Injectable client for tests → Task 2. ✅
- README + token scopes → Task 7. ✅

**Placeholder scan:** No TBD/TODO; every code step has complete code and exact commands. ✅

**Type consistency:** `DomainEntry {domain, zoneId, boundAt}` identical in `workers/lib/domains.ts` and `app/services/api.ts`; `createEmailServiceClient` signature and method names (`findZoneId/enableRouting/setCatchAllToWorker/onboardSending`) match between Task 2 definition and Task 3 usage; `queryKeys.domains` defined (Task 5 Step 2) before use (Task 5 Step 3). ✅

**Implementation-time verification (from spec §10):** during Task 3 manual/live testing, confirm `POST /zones/{zoneId}/email/sending/subdomains` auto-provisions the `cf-bounce` DNS records for a Cloudflare-managed zone (and that the apex domain is accepted as `name`). If it returns records instead of writing them, extend `onboardSending` to add them via the DNS API using the response `dkim_selector`/`return_path_domain`. Confirm the catch-all `worker` action value is the Worker script name.
