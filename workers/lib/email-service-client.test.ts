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
		const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ success: true, result: {} }));
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
		const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ success: true, result: {} }));
		const client = createEmailServiceClient("tok", fetchMock as unknown as typeof fetch);
		await client.onboardSending("z", "example.com");
		const url = fetchMock.mock.calls[0][0] as string;
		const opts = fetchMock.mock.calls[0][1] as RequestInit;
		expect(url).toBe("https://api.cloudflare.com/client/v4/zones/z/email/sending/subdomains");
		expect(JSON.parse(opts.body as string)).toEqual({ name: "example.com" });
	});
});
