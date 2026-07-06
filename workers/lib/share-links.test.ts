import { describe, expect, it } from "vitest";
import { getShareLink, resetShareLink, resolveShareToken } from "./share-links";

type Bucket = Parameters<typeof getShareLink>[0];

function fakeBucket() {
	const store = new Map<string, string>();
	return {
		async get(key: string) {
			const value = store.get(key);
			if (value === undefined) return null;
			return { json: async () => JSON.parse(value), text: async () => value };
		},
		async put(key: string, value: string) {
			store.set(key, value);
		},
		async delete(key: string) {
			store.delete(key);
		},
	} as unknown as Bucket;
}

describe("share links", () => {
	it("creates and resolves a share token", async () => {
		const bucket = fakeBucket();
		const record = await resetShareLink(bucket, "me@example.com", "t1");

		expect(record.mailboxId).toBe("me@example.com");
		expect(record.token).toMatch(/^[A-Za-z0-9_-]{32,128}$/);
		expect(await getShareLink(bucket, "me@example.com")).toEqual(record);
		expect(await resolveShareToken(bucket, record.token)).toEqual(record);
	});

	it("invalidates the old token after reset", async () => {
		const bucket = fakeBucket();
		const first = await resetShareLink(bucket, "me@example.com", "t1");
		const second = await resetShareLink(bucket, "me@example.com", "t2");

		expect(second.token).not.toBe(first.token);
		expect(await resolveShareToken(bucket, first.token)).toBeNull();
		expect(await resolveShareToken(bucket, second.token)).toEqual(second);
		expect(second.createdAt).toBe("t1");
		expect(second.updatedAt).toBe("t2");
	});

	it("rejects malformed tokens", async () => {
		const bucket = fakeBucket();
		await resetShareLink(bucket, "me@example.com", "t1");

		expect(await resolveShareToken(bucket, "not a token")).toBeNull();
		expect(await resolveShareToken(bucket, "../bad")).toBeNull();
	});
});
