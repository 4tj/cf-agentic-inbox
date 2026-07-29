// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { type Context, Hono } from "hono";
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
		// Off by default on the zone; without it Email Routing never folds
		// `user+detail@` into the `user@` rule this inbox is built around.
		await client.setSubaddressing(zoneId, true);
		await client.onboardSending(zoneId, domain);

		const entry = { domain, boundAt: new Date().toISOString() };
		// addDomain re-reads the list immediately before writing (after the slow CF
		// calls above) so the read-modify-write window stays tight under concurrent
		// binds — do not "optimize" this into a write of the stale `existing` snapshot.
		await addDomain(c.env.BUCKET, entry);
		return c.json(entry, 201);
	} catch (err) {
		const message = err instanceof Error ? err.message : "Failed to configure domain";
		// Log so `wrangler tail` surfaces the failing Cloudflare call + status + code live.
		console.error(`Bind domain failed for ${domain}:`, message);
		return c.json({ error: message }, 502);
	}
});

domainRoutes.delete("/api/v1/domains/:domain", async (c) => {
	const domain = c.req.param("domain").toLowerCase();
	await removeDomain(c.env.BUCKET, domain);
	return c.json({ ok: true });
});

// -- Subaddressing (RFC 5233 plus addressing) ------------------------
//
// The zone-level `support_subaddress` switch is off by default. Binding a
// domain turns it on, but domains bound before this existed still need a way
// to flip it, so it is exposed per domain and read live from Cloudflare
// rather than cached in R2 — the dashboard can change it behind our back.

const SubaddressingBody = z.object({ enabled: z.boolean() });

/** Resolve a bound domain to its zone id + client, or the error response to return. */
async function resolveZone(c: Context<{ Bindings: Env }>, domain: string) {
	const bound = await listDomains(c.env.BUCKET);
	if (!bound.some((d) => d.domain === domain)) {
		return { error: c.json({ error: "Domain is not bound" }, 404) } as const;
	}
	const token = c.env.CLOUDFLARE_API_TOKEN;
	if (!token) return { error: c.json({ error: "CLOUDFLARE_API_TOKEN is not configured" }, 500) } as const;

	const client = createEmailServiceClient(token);
	const zoneId = await client.findZoneId(domain);
	if (!zoneId) {
		return { error: c.json({ error: `${domain} is not a zone in this Cloudflare account` }, 400) } as const;
	}
	return { client, zoneId } as const;
}

domainRoutes.get("/api/v1/domains/:domain/subaddressing", async (c) => {
	const domain = c.req.param("domain").toLowerCase();
	try {
		const resolved = await resolveZone(c, domain);
		if ("error" in resolved) return resolved.error;
		return c.json({ domain, enabled: await resolved.client.getSubaddressing(resolved.zoneId) });
	} catch (err) {
		const message = err instanceof Error ? err.message : "Failed to read subaddressing setting";
		console.error(`Read subaddressing failed for ${domain}:`, message);
		return c.json({ error: message }, 502);
	}
});

domainRoutes.put("/api/v1/domains/:domain/subaddressing", async (c) => {
	const domain = c.req.param("domain").toLowerCase();
	const { enabled } = SubaddressingBody.parse(await c.req.json());
	try {
		const resolved = await resolveZone(c, domain);
		if ("error" in resolved) return resolved.error;
		// Report what Cloudflare echoed back, not what we asked for.
		return c.json({ domain, enabled: await resolved.client.setSubaddressing(resolved.zoneId, enabled) });
	} catch (err) {
		const message = err instanceof Error ? err.message : "Failed to update subaddressing setting";
		console.error(`Update subaddressing failed for ${domain}:`, message);
		return c.json({ error: message }, 502);
	}
});
