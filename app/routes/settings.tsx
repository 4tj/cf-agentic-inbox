// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Badge, Button, Input, Loader, useKumoToastManager } from "@cloudflare/kumo";
import { RobotIcon, ArrowCounterClockwiseIcon, CheckIcon, CopyIcon, LinkIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { useMailbox, useUpdateMailbox } from "~/queries/mailboxes";
import { useMailboxShareLink, useResetMailboxShareLink } from "~/queries/share-links";

// Placeholder shown in the textarea when no custom prompt is set.
// The authoritative default prompt lives in workers/agent/index.ts (DEFAULT_SYSTEM_PROMPT).
const PROMPT_PLACEHOLDER = `You are an email assistant that helps manage this inbox. You read emails, draft replies, and help organize conversations.\n\nWrite like a real person. Short, direct, flowing prose. Plain text only.\n\n(Leave empty to use the full built-in default prompt)`;

export default function SettingsRoute() {
	const { mailboxId } = useParams<{ mailboxId: string }>();
	const toastManager = useKumoToastManager();
	const { data: mailbox } = useMailbox(mailboxId);
	const { data: mailboxShareLink, isLoading: isShareLinkLoading } = useMailboxShareLink(mailboxId);
	const updateMailboxMutation = useUpdateMailbox();
	const resetShareLinkMutation = useResetMailboxShareLink();

	const [displayName, setDisplayName] = useState("");
	const [agentPrompt, setAgentPrompt] = useState("");
	const [isSaving, setIsSaving] = useState(false);
	const [isCopyingShareLink, setIsCopyingShareLink] = useState(false);
	const [isResettingShareLink, setIsResettingShareLink] = useState(false);
	const [shareCopied, setShareCopied] = useState(false);

	useEffect(() => {
		if (mailbox) {
			setDisplayName(mailbox.settings?.fromName || mailbox.name || "");
			setAgentPrompt(mailbox.settings?.agentSystemPrompt || "");
		}
	}, [mailbox]);

	const handleSave = async () => {
		if (!mailbox || !mailboxId) return;
		setIsSaving(true);
		const settings = {
			...mailbox.settings,
			fromName: displayName,
			agentSystemPrompt: agentPrompt.trim() || undefined,
		};
		try {
			await updateMailboxMutation.mutateAsync({ mailboxId, settings });
			toastManager.add({ title: "Settings saved!" });
		} catch {
			toastManager.add({
				title: "Failed to save settings",
				variant: "error",
			});
		} finally {
			setIsSaving(false);
		}
	};

	const handleResetPrompt = () => {
		setAgentPrompt("");
	};

	const copyShareUrl = async (shareUrl: string) => {
		await navigator.clipboard.writeText(shareUrl);
		setShareCopied(true);
		window.setTimeout(() => setShareCopied(false), 2000);
	};

	const handleCopyShareLink = async () => {
		if (!mailboxId) return;
		setIsCopyingShareLink(true);
		try {
			let shareUrl = mailboxShareLink?.shareUrl;
			if (!shareUrl) {
				const created = await resetShareLinkMutation.mutateAsync(mailboxId);
				shareUrl = created.shareUrl;
			}
			if (!shareUrl) throw new Error("Share link unavailable");
			await copyShareUrl(shareUrl);
			toastManager.add({ title: "Share link copied" });
		} catch {
			toastManager.add({ title: "Failed to copy share link", variant: "error" });
		} finally {
			setIsCopyingShareLink(false);
		}
	};

	const handleResetShareLink = async () => {
		if (!mailboxId) return;
		setIsResettingShareLink(true);
		try {
			const updated = await resetShareLinkMutation.mutateAsync(mailboxId);
			if (updated.shareUrl) await copyShareUrl(updated.shareUrl);
			toastManager.add({ title: "Share link reset" });
		} catch {
			toastManager.add({ title: "Failed to reset share link", variant: "error" });
		} finally {
			setIsResettingShareLink(false);
		}
	};

	if (!mailbox) {
		return (
			<div className="flex justify-center py-20">
				<Loader size="lg" />
			</div>
		);
	}

	const isCustomPrompt = agentPrompt.trim().length > 0;

	return (
		<div className="max-w-2xl px-4 py-4 md:px-8 md:py-6 h-full overflow-y-auto">
			<h1 className="text-lg font-semibold text-kumo-default mb-6">Settings</h1>

			<div className="space-y-6">
				{/* Account */}
				<div className="rounded-lg border border-kumo-line bg-kumo-base p-5">
					<div className="text-sm font-medium text-kumo-default mb-4">
						Account
					</div>
					<div className="space-y-3">
						<Input
							label="Display Name"
							value={displayName}
							onChange={(e) => setDisplayName(e.target.value)}
						/>
						<Input label="Email" type="email" value={mailbox.email} disabled />
					</div>
				</div>

				{/* Sharing */}
				<div className="rounded-lg border border-kumo-line bg-kumo-base p-5">
					<div className="flex items-center justify-between mb-4">
						<div className="flex items-center gap-2">
							<LinkIcon size={16} weight="duotone" className="text-kumo-subtle" />
							<span className="text-sm font-medium text-kumo-default">
								Sharing
							</span>
							<Badge variant={mailboxShareLink?.shareUrl ? "primary" : "secondary"}>
								{mailboxShareLink?.shareUrl ? "Active" : "Off"}
							</Badge>
						</div>
					</div>
					<div className="space-y-3">
						<Input
							label="Public inbox link"
							value={mailboxShareLink?.shareUrl || ""}
							placeholder={isShareLinkLoading ? "Loading..." : "No link created"}
							readOnly
						/>
						<div className="flex justify-end gap-2">
							<Button
								variant="secondary"
								size="sm"
								icon={shareCopied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
								onClick={handleCopyShareLink}
								loading={isCopyingShareLink}
							>
								{shareCopied ? "Copied" : "Copy Link"}
							</Button>
							<Button
								variant="ghost"
								size="sm"
								icon={<ArrowCounterClockwiseIcon size={14} />}
								onClick={handleResetShareLink}
								loading={isResettingShareLink}
							>
								Reset
							</Button>
						</div>
					</div>
				</div>

				{/* Agent System Prompt */}
				<div className="rounded-lg border border-kumo-line bg-kumo-base p-5">
					<div className="flex items-center justify-between mb-4">
						<div className="flex items-center gap-2">
							<RobotIcon size={16} weight="duotone" className="text-kumo-subtle" />
							<span className="text-sm font-medium text-kumo-default">
								AI Agent Prompt
							</span>
							{isCustomPrompt ? (
								<Badge variant="primary">Custom</Badge>
							) : (
								<Badge variant="secondary">Default</Badge>
							)}
						</div>
						{isCustomPrompt && (
							<Button
								variant="ghost"
								size="xs"
								icon={<ArrowCounterClockwiseIcon size={14} />}
								onClick={handleResetPrompt}
							>
								Reset to default
							</Button>
						)}
					</div>
					<p className="text-xs text-kumo-subtle mb-3">
						Customize how the AI agent behaves for this mailbox.
						Leave empty to use the built-in default prompt.
					</p>
					<textarea
						value={agentPrompt}
						onChange={(e) => setAgentPrompt(e.target.value)}
						placeholder={PROMPT_PLACEHOLDER}
						rows={12}
						className="w-full resize-y rounded-lg border border-kumo-line bg-kumo-recessed px-3 py-2 text-xs text-kumo-default placeholder:text-kumo-subtle focus:outline-none focus:ring-1 focus:ring-kumo-ring font-mono leading-relaxed"
					/>
					<p className="text-xs text-kumo-subtle mt-2">
						The prompt is sent as the system message to the AI model.
						It controls the agent's personality, writing style, and behavior rules.
					</p>
				</div>

				{/* Save */}
				<div className="flex justify-end">
					<Button variant="primary" onClick={handleSave} loading={isSaving}>
						Save Changes
					</Button>
				</div>
			</div>
		</div>
	);
}
