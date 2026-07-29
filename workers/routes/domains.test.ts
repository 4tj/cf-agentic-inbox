import { describe, expect, it, vi, afterEach } from "vitest";
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
	return { ok, status, text: async () => JSON.stringify(body) } as unknown as Response;
}

afterEach(() => vi.unstubAllGlobals());

describe("domain routes", () => {
	it("POST binds a domain when all Cloudflare steps succeed", async () => {
		vi.stubGlobal("fetch", vi.fn(async (url: string, _init?: RequestInit) =>
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
		const body = (await res.json()) as { domain: string };
		expect(body.domain).toBe("example.com");
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
		const bucket = fakeBucket(JSON.stringify([{ domain: "a.com", boundAt: "t" }]));
		const res = await domainRoutes.request("/api/v1/domains", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ domain: "a.com" }),
		}, env(bucket));
		expect(res.status).toBe(409);
	});

	it("GET lists bound domains", async () => {
		const bucket = fakeBucket(JSON.stringify([{ domain: "a.com", boundAt: "t" }]));
		const res = await domainRoutes.request("/api/v1/domains", {}, env(bucket));
		expect(await res.json()).toEqual([{ domain: "a.com", boundAt: "t" }]);
	});

	it("DELETE removes a domain", async () => {
		const bucket = fakeBucket(JSON.stringify([{ domain: "a.com", boundAt: "t" }]));
		const res = await domainRoutes.request("/api/v1/domains/a.com", { method: "DELETE" }, env(bucket));
		expect(res.status).toBe(200);
		expect(await (await bucket.get("") as any).json()).toEqual([]);
	});

	it("POST returns 502 and persists nothing when a Cloudflare step fails", async () => {
		vi.stubGlobal("fetch", vi.fn(async (url: string, _init?: RequestInit) =>
			url.includes("/zones?name=")
				? jsonResponse({ success: true, result: [{ id: "z1" }] })
				: jsonResponse({ success: false, errors: [{ code: 1, message: "boom" }] }, false, 400),
		));
		const bucket = fakeBucket();
		const res = await domainRoutes.request("/api/v1/domains", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ domain: "example.com" }),
		}, env(bucket));
		expect(res.status).toBe(502);
		expect(await bucket.get("")).toBeNull(); // nothing written to R2
	});

	it("POST returns 500 and persists nothing when the token is missing", async () => {
		const bucket = fakeBucket();
		const res = await domainRoutes.request("/api/v1/domains", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ domain: "example.com" }),
		}, env(bucket, { CLOUDFLARE_API_TOKEN: "" }));
		expect(res.status).toBe(500);
		expect(await bucket.get("")).toBeNull();
	});

	it("POST turns subaddressing on for the newly bound zone", async () => {
		const fetchMock = vi.fn(async (url: string, _init?: RequestInit) =>
			url.includes("/zones?name=")
				? jsonResponse({ success: true, result: [{ id: "z1" }] })
				: jsonResponse({ success: true, result: { support_subaddress: true } }),
		);
		vi.stubGlobal("fetch", fetchMock);
		const res = await domainRoutes.request("/api/v1/domains", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ domain: "example.com" }),
		}, env(fakeBucket()));
		expect(res.status).toBe(201);
		const patch = fetchMock.mock.calls.find(
			(c) => (c[1] as RequestInit)?.method === "PATCH",
		);
		expect(patch?.[0]).toBe("https://api.cloudflare.com/client/v4/zones/z1/email/routing");
		expect(JSON.parse((patch?.[1] as RequestInit).body as string)).toEqual({ support_subaddress: true });
	});
});

describe("subaddressing routes", () => {
	const bound = () => fakeBucket(JSON.stringify([{ domain: "a.com", boundAt: "t" }]));

	it("GET reports the live Cloudflare state", async () => {
		vi.stubGlobal("fetch", vi.fn(async (url: string, _init?: RequestInit) =>
			url.includes("/zones?name=")
				? jsonResponse({ success: true, result: [{ id: "z1" }] })
				: jsonResponse({ success: true, result: { support_subaddress: true } }),
		));
		const res = await domainRoutes.request("/api/v1/domains/a.com/subaddressing", {}, env(bound()));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ domain: "a.com", enabled: true });
	});

	it("PUT enables subaddressing and echoes Cloudflare's answer", async () => {
		const fetchMock = vi.fn(async (url: string, _init?: RequestInit) =>
			url.includes("/zones?name=")
				? jsonResponse({ success: true, result: [{ id: "z1" }] })
				: jsonResponse({ success: true, result: { support_subaddress: true } }),
		);
		vi.stubGlobal("fetch", fetchMock);
		const res = await domainRoutes.request("/api/v1/domains/a.com/subaddressing", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ enabled: true }),
		}, env(bound()));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ domain: "a.com", enabled: true });
		const patch = fetchMock.mock.calls.find((c) => (c[1] as RequestInit)?.method === "PATCH");
		expect(JSON.parse((patch?.[1] as RequestInit).body as string)).toEqual({ support_subaddress: true });
	});

	it("PUT can turn subaddressing back off", async () => {
		const fetchMock = vi.fn(async (url: string, _init?: RequestInit) =>
			url.includes("/zones?name=")
				? jsonResponse({ success: true, result: [{ id: "z1" }] })
				: jsonResponse({ success: true, result: { support_subaddress: false } }),
		);
		vi.stubGlobal("fetch", fetchMock);
		const res = await domainRoutes.request("/api/v1/domains/a.com/subaddressing", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ enabled: false }),
		}, env(bound()));
		expect(await res.json()).toEqual({ domain: "a.com", enabled: false });
		const patch = fetchMock.mock.calls.find((c) => (c[1] as RequestInit)?.method === "PATCH");
		expect(JSON.parse((patch?.[1] as RequestInit).body as string)).toEqual({ support_subaddress: false });
	});

	it("returns 404 for a domain that is not bound", async () => {
		const res = await domainRoutes.request("/api/v1/domains/other.com/subaddressing", {}, env(bound()));
		expect(res.status).toBe(404);
	});

	it("returns 500 when the token is missing", async () => {
		const res = await domainRoutes.request(
			"/api/v1/domains/a.com/subaddressing",
			{},
			env(bound(), { CLOUDFLARE_API_TOKEN: "" }),
		);
		expect(res.status).toBe(500);
	});

	it("returns 502 when Cloudflare rejects the call", async () => {
		vi.stubGlobal("fetch", vi.fn(async (url: string, _init?: RequestInit) =>
			url.includes("/zones?name=")
				? jsonResponse({ success: true, result: [{ id: "z1" }] })
				: jsonResponse({ success: false, errors: [{ code: 1, message: "boom" }] }, false, 400),
		));
		const res = await domainRoutes.request("/api/v1/domains/a.com/subaddressing", {}, env(bound()));
		expect(res.status).toBe(502);
		expect((await res.json() as { error: string }).error).toMatch(/boom/);
	});
});
