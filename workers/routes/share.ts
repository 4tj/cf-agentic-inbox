// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Hono, type Context } from "hono";
import { Folders } from "../../shared/folders";
import { getMailboxStub } from "../lib/email-helpers";
import { requireMailbox, type MailboxContext } from "../lib/mailbox";
import { buildShareUrl, isPublicShareRequestUrl } from "../lib/share-host";
import {
	getShareLink,
	resetShareLink,
	resolveShareToken,
} from "../lib/share-links";
import type { EmailFull } from "../lib/schemas";
import type { Env } from "../types";

type ShareContext = MailboxContext;
type PublicContext = Context<ShareContext>;

export const shareRoutes = new Hono<ShareContext>();

function intQuery(c: PublicContext, key: string): number | undefined {
	const value = c.req.query(key);
	if (!value) return undefined;
	const parsed = Number(value);
	return Number.isNaN(parsed) ? undefined : parsed;
}

function toShareResponse(record: Awaited<ReturnType<typeof resetShareLink>>, env: Env) {
	return {
		mailboxId: record.mailboxId,
		token: record.token,
		shareUrl: buildShareUrl(record.token, env),
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
	};
}

async function resolvePublicShare(c: PublicContext) {
	if (!isPublicShareRequestUrl(c.req.raw, c.env, { allowLocalDevelopment: import.meta.env.DEV })) {
		return null;
	}
	const token = c.req.param("token") || "";
	const record = await resolveShareToken(c.env.BUCKET, token);
	if (!record) return null;
	return {
		record,
		stub: getMailboxStub(c.env, record.mailboxId),
	};
}

function isDraft(email: { folder_id?: string | null }) {
	return email.folder_id === Folders.DRAFT;
}

function hasInboxMessage(emails: Array<{ folder_id?: string | null }>) {
	return emails.some((email) => email.folder_id === Folders.INBOX);
}

function toPublicEmail(email: Record<string, any>) {
	const { has_draft, needs_reply, raw_headers, attachments, ...rest } = email;
	return {
		...rest,
		attachments: Array.isArray(attachments)
			? attachments.map(({ email_id, ...attachment }) => attachment)
			: attachments,
	};
}

async function isPublicVisibleEmail(
	stub: ReturnType<typeof getMailboxStub>,
	email: EmailFull,
): Promise<boolean> {
	if (email.folder_id === Folders.INBOX) return true;
	if (!email.thread_id || isDraft(email)) return false;

	const thread = (await (stub as any).getThreadEmails(email.thread_id)) as EmailFull[];
	return hasInboxMessage(thread);
}

shareRoutes.use("/api/v1/mailboxes/:mailboxId/share-link/*", requireMailbox);
shareRoutes.use("/api/v1/mailboxes/:mailboxId/share-link", requireMailbox);

shareRoutes.get("/api/v1/mailboxes/:mailboxId/share-link", async (c) => {
	const mailboxId = c.req.param("mailboxId")!;
	const record = await getShareLink(c.env.BUCKET, mailboxId);
	return c.json(record ? toShareResponse(record, c.env) : { mailboxId, shareUrl: null });
});

shareRoutes.post("/api/v1/mailboxes/:mailboxId/share-link/reset", async (c) => {
	const mailboxId = c.req.param("mailboxId")!;
	const record = await resetShareLink(c.env.BUCKET, mailboxId);
	return c.json(toShareResponse(record, c.env), 201);
});

shareRoutes.get("/api/public/share/:token", async (c) => {
	const share = await resolvePublicShare(c);
	if (!share) return c.json({ error: "Not found" }, 404);

	const obj = await c.env.BUCKET.get(`mailboxes/${share.record.mailboxId}.json`);
	if (!obj) return c.json({ error: "Not found" }, 404);
	const settings = (await obj.json().catch(() => ({}))) as { fromName?: string };
	const localPart = share.record.mailboxId.split("@")[0] || share.record.mailboxId;

	return c.json({
		mailbox: {
			id: share.record.mailboxId,
			email: share.record.mailboxId,
			name: settings.fromName || localPart,
		},
	});
});

shareRoutes.get("/api/public/share/:token/emails", async (c) => {
	const share = await resolvePublicShare(c);
	if (!share) return c.json({ error: "Not found" }, 404);

	const page = intQuery(c, "page");
	const limit = intQuery(c, "limit");
	const emails = await (share.stub as any).getThreadedEmails({
		folder: Folders.INBOX,
		page,
		limit,
	});
	const totalCount = await (share.stub as any).countThreadedEmails(Folders.INBOX);
	return c.json({ emails: emails.map(toPublicEmail), totalCount });
});

shareRoutes.get("/api/public/share/:token/threads/:threadId", async (c) => {
	const share = await resolvePublicShare(c);
	if (!share) return c.json({ error: "Not found" }, 404);

	const thread = (await (share.stub as any).getThreadEmails(c.req.param("threadId")!)) as EmailFull[];
	if (!hasInboxMessage(thread)) return c.json({ error: "Not found" }, 404);

	return c.json(thread.filter((email) => !isDraft(email)).map(toPublicEmail));
});

shareRoutes.get("/api/public/share/:token/emails/:emailId/attachments/:attachmentId", async (c) => {
	const share = await resolvePublicShare(c);
	if (!share) return c.json({ error: "Not found" }, 404);

	const emailId = c.req.param("emailId")!;
	const attachmentId = c.req.param("attachmentId")!;
	const email = (await share.stub.getEmail(emailId)) as EmailFull | null;
	if (!email || !(await isPublicVisibleEmail(share.stub, email))) {
		return c.json({ error: "Not found" }, 404);
	}

	const attachment = await share.stub.getAttachment(attachmentId);
	if (!attachment || attachment.email_id !== emailId) {
		return c.json({ error: "Attachment not found" }, 404);
	}

	const obj = await c.env.BUCKET.get(`attachments/${emailId}/${attachmentId}/${attachment.filename}`);
	if (!obj) return c.json({ error: "Attachment file not found" }, 404);

	const headers = new Headers();
	headers.set("Content-Type", attachment.mimetype);
	const sanitized = attachment.filename.replace(/[\x00-\x1f"\\]/g, "_");
	headers.set("Content-Disposition", `attachment; filename="${sanitized}"; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`);
	return new Response(obj.body, { headers });
});

shareRoutes.get("/api/public/share/:token/emails/:emailId", async (c) => {
	const share = await resolvePublicShare(c);
	if (!share) return c.json({ error: "Not found" }, 404);

	const email = await share.stub.getEmail(c.req.param("emailId")!);
	if (!email || email.folder_id !== Folders.INBOX) {
		return c.json({ error: "Not found" }, 404);
	}
	return c.json(toPublicEmail(email as Record<string, any>));
});
