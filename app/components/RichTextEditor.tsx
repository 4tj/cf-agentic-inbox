// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Tooltip } from "@cloudflare/kumo";
import {
	ArrowClockwiseIcon,
	ArrowCounterClockwiseIcon,
	FileIcon,
	ImageIcon,
	LinkBreakIcon,
	LinkSimpleIcon,
	ListBulletsIcon,
	ListNumbersIcon,
	MinusIcon,
	PaperclipIcon,
	QuotesIcon,
	TextBIcon,
	TextItalicIcon,
	TextStrikethroughIcon,
	TextUnderlineIcon,
	XIcon,
} from "@phosphor-icons/react";
import { Color } from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import TiptapImage from "@tiptap/extension-image";
import LinkExtension from "@tiptap/extension-link";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import Underline from "@tiptap/extension-underline";
import type { Editor } from "@tiptap/react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useCallback, useEffect, useRef } from "react";
import type { ComposeAttachmentsApi } from "~/hooks/useComposeAttachments";
import { formatBytes } from "~/lib/utils";

interface RichTextEditorProps {
	value: string;
	onChange: (value: string) => void;
	/** When provided, the toolbar gains a file picker and images can be pasted. */
	attachments?: ComposeAttachmentsApi;
	/** Disables the attachment controls while an email is in flight. */
	disabled?: boolean;
}

function imageFilesFrom(list: FileList | null | undefined): File[] {
	return Array.from(list ?? []).filter((file) =>
		file.type.startsWith("image/"),
	);
}

