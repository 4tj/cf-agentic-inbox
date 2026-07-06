import { describe, expect, it } from "vitest";
import { isPublicShareRequestUrl } from "./share-host";

const env = { SHARE_HOST: "sharemail.shopless.pro" };

describe("isPublicShareRequestUrl", () => {
	it("allows public share pages and APIs on the share host", () => {
		expect(isPublicShareRequestUrl("https://sharemail.shopless.pro/s/tok", env)).toBe(true);
		expect(isPublicShareRequestUrl("https://sharemail.shopless.pro/api/public/share/tok", env)).toBe(true);
	});

	it("allows assets needed by the public share page on the share host", () => {
		expect(isPublicShareRequestUrl("https://sharemail.shopless.pro/assets/app.js", env)).toBe(true);
		expect(isPublicShareRequestUrl("https://sharemail.shopless.pro/favicon.svg", env)).toBe(true);
	});

	it("does not allow private app paths on the share host", () => {
		expect(isPublicShareRequestUrl("https://sharemail.shopless.pro/mailbox/me@example.com", env)).toBe(false);
		expect(isPublicShareRequestUrl("https://sharemail.shopless.pro/api/v1/mailboxes", env)).toBe(false);
	});

	it("does not allow public share paths on another host", () => {
		expect(isPublicShareRequestUrl("https://inbox.example.com/s/tok", env)).toBe(false);
		expect(isPublicShareRequestUrl("https://inbox.example.com/api/public/share/tok", env)).toBe(false);
	});
});
