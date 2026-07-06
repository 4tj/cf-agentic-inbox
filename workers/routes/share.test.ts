import { describe, expect, it } from "vitest";
import { Folders } from "../../shared/folders";
import { app } from "../index";
import type { EmailFull } from "../lib/schemas";

const MAILBOX_ID = "me@example.com";
const SHARE_HOST = "sharemail.shopless.pro";

type StoreValue = string;

function fakeBucket(initial: Record<string, StoreValue> = {}) {
	const store = new Map<string, StoreValue>(Object.entries(initial));
	return {
		async get(key: string) {
			const value = store.get(key);
			if (value === undefined) return null;
			return {
				json: async () => JSON.parse(value),
				text: async () => value,
				body: new Response(value).body,
			};
		},
		async head(key: string) {
			return store.has(key) ? {} : null;
		},
		async put(key: string, value: string) {
			store.set(key, value);
		},
		async delete(keyOrKeys: string | string[]) {
			for (const key of Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys]) {
				store.delete(key);
			}
		},
		async list({ prefix }: { prefix?: string } = {}) {
			return {
				objects: [...store.keys()]
					.filter((key) => !prefix || key.startsWith(prefix))
					.map((key) => ({ key })),
			};
		},
	};
}

function email(overrides: Partial<EmailFull>): EmailFull {
	return {
		id: "email",
		subject: "Hello",
		sender: "sender@example.com",
		recipient: MAILBOX_ID,
		date: "2026-07-06T00:00:00.000Z",
		read: false,
		starred: false,
		body: "Body",
		folder_id: Folders.INBOX,
		thread_id: "thread-1",
		attachments: [],
		...overrides,
	};
}

function makeEnv(opts?: { mailboxExists?: boolean }) {
	const inbox = email({
		id: "inbox-1",
		folder_id: Folders.INBOX,
		body: "Inbox body",
		attachments: [
			{ id: "att-inbox", email_id: "inbox-1", filename: "inbox.txt", mimetype: "text/plain", size: 5 },
		],
	});
	const sent = email({
		id: "sent-1",
		folder_id: Folders.SENT,
		sender: MAILBOX_ID,
		recipient: "sender@example.com",
		body: "Sent body",
		attachments: [
			{ id: "att-sent", email_id: "sent-1", filename: "sent.txt", mimetype: "text/plain", size: 4 },
		],
	});
	const draft = email({
		id: "draft-1",
		folder_id: Folders.DRAFT,
		sender: MAILBOX_ID,
		recipient: "sender@example.com",
		body: "Draft body",
		attachments: [
			{ id: "att-draft", email_id: "draft-1", filename: "draft.txt", mimetype: "text/plain", size: 5 },
		],
	});
	const emails = new Map([inbox, sent, draft].map((item) => [item.id, item]));
	const attachments = new Map(
		[inbox, sent, draft].flatMap((item) => (item.attachments ?? []).map((attachment) => [attachment.id, attachment])),
	);
	const bucket = fakeBucket({
		...(opts?.mailboxExists === false
			? {}
			: { [`mailboxes/${MAILBOX_ID}.json`]: JSON.stringify({ fromName: "Shared Inbox" }) }),
		"attachments/inbox-1/att-inbox/inbox.txt": "inbox",
		"attachments/sent-1/att-sent/sent.txt": "sent",
		"attachments/draft-1/att-draft/draft.txt": "draft",
	});
	const stub = {
		async getThreadedEmails({ folder }: { folder?: string }) {
			if (folder !== Folders.INBOX) return [];
			return [
				{
					...inbox,
					snippet: "Inbox body",
					thread_count: 3,
					thread_unread_count: 1,
					participants: "sender@example.com,me@example.com",
				},
			];
		},
		async countThreadedEmails(folder: string) {
			return folder === Folders.INBOX ? 1 : 0;
		},
		async getEmail(id: string) {
			return emails.get(id) ?? null;
		},
		async getThreadEmails(threadId: string) {
			return threadId === "thread-1" ? [inbox, sent, draft] : [];
		},
		async getAttachment(id: string) {
			return attachments.get(id) ?? null;
		},
	};
	const env = {
		BUCKET: bucket,
		SHARE_HOST,
		MAILBOX: {
			idFromName(name: string) {
				return name;
			},
			get() {
				return stub;
			},
		},
	};
	return { env: env as never, bucket, stub };
}

