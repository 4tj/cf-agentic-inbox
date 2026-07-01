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
		const body = (await res.json()) as { domain: string; zoneId: string };
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
