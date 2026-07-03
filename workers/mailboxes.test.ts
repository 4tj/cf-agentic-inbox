import { describe, expect, it } from "vitest";
import { app } from "./index";

// Minimal env for GET /api/v1/mailboxes: BUCKET.list feeds listMailboxes,
// MAILBOX resolves each mailbox id to a stub whose getInboxUnreadCount
// returns a canned count (or throws, to exercise the failure path).
function makeEnv(mailboxIds: string[], unread: Record<string, number | Error>) {
	return {
		BUCKET: {
			async list() {
				return { objects: mailboxIds.map((id) => ({ key: `mailboxes/${id}.json` })) };
			},
		},
		MAILBOX: {
			idFromName(name: string) {
				return name;
			},
			get(name: string) {
				return {
					async getInboxUnreadCount() {
						const v = unread[name as string];
						if (v instanceof Error) throw v;
						return v ?? 0;
					},
				};
			},
		},
	} as never;
}

describe("GET /api/v1/mailboxes", () => {
	it("includes each mailbox's inbox unread count", async () => {
		const env = makeEnv(["a@x.com", "b@x.com"], { "a@x.com": 3, "b@x.com": 0 });
		const res = await app.request("/api/v1/mailboxes", {}, env);
		expect(res.status).toBe(200);
		const body = (await res.json()) as Array<{ id: string; unreadCount: number }>;
		expect(body).toHaveLength(2);
		expect(body.find((m) => m.id === "a@x.com")?.unreadCount).toBe(3);
		expect(body.find((m) => m.id === "b@x.com")?.unreadCount).toBe(0);
	});

	it("falls back to 0 when a mailbox's DO query fails, without breaking the list", async () => {
		const env = makeEnv(["ok@x.com", "bad@x.com"], {
			"ok@x.com": 5,
			"bad@x.com": new Error("DO unavailable"),
		});
		const res = await app.request("/api/v1/mailboxes", {}, env);
		expect(res.status).toBe(200);
		const body = (await res.json()) as Array<{ id: string; unreadCount: number }>;
		expect(body.find((m) => m.id === "ok@x.com")?.unreadCount).toBe(5);
		expect(body.find((m) => m.id === "bad@x.com")?.unreadCount).toBe(0);
	});
});
