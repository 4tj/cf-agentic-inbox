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
		await addDomain(b, { domain: "a.com", boundAt: "t" });
		expect(await listDomains(b)).toEqual([{ domain: "a.com", boundAt: "t" }]);
	});
	it("dedupes by domain", async () => {
		const b = fakeBucket();
		await addDomain(b, { domain: "a.com", boundAt: "t" });
		await addDomain(b, { domain: "a.com", boundAt: "t2" });
		expect(await listDomains(b)).toHaveLength(1);
	});
	it("removes a domain", async () => {
		const b = fakeBucket(JSON.stringify([{ domain: "a.com", boundAt: "t" }]));
		await removeDomain(b, "a.com");
		expect(await listDomains(b)).toEqual([]);
	});
});
