// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, expect, it } from "vitest";
import { sendEmail } from "./email-sender";

function makeBinding() {
	const sent: Record<string, any>[] = [];
	const binding = {
		async send(message: Record<string, any>) {
			sent.push(message);
			return { messageId: "out-1" };
		},
	} as never as SendEmail;
	return { binding, sent };
}

const BASE = {
	to: "someone@example.org",
	from: "support@demo.test",
	subject: "hello",
	text: "hello",
};

// The binding treats a string `content` as the literal file body, so base64
// must be decoded here or the recipient downloads unreadable bytes.
describe("sendEmail attachments", () => {
	it("decodes base64 content into raw bytes", async () => {
		const { binding, sent } = makeBinding();
		await sendEmail(binding, {
			...BASE,
			attachments: [
				{
					content: btoa("id,name\n1,widget"),
					filename: "report.csv",
					type: "text/csv",
					disposition: "attachment",
				},
			],
		});

		const [attachment] = sent[0].attachments;
		expect(attachment.content).toBeInstanceOf(Uint8Array);
		expect(new TextDecoder().decode(attachment.content)).toBe(
			"id,name\n1,widget",
		);
		expect(attachment.filename).toBe("report.csv");
		expect(attachment.disposition).toBe("attachment");
		expect(attachment.contentId).toBeUndefined();
	});

	it("round-trips binary bytes unchanged", async () => {
		const { binding, sent } = makeBinding();
		const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x0d]);
		const base64 = btoa(String.fromCharCode(...bytes));

		await sendEmail(binding, {
			...BASE,
			attachments: [
				{
					content: base64,
					filename: "logo.png",
					type: "image/png",
					disposition: "attachment",
				},
			],
		});

		expect([...sent[0].attachments[0].content]).toEqual([...bytes]);
	});

	it("keeps inline images inline and strips angle brackets from the content id", async () => {
		const { binding, sent } = makeBinding();
		await sendEmail(binding, {
			...BASE,
			html: '<img src="cid:hero">',
			attachments: [
				{
					content: btoa("png"),
					filename: "hero.png",
					type: "image/png",
					disposition: "inline",
					contentId: "<hero>",
				},
			],
		});

		expect(sent[0].attachments[0]).toMatchObject({
			disposition: "inline",
			contentId: "hero",
		});
	});

	it("demotes an inline part with no content id to a normal attachment", async () => {
		const { binding, sent } = makeBinding();
		await sendEmail(binding, {
			...BASE,
			attachments: [
				{
					content: btoa("png"),
					filename: "orphan.png",
					type: "image/png",
					disposition: "inline",
				},
			],
		});

		expect(sent[0].attachments[0].disposition).toBe("attachment");
		expect(sent[0].attachments[0].contentId).toBeUndefined();
	});

	it("omits the attachments field when there are none", async () => {
		const { binding, sent } = makeBinding();
		await sendEmail(binding, { ...BASE, attachments: [] });
		expect(sent[0].attachments).toBeUndefined();
	});
});
