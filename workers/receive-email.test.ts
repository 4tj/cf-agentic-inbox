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
// tests can assert on routing target, delivery folder, and whether the spam
// classifier was consulted.
function makeHarness(opts?: {
	emailAddresses?: string[];
	mailboxExists?: boolean;
	/** When set, only these mailbox addresses exist in R2. */
	mailboxes?: string[];
	/** Verdict the fake spam classifier returns. Defaults to "HAM". */
	spamVerdict?: string;
	/** When true, the AI binding rejects instead of answering. */
	aiFails?: boolean;
}) {
	const calls = {
		createEmail: [] as Array<{ folder: string; data: Record<string, unknown> }>,
		aiRuns: [] as Array<Record<string, unknown>>,
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
	const env = {
		EMAIL_ADDRESSES: opts?.emailAddresses ?? [],
		AI: {
			async run(_model: string, input: Record<string, unknown>) {
				calls.aiRuns.push(input);
				if (opts?.aiFails) throw new Error("AI unavailable");
				return { response: opts?.spamVerdict ?? "HAM" };
			},
		},
		BUCKET: {
			async head(key: string) {
				if (opts?.mailboxExists === false) return null;
				if (!opts?.mailboxes) return {};
				const id = key.replace("mailboxes/", "").replace(".json", "");
				return opts.mailboxes.includes(id) ? {} : null;
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
	};
	return { env, calls };
}

function deliver(
	env: unknown,
	raw: string,
	envelope: { to: string; from: string },
) {
	const { stream, size } = rawStream(raw);
	return receiveEmail(
		{ raw: stream, rawSize: size, to: envelope.to, from: envelope.from } as never,
		env as never,
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
// envelope. Has a valid (non-empty) To: address, so the header heuristic
// does not fire and the classifier decides.
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

// Subaddressed delivery: the envelope (and the To: header) carry a +detail
// local part that no mailbox is named after.
const PLUS_ADDRESSED = [
	"From: Alice <alice@friend.example>",
	"To: me+shop@myinbox.example",
	"Subject: Your order",
	"Date: Wed, 01 Jul 2026 10:00:00 +0000",
	"Message-ID: <order@friend.example>",
	"Content-Type: text/plain; charset=utf-8",
	"",
	"Shipped.",
	"",
].join("\r\n");

describe("receiveEmail", () => {
	it("asks the classifier about an email with no usable To header instead of assuming spam", async () => {
		const { env, calls } = makeHarness();
		await deliver(env, NO_TO_HEADER, { to: "me@myinbox.example", from: "spammer@evil.example" });

		expect(calls.aiRuns).toHaveLength(1);
		expect(calls.createEmail).toHaveLength(1);
		// Default verdict is HAM: a hidden recipient alone must not bury the mail.
		expect(calls.createEmail[0].folder).toBe(Folders.INBOX);
	});

	it("files a hidden-recipient email into Spam only when the classifier says SPAM", async () => {
		const { env, calls } = makeHarness({ spamVerdict: "SPAM" });
		await deliver(env, NO_TO_HEADER, { to: "me@myinbox.example", from: "spammer@evil.example" });

		expect(calls.createEmail).toHaveLength(1);
		expect(calls.createEmail[0].folder).toBe(Folders.SPAM);
	});

	it("marks the recipient as hidden for the classifier when the To: header is unusable", async () => {
		const { env, calls } = makeHarness();
		await deliver(env, NO_TO_HEADER, { to: "me@myinbox.example", from: "spammer@evil.example" });

		const messages = calls.aiRuns[0].messages as Array<{ role: string; content: string }>;
		expect(messages.find((m) => m.role === "user")!.content).toContain("To: (hidden)");
	});

	it("delivers a normal direct email to the Inbox when the classifier says HAM", async () => {
		const { env, calls } = makeHarness();
		await deliver(env, DIRECT, { to: "me@myinbox.example", from: "alice@friend.example" });

		expect(calls.createEmail).toHaveLength(1);
		expect(calls.createEmail[0].folder).toBe(Folders.INBOX);
		expect(calls.aiRuns).toHaveLength(1);
	});

	it("files an email into Spam when the classifier says SPAM", async () => {
		const { env, calls } = makeHarness({ spamVerdict: "SPAM" });
		await deliver(env, DIRECT, { to: "me@myinbox.example", from: "alice@friend.example" });

		expect(calls.createEmail).toHaveLength(1);
		expect(calls.createEmail[0].folder).toBe(Folders.SPAM);
	});

	it("delivers to the Inbox when the classifier errors (fails open)", async () => {
		const { env, calls } = makeHarness({ aiFails: true });
		await deliver(env, DIRECT, { to: "me@myinbox.example", from: "alice@friend.example" });

		expect(calls.createEmail).toHaveLength(1);
		expect(calls.createEmail[0].folder).toBe(Folders.INBOX);
	});

	it("passes the sender, recipient, subject and body to the classifier", async () => {
		const { env, calls } = makeHarness();
		await deliver(env, DIRECT, { to: "me@myinbox.example", from: "alice@friend.example" });

		const messages = calls.aiRuns[0].messages as Array<{ role: string; content: string }>;
		const userContent = messages.find((m) => m.role === "user")!.content;
		expect(userContent).toContain("alice@friend.example");
		expect(userContent).toContain("To: me@myinbox.example");
		expect(userContent).toContain("Lunch?");
		expect(userContent).toContain("Are you free?");
	});

	it("never drafts a reply for an inbound email", async () => {
		// The agent DO is not bound at all in this harness. If receiveEmail still
		// reached for EMAIL_AGENT it would throw, so a clean delivery proves the
		// auto-draft trigger is gone.
		const { env, calls } = makeHarness();
		await deliver(env, DIRECT, { to: "me@myinbox.example", from: "alice@friend.example" });

		expect(calls.createEmail).toHaveLength(1);
		expect(calls.createEmail[0].folder).toBe(Folders.INBOX);
		expect(calls.createEmail.some((c) => c.folder === Folders.DRAFT)).toBe(false);
	});

	it("routes by the envelope recipient, not the To: header address", async () => {
		const { env, calls } = makeHarness();
		await deliver(env, TO_OTHER, { to: "me@myinbox.example", from: "bob@corp.example" });

		expect(calls.mailboxTarget).toBe("me@myinbox.example");
		expect(calls.createEmail[0].folder).toBe(Folders.INBOX);
	});

	describe("subaddressing", () => {
		it("delivers a +detail address into the base mailbox", async () => {
			const { env, calls } = makeHarness({ mailboxes: ["me@myinbox.example"] });
			await deliver(env, PLUS_ADDRESSED, {
				to: "me+shop@myinbox.example",
				from: "alice@friend.example",
			});

			expect(calls.mailboxTarget).toBe("me@myinbox.example");
			expect(calls.createEmail).toHaveLength(1);
			expect(calls.createEmail[0].folder).toBe(Folders.INBOX);
		});

		it("keeps the +detail visible on the stored recipient", async () => {
			const { env, calls } = makeHarness({ mailboxes: ["me@myinbox.example"] });
			await deliver(env, PLUS_ADDRESSED, {
				to: "me+shop@myinbox.example",
				from: "alice@friend.example",
			});

			expect(calls.createEmail[0].data.recipient).toBe("me+shop@myinbox.example");
		});

		it("falls back to the envelope address when the To: header is unusable", async () => {
			const { env, calls } = makeHarness({
				mailboxes: ["me@myinbox.example"],
				spamVerdict: "SPAM",
			});
			await deliver(env, NO_TO_HEADER, {
				to: "me+shop@myinbox.example",
				from: "spammer@evil.example",
			});

			// The stored recipient falls back to the envelope address, but the
			// classifier is still told the visible recipient was hidden.
			expect(calls.createEmail[0].data.recipient).toBe("me+shop@myinbox.example");
			expect(calls.createEmail[0].folder).toBe(Folders.SPAM);
		});

		it("prefers an exact +detail mailbox over the base one", async () => {
			const { env, calls } = makeHarness({
				mailboxes: ["me@myinbox.example", "me+shop@myinbox.example"],
			});
			await deliver(env, PLUS_ADDRESSED, {
				to: "me+shop@myinbox.example",
				from: "alice@friend.example",
			});

			expect(calls.mailboxTarget).toBe("me+shop@myinbox.example");
		});

		it("accepts a +detail address whose base is in EMAIL_ADDRESSES", async () => {
			const { env, calls } = makeHarness({
				emailAddresses: ["me@myinbox.example"],
				mailboxes: ["me@myinbox.example"],
			});
			await deliver(env, PLUS_ADDRESSED, {
				to: "me+shop@myinbox.example",
				from: "alice@friend.example",
			});

			expect(calls.createEmail).toHaveLength(1);
			expect(calls.mailboxTarget).toBe("me@myinbox.example");
		});

		it("still drops a +detail address whose base is not in EMAIL_ADDRESSES", async () => {
			const { env, calls } = makeHarness({
				emailAddresses: ["someone-else@myinbox.example"],
				mailboxes: ["me@myinbox.example"],
			});
			await deliver(env, PLUS_ADDRESSED, {
				to: "me+shop@myinbox.example",
				from: "alice@friend.example",
			});

			expect(calls.createEmail).toHaveLength(0);
		});

		it("drops a +detail address when neither the full address nor its base has a mailbox", async () => {
			const { env, calls } = makeHarness({ mailboxes: ["other@myinbox.example"] });
			await deliver(env, PLUS_ADDRESSED, {
				to: "me+shop@myinbox.example",
				from: "alice@friend.example",
			});

			expect(calls.createEmail).toHaveLength(0);
			expect(calls.aiRuns).toHaveLength(0);
		});
	});
});
