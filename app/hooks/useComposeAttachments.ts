// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useCallback, useMemo, useRef, useState } from "react";
import {
	MAX_ATTACHMENT_BYTES,
	MAX_ATTACHMENT_COUNT,
	MAX_TOTAL_ATTACHMENT_BYTES,
} from "shared/compose-attachments";
import { formatBytes } from "~/lib/utils";

export interface ComposeAttachment {
	/** Client-side id; attachments only get a server id once the email is sent. */
	id: string;
	filename: string;
	type: string;
	size: number;
	/** base64-encoded file bytes, without the `data:` prefix. */
	content: string;
}

export interface ComposeAttachmentsApi {
	items: ComposeAttachment[];
	/** Total raw bytes of the picked files (inline images are not counted here). */
	totalBytes: number;
	error: string | null;
	clearError: () => void;
	addFiles: (files: File[]) => Promise<void>;
	remove: (id: string) => void;
	reset: () => void;
	/**
	 * Validate an image for inline embedding and return its data URL, or null
	 * when it is rejected (in which case `error` explains why).
	 */
	prepareInlineImage: (file: File) => Promise<string | null>;
}

function readAsDataUrl(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = () => reject(new Error(`Could not read "${file.name}".`));
		reader.onload = () => resolve(String(reader.result ?? ""));
		reader.readAsDataURL(file);
	});
}

function base64FromDataUrl(dataUrl: string): string {
	const comma = dataUrl.indexOf(",");
	return comma === -1 ? "" : dataUrl.slice(comma + 1);
}

const PER_FILE_LIMIT = formatBytes(MAX_ATTACHMENT_BYTES, 0);
const TOTAL_LIMIT = formatBytes(MAX_TOTAL_ATTACHMENT_BYTES, 1);

/**
 * Attachment state for a compose form: files picked from the toolbar, plus the
 * size budget that pasted inline images share with them.
 *
 * @param getInlineBytes - current byte total of `data:` images in the editor
 *   body, so a pasted screenshot and an attached PDF compete for one budget.
 */
export function useComposeAttachments(
	getInlineBytes: () => number,
): ComposeAttachmentsApi {
	const [items, setItems] = useState<ComposeAttachment[]>([]);
	const [error, setError] = useState<string | null>(null);

	// The add loop is async, so it reads the live values through refs instead of
	// the state captured when the callback was created.
	const itemsRef = useRef(items);
	itemsRef.current = items;
	const getInlineBytesRef = useRef(getInlineBytes);
	getInlineBytesRef.current = getInlineBytes;

	const totalBytes = useMemo(
		() => items.reduce((sum, item) => sum + item.size, 0),
		[items],
	);

	const rejectReason = useCallback(
		(file: File, usedBytes: number, count: number): string | null => {
			if (count >= MAX_ATTACHMENT_COUNT) {
				return `You can attach at most ${MAX_ATTACHMENT_COUNT} files.`;
			}
			if (file.size > MAX_ATTACHMENT_BYTES) {
				return `"${file.name}" is ${formatBytes(file.size)}. Each file must be under ${PER_FILE_LIMIT}.`;
			}
			if (usedBytes + file.size > MAX_TOTAL_ATTACHMENT_BYTES) {
				return `"${file.name}" does not fit — attachments and pasted images together must stay under ${TOTAL_LIMIT}.`;
			}
			return null;
		},
		[],
	);

	const addFiles = useCallback(
		async (files: File[]) => {
			if (files.length === 0) return;
			setError(null);

			const accepted: ComposeAttachment[] = [];
			let lastRejection: string | null = null;
			let usedBytes =
				itemsRef.current.reduce((sum, item) => sum + item.size, 0) +
				getInlineBytesRef.current();
			let count = itemsRef.current.length;

			for (const file of files) {
				const reason = rejectReason(file, usedBytes, count);
				if (reason) {
					lastRejection = reason;
					if (count >= MAX_ATTACHMENT_COUNT) break;
					continue;
				}
				try {
					accepted.push({
						id: crypto.randomUUID(),
						filename: file.name || "untitled",
						type: file.type || "application/octet-stream",
						size: file.size,
						content: base64FromDataUrl(await readAsDataUrl(file)),
					});
				} catch (err) {
					lastRejection =
						err instanceof Error ? err.message : `Could not read "${file.name}".`;
					continue;
				}
				usedBytes += file.size;
				count += 1;
			}

			if (accepted.length > 0) setItems((prev) => [...prev, ...accepted]);
			if (lastRejection) setError(lastRejection);
		},
		[rejectReason],
	);

	const prepareInlineImage = useCallback(
		async (file: File) => {
			setError(null);
			const usedBytes =
				itemsRef.current.reduce((sum, item) => sum + item.size, 0) +
				getInlineBytesRef.current();
			const reason = rejectReason(file, usedBytes, itemsRef.current.length);
			if (reason) {
				setError(reason);
				return null;
			}
			try {
				return await readAsDataUrl(file);
			} catch (err) {
				setError(
					err instanceof Error ? err.message : `Could not read "${file.name}".`,
				);
				return null;
			}
		},
		[rejectReason],
	);

	const remove = useCallback((id: string) => {
		setItems((prev) => prev.filter((item) => item.id !== id));
		setError(null);
	}, []);

	const reset = useCallback(() => {
		setItems([]);
		setError(null);
	}, []);

	const clearError = useCallback(() => setError(null), []);

	return {
		items,
		totalBytes,
		error,
		clearError,
		addFiles,
		remove,
		reset,
		prepareInlineImage,
	};
}