async function resetShare(env: never) {
	const res = await app.request(`/api/v1/mailboxes/${encodeURIComponent(MAILBOX_ID)}/share-link/reset`, {
		method: "POST",
	}, env);
	expect(res.status).toBe(201);
	return (await res.json()) as { token: string; shareUrl: string };
}

describe("share routes", () => {
	it("admin GET returns no link before one is created", async () => {
		const { env } = makeEnv();
		const res = await app.request(`/api/v1/mailboxes/${encodeURIComponent(MAILBOX_ID)}/share-link`, {}, env);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ mailboxId: MAILBOX_ID, shareUrl: null });
	});

	it("admin reset creates a link and old links stop resolving", async () => {
		const { env } = makeEnv();
		const first = await resetShare(env);
		const second = await resetShare(env);

		expect(second.token).not.toBe(first.token);
		expect(second.shareUrl).toBe(`https://${SHARE_HOST}/s/${second.token}`);

		const oldRes = await app.request(`https://${SHARE_HOST}/api/public/share/${first.token}`, {}, env);
		expect(oldRes.status).toBe(404);
	});

	it("admin reset returns 404 when mailbox does not exist", async () => {
		const { env } = makeEnv({ mailboxExists: false });
		const res = await app.request(`/api/v1/mailboxes/${encodeURIComponent(MAILBOX_ID)}/share-link/reset`, {
			method: "POST",
		}, env);
		expect(res.status).toBe(404);
	});

	it("public list is scoped to Inbox", async () => {
		const { env } = makeEnv();
		const { token } = await resetShare(env);
		const res = await app.request(`https://${SHARE_HOST}/api/public/share/${token}/emails?folder=sent`, {}, env);

		expect(res.status).toBe(200);
		const body = (await res.json()) as { emails: Array<{ id: string; folder_id: string; has_draft?: boolean }>; totalCount: number };
		expect(body.totalCount).toBe(1);
		expect(body.emails.map((item) => item.folder_id)).toEqual([Folders.INBOX]);
		expect(body.emails[0].has_draft).toBeUndefined();
	});

	it("public detail rejects non-Inbox emails", async () => {
		const { env } = makeEnv();
		const { token } = await resetShare(env);
		const res = await app.request(`https://${SHARE_HOST}/api/public/share/${token}/emails/sent-1`, {}, env);

		expect(res.status).toBe(404);
	});

	it("public thread requires an Inbox message and excludes drafts", async () => {
		const { env } = makeEnv();
		const { token } = await resetShare(env);
		const res = await app.request(`https://${SHARE_HOST}/api/public/share/${token}/threads/thread-1`, {}, env);

		expect(res.status).toBe(200);
		const body = (await res.json()) as Array<{ id: string }>;
		expect(body.map((item) => item.id)).toEqual(["inbox-1", "sent-1"]);
	});

	it("public attachments follow public email visibility", async () => {
		const { env } = makeEnv();
		const { token } = await resetShare(env);

		const sentRes = await app.request(`https://${SHARE_HOST}/api/public/share/${token}/emails/sent-1/attachments/att-sent`, {}, env);
		expect(sentRes.status).toBe(200);
		expect(await sentRes.text()).toBe("sent");

		const draftRes = await app.request(`https://${SHARE_HOST}/api/public/share/${token}/emails/draft-1/attachments/att-draft`, {}, env);
		expect(draftRes.status).toBe(404);
	});

	it("public APIs are only available on the share host", async () => {
		const { env } = makeEnv();
		const { token } = await resetShare(env);
		const res = await app.request(`https://app.example.com/api/public/share/${token}/emails`, {}, env);

		expect(res.status).toBe(404);
	});
});
