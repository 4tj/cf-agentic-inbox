// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Compose-time attachment helpers shared by the browser and the Worker.
 *
 * Size budget: Cloudflare Email Service caps an outbound message at 5 MiB
 * (25 MiB is only accepted for verified destinations) and MIME base64 inflates
 * the raw bytes by ~4/3. The caps below keep the encoded message inside that
 * budget with room left for the HTML body, quoted text and headers.
 *
 * See https://developers.cloudflare.com/email-service/examples/email-sending/email-attachments/
 */

/** Largest single file (raw bytes) that may be attached or pasted inline. */
export const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;

/** Largest combined payload (raw bytes) of files plus inline images. */
export const MAX_TOTAL_ATTACHMENT_BYTES = 3.5 * 1024 * 1024;

/** Cloudflare Email Service accepts at most 32 attachment entries. */
export const MAX_ATTACHMENT_COUNT = 20;

export interface OutgoingAttachment {
	/** base64-encoded file bytes, without the `data:` prefix. */
	content: string;
	filename: string;
	type: string;
	disposition: "attachment" | "inline";
	/** Required for `inline`; referenced from the HTML body as `cid:<contentId>`. */
	contentId?: string;
}

const EXTENSION_BY_MIME: Record<string, string> = {
	"image/jpeg": "jpg",
	"image/jpg": "jpg",
	"image/png": "png",
	"image/gif": "gif",
	"image/webp": "webp",
	"image/avif": "avif",
	"image/bmp": "bmp",
	"image/svg+xml": "svg",
	"image/tiff": "tiff",
	"image/heic": "heic",
};

/** File extension to use for an image pasted into the editor. */
export function imageExtensionForMime(mimetype: string): string {
	const mime = mimetype.toLowerCase();
	const known = EXTENSION_BY_MIME[mime];
	if (known) return known;
	const subtype = mime.split("/")[1] ?? "";
	return subtype.replace(/[^a-z0-9]/g, "") || "bin";
}

/** Number of bytes a base64 string decodes to, without decoding it. */
export function base64ByteLength(base64: string): number {
	const clean = base64.replace(/[^A-Za-z0-9+/=]/g, "");
	if (clean.length < 4) return 0;
	const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
	return Math.floor(clean.length / 4) * 3 - padding;
}

// `data:image/png;base64,AAAA` as it appears inside an `src="..."` attribute.
// Stops at the first character that cannot be part of base64, i.e. the closing
// quote, so the match is exactly the URL the browser stored.
function dataImageUrlPattern(): RegExp {
	return /data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})/gi;
}

/**
 * Replace every `data:` image URL in `html` with a `cid:` reference and return
 * the images as inline attachments.
 *
 * Images pasted into the editor live in the document as data URLs so the author
 * can see them. Mail clients handle those poorly (Outlook and Gmail strip them),
 * so on send they become real MIME parts referenced by Content-ID — the same
 * shape inbound mail uses, which is what `rewriteInlineImages` already renders.
 *
 * Identical data URLs collapse onto a single attachment.
 */
export function extractInlineImages(
	html: string,
	makeContentId: () => string,
): { html: string; attachments: OutgoingAttachment[] } {
	if (!html) return { html, attachments: [] };

	const byDataUrl = new Map<string, OutgoingAttachment>();
	const rewritten = html.replace(
		dataImageUrlPattern(),
		(match: string, mime: string, data: string) => {
			let attachment = byDataUrl.get(match);
			if (!attachment) {
				attachment = {
					content: data,
					filename: `image-${byDataUrl.size + 1}.${imageExtensionForMime(mime)}`,
					type: mime.toLowerCase(),
					disposition: "inline",
					contentId: makeContentId(),
				};
				byDataUrl.set(match, attachment);
			}
			return `cid:${attachment.contentId}`;
		},
	);

	return { html: rewritten, attachments: [...byDataUrl.values()] };
}

/** Raw byte total of the distinct `data:` images embedded in `html`. */
export function inlineImageBytes(html: string): number {
	if (!html) return 0;
	const seen = new Set<string>();
	let total = 0;
	for (const match of html.matchAll(dataImageUrlPattern())) {
		const [url, , data] = match;
		if (seen.has(url)) continue;
		seen.add(url);
		total += base64ByteLength(data);
	}
	return total;
}