export default function RichTextEditor({
	value,
	onChange,
	attachments,
	disabled = false,
}: RichTextEditorProps) {
	const fileInputRef = useRef<HTMLInputElement>(null);
	// TipTap builds `editorProps` once, so its handlers would capture the first
	// render's props. Read the live values through refs instead.
	const editorRef = useRef<Editor | null>(null);
	const attachmentsRef = useRef(attachments);
	attachmentsRef.current = attachments;
	const disabledRef = useRef(disabled);
	disabledRef.current = disabled;

	/**
	 * Embed dropped or pasted images as data URLs so the author can see them.
	 * They become `cid:` MIME parts at send time.
	 */
	const insertInlineImages = useCallback(
		async (files: File[], position?: number) => {
			const api = attachmentsRef.current;
			if (!api) return;
			let pos = position;
			for (const file of files) {
				const dataUrl = await api.prepareInlineImage(file);
				const editor = editorRef.current;
				if (!dataUrl || !editor || editor.isDestroyed) continue;
				const node = { type: "image", attrs: { src: dataUrl, alt: file.name } };
				if (pos === undefined) {
					editor.chain().focus().insertContent(node).run();
				} else {
					editor.chain().focus().insertContentAt(pos, node).run();
					pos = editor.state.selection.to;
				}
			}
		},
		[],
	);

	const editor = useEditor({
		extensions: [
			StarterKit,
			Underline,
			TextAlign.configure({ types: ["heading", "paragraph"] }),
			LinkExtension.configure({ openOnClick: false }),
			// Pasted images live in the document as data URLs until send, and
			// TipTap drops `img[src^="data:"]` on parse unless base64 is allowed.
			TiptapImage.configure({ allowBase64: true }),
			TextStyle,
			Color,
			Highlight.configure({ multicolor: true }),
		],
		content: value,
		editorProps: {
			attributes: {
				class:
					"prose prose-sm max-w-none focus:outline-none min-h-[180px] p-3 text-sm [&_blockquote]:border-l-2 [&_blockquote]:border-kumo-line [&_blockquote]:pl-3 [&_blockquote]:text-kumo-subtle [&_blockquote]:bg-kumo-tint [&_blockquote]:py-1 [&_blockquote]:my-2 [&_blockquote]:text-xs [&_blockquote]:rounded-r-sm [&_img]:max-w-full [&_img]:h-auto [&_img]:rounded-sm",
			},
			handlePaste: (_view, event) => {
				if (!attachmentsRef.current || disabledRef.current) return false;
				const images = imageFilesFrom(event.clipboardData?.files);
				if (images.length === 0) return false;
				event.preventDefault();
				void insertInlineImages(images);
				return true;
			},
			handleDrop: (view, event, _slice, moved) => {
				if (moved || !attachmentsRef.current || disabledRef.current) return false;
				const dropped = Array.from(event.dataTransfer?.files ?? []);
				if (dropped.length === 0) return false;
				const images = dropped.filter((file) => file.type.startsWith("image/"));
				const others = dropped.filter(
					(file) => !file.type.startsWith("image/"),
				);
				event.preventDefault();
				if (images.length > 0) {
					const coords = view.posAtCoords({
						left: (event as DragEvent).clientX,
						top: (event as DragEvent).clientY,
					});
					void insertInlineImages(images, coords?.pos);
				}
				// Non-image files dropped on the editor become regular attachments.
				if (others.length > 0) void attachmentsRef.current.addFiles(others);
				return true;
			},
		},
		onUpdate: ({ editor }) => {
			onChange(editor.getHTML());
		},
	});
	editorRef.current = editor;

	useEffect(() => {
		if (editor && !editor.isDestroyed && value !== editor.getHTML()) {
			editor.commands.setContent(value);
			// Place cursor at the start of the document (above quoted text)
			const rafId = requestAnimationFrame(() => {
				if (!editor.isDestroyed) {
					editor.commands.focus('start');
				}
			});
			return () => cancelAnimationFrame(rafId);
		}
	}, [value, editor]);

	const setLink = useCallback(() => {
		if (!editor) return;
		const previousUrl = editor.getAttributes("link").href;
		const url = window.prompt("URL", previousUrl);
		if (url === null) return;
		if (url === "") {
			editor.chain().focus().extendMarkRange("link").unsetLink().run();
			return;
		}
		editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
	}, [editor]);

	const handleFilesPicked = useCallback(
		async (event: React.ChangeEvent<HTMLInputElement>) => {
			const picked = Array.from(event.target.files ?? []);
			// Reset first so picking the same file twice still fires onChange.
			event.target.value = "";
			if (picked.length > 0) await attachmentsRef.current?.addFiles(picked);
		},
		[],
	);

	if (!editor) return null;

	return (
		<div className="rounded-lg border border-kumo-line overflow-hidden flex flex-col h-full">
			{/* Toolbar */}
			<div className="flex flex-wrap items-center gap-0.5 bg-kumo-recessed px-2 py-1.5 border-b border-kumo-line shrink-0">
				{/* Text formatting */}
				<Tooltip content="Bold" side="bottom" asChild>
					<Button
						variant={editor.isActive("bold") ? "secondary" : "ghost"}
						shape="square"
						size="sm"
						icon={<TextBIcon size={16} />}
						onClick={() => editor.chain().focus().toggleBold().run()}
						aria-label="Bold"
					/>
				</Tooltip>
				<Tooltip content="Italic" side="bottom" asChild>
					<Button
						variant={editor.isActive("italic") ? "secondary" : "ghost"}
						shape="square"
						size="sm"
						icon={<TextItalicIcon size={16} />}
						onClick={() => editor.chain().focus().toggleItalic().run()}
						aria-label="Italic"
					/>
				</Tooltip>
				<Tooltip content="Underline" side="bottom" asChild>
					<Button
						variant={editor.isActive("underline") ? "secondary" : "ghost"}
						shape="square"
						size="sm"
						icon={<TextUnderlineIcon size={16} />}
						onClick={() => editor.chain().focus().toggleUnderline().run()}
						aria-label="Underline"
					/>
				</Tooltip>
				<Tooltip content="Strikethrough" side="bottom" asChild>
					<Button
						variant={editor.isActive("strike") ? "secondary" : "ghost"}
						shape="square"
						size="sm"
						icon={<TextStrikethroughIcon size={16} />}
						onClick={() => editor.chain().focus().toggleStrike().run()}
						aria-label="Strikethrough"
					/>
				</Tooltip>

				<div className="mx-1 h-5 w-px bg-kumo-fill" />

				{/* Lists */}
				<Tooltip content="Bullet list" side="bottom" asChild>
					<Button
						variant={editor.isActive("bulletList") ? "secondary" : "ghost"}
						shape="square"
						size="sm"
						icon={<ListBulletsIcon size={16} />}
						onClick={() => editor.chain().focus().toggleBulletList().run()}
						aria-label="Bullet list"
					/>
				</Tooltip>
				<Tooltip content="Numbered list" side="bottom" asChild>
					<Button
						variant={editor.isActive("orderedList") ? "secondary" : "ghost"}
						shape="square"
						size="sm"
						icon={<ListNumbersIcon size={16} />}
						onClick={() => editor.chain().focus().toggleOrderedList().run()}
						aria-label="Numbered list"
					/>
				</Tooltip>

				<div className="mx-1 h-5 w-px bg-kumo-fill" />

				{/* Block formatting */}
				<Tooltip content="Blockquote" side="bottom" asChild>
					<Button
						variant={editor.isActive("blockquote") ? "secondary" : "ghost"}
						shape="square"
						size="sm"
						icon={<QuotesIcon size={16} />}
						onClick={() => editor.chain().focus().toggleBlockquote().run()}
						aria-label="Blockquote"
					/>
				</Tooltip>
				<Tooltip content="Link" side="bottom" asChild>
					<Button
						variant={editor.isActive("link") ? "secondary" : "ghost"}
						shape="square"
						size="sm"
						icon={<LinkSimpleIcon size={16} />}
						onClick={setLink}
						aria-label="Link"
					/>
				</Tooltip>
				{editor.isActive("link") && (
					<Tooltip content="Remove link" side="bottom" asChild>
						<Button
							variant="ghost"
							shape="square"
							size="sm"
							icon={<LinkBreakIcon size={16} />}
							onClick={() => editor.chain().focus().unsetLink().run()}
							aria-label="Remove link"
						/>
					</Tooltip>
				)}
				<Tooltip content="Horizontal rule" side="bottom" asChild>
					<Button
						variant="ghost"
						shape="square"
						size="sm"
						icon={<MinusIcon size={16} />}
						onClick={() => editor.chain().focus().setHorizontalRule().run()}
						aria-label="Horizontal rule"
					/>
				</Tooltip>

				{attachments && (
					<>
						<div className="mx-1 h-5 w-px bg-kumo-fill" />
						<Tooltip content="Attach files" side="bottom" asChild>
							<Button
								variant="ghost"
								shape="square"
								size="sm"
								icon={<PaperclipIcon size={16} />}
								onClick={() => fileInputRef.current?.click()}
								disabled={disabled}
								aria-label="Attach files"
							/>
						</Tooltip>
						<input
							ref={fileInputRef}
							type="file"
							multiple
							className="hidden"
							onChange={handleFilesPicked}
						/>
					</>
				)}

				<div className="mx-1 h-5 w-px bg-kumo-fill" />

				{/* Undo/Redo */}
				<Tooltip content="Undo" side="bottom" asChild>
					<Button
						variant="ghost"
						shape="square"
						size="sm"
						icon={<ArrowCounterClockwiseIcon size={16} />}
						onClick={() => editor.chain().focus().undo().run()}
						disabled={!editor.can().undo()}
						aria-label="Undo"
					/>
				</Tooltip>
				<Tooltip content="Redo" side="bottom" asChild>
					<Button
						variant="ghost"
						shape="square"
						size="sm"
						icon={<ArrowClockwiseIcon size={16} />}
						onClick={() => editor.chain().focus().redo().run()}
						disabled={!editor.can().redo()}
						aria-label="Redo"
					/>
				</Tooltip>
			</div>

			{/* Editor content */}
			<div className="flex-1 overflow-y-auto">
				<EditorContent editor={editor} />
			</div>

			{attachments && (attachments.items.length > 0 || attachments.error) && (
				<div className="shrink-0 border-t border-kumo-line bg-kumo-recessed px-2 py-2 space-y-2">
					{attachments.error && (
						<p className="text-xs text-kumo-error px-1">{attachments.error}</p>
					)}
					{attachments.items.length > 0 && (
						<ul className="flex flex-wrap gap-2 list-none m-0 p-0">
							{attachments.items.map((item) => (
								<li key={item.id}>
									<span className="flex items-center gap-2 rounded-md border border-kumo-line bg-kumo-base px-2 py-1 text-xs">
										{item.type.startsWith("image/") ? (
											<ImageIcon size={14} className="text-kumo-subtle shrink-0" />
										) : (
											<FileIcon size={14} className="text-kumo-subtle shrink-0" />
										)}
										<span className="text-kumo-default font-medium truncate max-w-[160px]">
											{item.filename}
										</span>
										<span className="text-kumo-subtle">
											{formatBytes(item.size)}
										</span>
										<button
											type="button"
											onClick={() => attachments.remove(item.id)}
											disabled={disabled}
											className="text-kumo-subtle hover:text-kumo-default disabled:opacity-50"
											aria-label={`Remove ${item.filename}`}
										>
											<XIcon size={12} />
										</button>
									</span>
								</li>
							))}
						</ul>
					)}
				</div>
			)}
		</div>
	);
}
