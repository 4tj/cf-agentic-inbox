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
		const text = await res.text();
		let data: Partial<CloudflareResponse<T>> = {};
		try {
			data = text ? JSON.parse(text) : {};
		} catch {
			// non-JSON body (e.g. an HTML error page) — keep `data` empty, fall back to `text` below
		}
		if (!res.ok || data.success === false) {
			const msg =
				data.errors?.map((e) => e.message).join("; ") ||
				(text ? text.slice(0, 200) : "") ||
				`Cloudflare API error (${res.status})`;
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
			// Safe to re-run on retry: routing/enable re-adds/locks the same records.
			await cfRequest("POST", `/zones/${zoneId}/email/routing/enable`, {});
		},
		async setCatchAllToWorker(zoneId, workerName) {
			// Safe to re-run on retry: this is a PUT, so it just overwrites the same rule.
			await cfRequest("PUT", `/zones/${zoneId}/email/routing/rules/catch_all`, {
				actions: [{ type: "worker", value: [workerName] }],
				matchers: [{ type: "all" }],
				enabled: true,
				name: "cf-agentic-inbox catch-all",
			});
		},
		async onboardSending(zoneId, domain) {
			// Idempotent: after a partial bind failure the caller retries the whole flow,
			// so skip the POST if this domain is already onboarded for sending. The create
			// response also carries dkim_selector/return_path_domain if a future
			// verification step is ever needed.
			const existing = await cfRequest<{ name: string }[]>("GET", `/zones/${zoneId}/email/sending/subdomains`);
			const list = Array.isArray(existing) ? existing : [];
			if (list.some((s) => s.name === domain)) return;
			await cfRequest("POST", `/zones/${zoneId}/email/sending/subdomains`, { name: domain });
		},
	};
}
