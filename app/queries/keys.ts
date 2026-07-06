// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/** Centralised query key factories for cache invalidation. */
export const queryKeys = {
	mailboxes: {
		all: ["mailboxes"] as const,
		detail: (id: string) => ["mailboxes", id] as const,
		shareLink: (id: string) => ["mailboxes", id, "share-link"] as const,
	},
	emails: {
		list: (mailboxId: string, params: Record<string, string>) =>
			["emails", mailboxId, params] as const,
		detail: (mailboxId: string, emailId: string) =>
			["emails", mailboxId, emailId] as const,
		thread: (mailboxId: string, threadId: string) =>
			["emails", mailboxId, "thread", threadId] as const,
	},
	folders: {
		list: (mailboxId: string) => ["folders", mailboxId] as const,
	},
	search: {
		results: (mailboxId: string, query: string, page: number) =>
			["search", mailboxId, query, page] as const,
	},
	publicShare: {
		meta: (token: string) => ["public-share", token, "meta"] as const,
		emails: (token: string, page: number) => ["public-share", token, "emails", page] as const,
		detail: (token: string, emailId: string) =>
			["public-share", token, "emails", emailId] as const,
		thread: (token: string, threadId: string) =>
			["public-share", token, "threads", threadId] as const,
	},
	config: ["config"] as const,
	domains: ["domains"] as const,
};
