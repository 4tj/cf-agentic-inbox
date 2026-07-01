import { describe, expect, it } from "vitest";
import { receiveEmail } from "./index";
import { Folders } from "../shared/folders";

// Build a ReadableStream + byte size from a raw RFC822 string, mimicking the
// `event.raw` / `event.rawSize` pair Cloudflare hands the email() handler.
function rawStream(text: string) {
	const bytes = new TextEncoder().encode(text);
	const stream = new ReadableStream<Uint8Array>({
		start(c) {
			c.enqueue(bytes);
			c.close();
		},
	});
	return { stream, size: bytes.byteLength };
}

// A minimal fake of the Worker environment. Only the bindings receiveEmail
// actually touches are stubbed; each stub records what it was asked to do so
// tests can assert on routing target, delivery folder, and whether the agent
// was triggered.
function makeHarness(opts?: { emailAddresses?: string[]; mailboxExists?: boolean }) {
	const calls = {
		createEmail: [] as Array<{ folder: string; data: Record<string, unknown> }>,
		agentFetch: 0,
		mailboxTarget: "",
	};
	const stub = {
		async findThreadBySubject() {
			return null;
		},
		async createEmail(folder: string, data: Record<string, unknown>) {
			calls.createEmail.push({ folder, data });
		},
	};
	const waits: Promise<unknown>[] = [];
	const env = {
		EMAIL_ADDRESSES: opts?.emailAddresses ?? [],
		AUTO_DRAFT_ENABLED: "true",
		BUCKET: {
			async head() {
				return opts?.mailboxExists === false ? null : {};
			},
			async put() {},
		},
		MAILBOX: {
			idFromName(name: string) {
				calls.mailboxTarget = name;
				return name;
			},
			get() {
				return stub;
			},
		},
		EMAIL_AGENT: {
			idFromName(name: string) {
				return name;
			},
			get() {
				return {
					fetch() {
						calls.agentFetch++;
						return Promise.resolve(new Response("ok"));
					},
				};
			},
		},
	};
	const ctx = {
		waitUntil(p: Promise<unknown>) {
			waits.push(p);
		},
	};
	return { env, ctx, calls, settle: () => Promise.allSettled(waits) };
}

function deliver(
	env: unknown,
	ctx: unknown,
	raw: string,
	envelope: { to: string; from: string },
) {
	const { stream, size } = rawStream(raw);
	return receiveEmail(
		{ raw: stream, rawSize: size, to: envelope.to, from: envelope.from } as never,
		env as never,
		ctx as never,
	);
}

// Hidden / Bcc-style delivery: envelope RCPT TO targets our mailbox, but the
// visible To: header is absent. This is the spam shape seen in the wild.
const NO_TO_HEADER = [
	"From: spammer@evil.example",
	"Subject: You won a prize",
	"Date: Wed, 01 Jul 2026 10:00:00 +0000",
	"Message-ID: <promo-1@evil.example>",
	"Content-Type: text/plain; charset=utf-8",
	"",
	"Click here to claim.",
	"",
].join("\r\n");

// Ordinary direct email: To: header names our mailbox.
const DIRECT = [
	"From: Alice <alice@friend.example>",
	"To: me@myinbox.example",
	"Subject: Lunch?",
	"Date: Wed, 01 Jul 2026 10:00:00 +0000",
	"Message-ID: <abc@friend.example>",
	"Content-Type: text/plain; charset=utf-8",
	"",
	"Are you free?",
	"",
].join("\r\n");

// Legitimate Bcc: To: header names someone else, we received it via the
// envelope. Has a valid (non-empty) To: address, so it is not spam.
const TO_OTHER = [
	"From: Bob <bob@corp.example>",
	"To: team@corp.example",
	"Subject: FYI",
	"Date: Wed, 01 Jul 2026 10:00:00 +0000",
	"Message-ID: <fyi@corp.example>",
	"Content-Type: text/plain; charset=utf-8",
	"",
	"Please review.",
	"",
].join("\r\n");

describe("receiveEmail", () => {
	it("files an email with no usable To header into Spam and skips auto-draft", async () => {
		const { env, ctx, calls, settle } = makeHarness();
		await deliver(env, ctx, NO_TO_HEADER, { to: "me@myinbox.example", from: "spammer@evil.example" });
		await settle();

		expect(calls.createEmail).toHaveLength(1);
		expect(calls.createEmail[0].folder).toBe(Folders.SPAM);
		expect(calls.agentFetch).toBe(0);
	});

	it("delivers a normal direct email to the Inbox and triggers auto-draft", async () => {
		const { env, ctx, calls, settle } = makeHarness();
		await deliver(env, ctx, DIRECT, { to: "me@myinbox.example", from: "alice@friend.example" });
		await settle();

		expect(calls.createEmail).toHaveLength(1);
		expect(calls.createEmail[0].folder).toBe(Folders.INBOX);
		expect(calls.agentFetch).toBe(1);
	});

	it("routes by the envelope recipient, not the To: header address", async () => {
		const { env, ctx, calls, settle } = makeHarness();
		await deliver(env, ctx, TO_OTHER, { to: "me@myinbox.example", from: "bob@corp.example" });
		await settle();

		expect(calls.mailboxTarget).toBe("me@myinbox.example");
		expect(calls.createEmail[0].folder).toBe(Folders.INBOX);
	});
});
