import { describe, expect, it } from "vitest";
import { parseRecipient } from "./subaddress";

describe("parseRecipient", () => {
	it("returns a plain address unchanged with no tag", () => {
		expect(parseRecipient("me@example.com")).toEqual({
			address: "me@example.com",
			base: "me@example.com",
			tag: null,
		});
	});

	it("splits the detail off a plus address", () => {
		expect(parseRecipient("me+shop@example.com")).toEqual({
			address: "me+shop@example.com",
			base: "me@example.com",
			tag: "shop",
		});
	});

	it("lowercases and trims the address", () => {
		expect(parseRecipient("  Me+Newsletter@Example.COM ")).toEqual({
			address: "me+newsletter@example.com",
			base: "me@example.com",
			tag: "newsletter",
		});
	});

	it("keeps everything after the first plus as the tag", () => {
		expect(parseRecipient("me+a+b@example.com").tag).toBe("a+b");
		expect(parseRecipient("me+a+b@example.com").base).toBe("me@example.com");
	});

	it("strips an empty detail but reports no tag", () => {
		expect(parseRecipient("me+@example.com")).toEqual({
			address: "me+@example.com",
			base: "me@example.com",
			tag: null,
		});
	});

	it("leaves an address whose local part is only a detail alone", () => {
		expect(parseRecipient("+detail@example.com")).toEqual({
			address: "+detail@example.com",
			base: "+detail@example.com",
			tag: null,
		});
	});

	it("ignores a plus in the domain", () => {
		expect(parseRecipient("me@ex+ample.com")).toEqual({
			address: "me@ex+ample.com",
			base: "me@ex+ample.com",
			tag: null,
		});
	});

	it("does not choke on an address with no @", () => {
		expect(parseRecipient("garbage")).toEqual({
			address: "garbage",
			base: "garbage",
			tag: null,
		});
	});
});
