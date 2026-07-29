// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Subaddressing (RFC 5233 "plus addressing") helpers.
 *
 * With subaddressing enabled on the zone, Cloudflare Email Routing matches
 * `user+detail@example.com` against the `user@example.com` rule and hands the
 * Worker the *full* address as the envelope recipient. Mailboxes here are keyed
 * by the plain address, so the `+detail` part has to be stripped before the
 * mailbox is resolved — while staying visible to the user.
 */

export interface ParsedRecipient {
	/** The address as received, lowercased and trimmed. */
	address: string;
	/** The address with any `+detail` removed — the mailbox key. */
	base: string;
	/** The detail after the first `+`, or null when there is none. */
	tag: string | null;
}

export function parseRecipient(raw: string): ParsedRecipient {
	const address = raw.trim().toLowerCase();

	// Split on the last "@" so a quoted local part containing "@" stays intact.
	const at = address.lastIndexOf("@");
	if (at <= 0) return { address, base: address, tag: null };

	const local = address.slice(0, at);
	const domain = address.slice(at + 1);

	const plus = local.indexOf("+");
	// `plus === 0` means the whole local part is a detail with no address in
	// front of it — there is no base mailbox to route to, so leave it alone.
	if (plus <= 0) return { address, base: address, tag: null };

	const detail = local.slice(plus + 1);
	return {
		address,
		base: `${local.slice(0, plus)}@${domain}`,
		// `user+@example.com` still strips down to `user@example.com`, but the
		// empty detail carries no information — report it as absent.
		tag: detail.length > 0 ? detail : null,
	};
}
