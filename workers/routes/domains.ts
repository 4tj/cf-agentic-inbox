// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../types";
import { isValidDomain, listDomains, removeDomain, saveDomains } from "../lib/domains";
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
		await saveDomains(c.env.BUCKET, [...existing, entry]);
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
