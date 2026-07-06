// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

export interface ShareLinkRecord {
	mailboxId: string;
	token: string;
	createdAt: string;
	updatedAt: string;
}

interface ShareTokenRecord {
	mailboxId: string;
	token: string;
	createdAt: string;
}

const SHARE_MAILBOX_PREFIX = "share-links/mailboxes";
const SHARE_TOKEN_PREFIX = "share-links/tokens";
const TOKEN_REGEX = /^[A-Za-z0-9_-]{32,128}$/;

function mailboxKey(mailboxId: string): string {
	return `${SHARE_MAILBOX_PREFIX}/${encodeURIComponent(mailboxId.toLowerCase())}.json`;
}

function tokenKey(token: string): string {
	return `${SHARE_TOKEN_PREFIX}/${token}.json`;
}

function isValidShareToken(token: string): boolean {
	return TOKEN_REGEX.test(token);
}

async function readJson<T>(bucket: R2Bucket, key: string): Promise<T | null> {
	const obj = await bucket.get(key);
	if (!obj) return null;
	try {
		return (await obj.json()) as T;
	} catch {
		return null;
	}
}

function generateShareToken(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function getShareLink(
	bucket: R2Bucket,
	mailboxId: string,
): Promise<ShareLinkRecord | null> {
	return readJson<ShareLinkRecord>(bucket, mailboxKey(mailboxId));
}

export async function resetShareLink(
	bucket: R2Bucket,
	mailboxId: string,
	now = new Date().toISOString(),
): Promise<ShareLinkRecord> {
	const existing = await getShareLink(bucket, mailboxId);
	const record: ShareLinkRecord = {
		mailboxId,
		token: generateShareToken(),
		createdAt: existing?.createdAt ?? now,
		updatedAt: now,
	};

	await bucket.put(
		tokenKey(record.token),
		JSON.stringify({
			mailboxId,
			token: record.token,
			createdAt: now,
		} satisfies ShareTokenRecord),
	);
	await bucket.put(mailboxKey(mailboxId), JSON.stringify(record));

	if (existing?.token && existing.token !== record.token) {
		await bucket.delete(tokenKey(existing.token));
	}

	return record;
}

export async function resolveShareToken(
	bucket: R2Bucket,
	token: string,
): Promise<ShareLinkRecord | null> {
	if (!isValidShareToken(token)) return null;

	const tokenRecord = await readJson<ShareTokenRecord>(bucket, tokenKey(token));
	if (!tokenRecord?.mailboxId || tokenRecord.token !== token) return null;

	const current = await getShareLink(bucket, tokenRecord.mailboxId);
	if (!current || current.token !== token) return null;

	return current;
}
