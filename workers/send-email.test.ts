import { describe, expect, it } from "vitest";
import { app } from "./index";

// Env for POST /api/v1/mailboxes/:id/emails: BUCKET.head satisfies
// requireMailbox, MAILBOX resolves to a stub accepting the sent copy, and
// EMAIL.send captures the outgoing message for assertions.
function makeSendEnv(mailboxId: string) {
	const sent: Record<string, unknown>[] = [];
	const created: Record<string, unknown>[] = [];
	const env = {
		BUCKET: {
			async head(key: string) {
				return key === `mailboxes/${mailboxId}.json` ? {} : null;
			},
		},
		MAILBOX: {
			idFromName(name: string) {
				return name;
			},
			get() {
				return {
					async checkSendRateLimit() {
						return null;
					},
					async createEmail(_folder: string, email: Record<string, unknown>) {
						created.push(email);
					},
				};
			},
		},
		EMAIL: {
			async send(message: Record<string, unknown>) {
				sent.push(message);
				return { messageId: "out-1" };
			},
		},
	} as never;
	const waited: Promise<unknown>[] = [];
	const executionCtx = {
		waitUntil(p: Promise<unknown>) {
			waited.push(p);
		},
		passThroughOnException() {},
	} as never;
	const flush = () => Promise.all(waited);
	return { env, executionCtx, sent, created, flush };
}

const MAILBOX = "support@demo.test";

function postEmail(
	ctx: ReturnType<typeof makeSendEnv>,
	body: Record<string, unknown>,
) {
	return app.request(
		`/api/v1/mailboxes/${encodeURIComponent(MAILBOX)}/emails`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				to: "visitor@example.org",
				from: MAILBOX,
				subject: "Re: your message",
				text: "hello",
				...body,
			}),
		},
		ctx.env,
		ctx.executionCtx,
	);
}

describe("POST /api/v1/mailboxes/:mailboxId/emails reply_to", () => {
	it("forwards reply_to to the email service as replyTo", async () => {
		const ctx = makeSendEnv(MAILBOX);
		const res = await postEmail(ctx, { reply_to: "jane@customer.example" });
		expect(res.status).toBe(202);
		await ctx.flush();

		expect(ctx.sent).toHaveLength(1);
		expect(ctx.sent[0].replyTo).toBe("jane@customer.example");

		const rawHeaders = JSON.parse(String(ctx.created[0].raw_headers)) as Array<{
			key: string;
			value: string;
		}>;
		expect(rawHeaders.find((h) => h.key === "reply-to")?.value).toBe(
			"jane@customer.example",
		);
	});

	it("accepts the { email, name } form and omits replyTo when absent", async () => {
		const withName = makeSendEnv(MAILBOX);
		const res = await postEmail(withName, {
			reply_to: { email: "jane@customer.example", name: "Jane Visitor" },
		});
		expect(res.status).toBe(202);
		await withName.flush();
		expect(withName.sent[0].replyTo).toEqual({
			email: "jane@customer.example",
			name: "Jane Visitor",
		});

		const without = makeSendEnv(MAILBOX);
		expect((await postEmail(without, {})).status).toBe(202);
		await without.flush();
		expect(without.sent[0]).not.toHaveProperty("replyTo");
	});
});
