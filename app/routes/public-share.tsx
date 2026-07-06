// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Badge, Button, Dialog, Empty, Loader, Pagination, Tooltip } from "@cloudflare/kumo";
import {
	ArrowLeftIcon,
	ArrowsClockwiseIcon,
	EnvelopeSimpleIcon,
	ImageIcon,
	TrayIcon,
	WarningIcon,
} from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";
import EmailAttachmentList from "~/components/EmailAttachmentList";
import EmailIframe from "~/components/EmailIframe";
import {
	formatDetailDate,
	formatListDate,
	getSnippetText,
	rewriteInlineImagesWithUrl,
	stripHtml,
} from "~/lib/utils";
import { queryKeys } from "~/queries/keys";
import api from "~/services/api";
import type { Email } from "~/types";

const PAGE_SIZE = 25;

function publicAttachmentUrl(token: string, emailId: string, attachmentId: string) {
	return `/api/public/share/${encodeURIComponent(token)}/emails/${encodeURIComponent(emailId)}/attachments/${encodeURIComponent(attachmentId)}`;
}

function formatParticipants(email: Email): string {
	if (email.participants) {
		const names = email.participants
			.split(",")
			.map((participant) => participant.trim().split("@")[0])
			.filter((name, idx, arr) => name && arr.indexOf(name) === idx);
		if (names.length <= 3) return names.join(", ");
		return `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
	}
	return email.sender.split("@")[0] || email.sender;
}

function PublicShareSkeleton() {
	return (
		<div className="flex h-screen items-center justify-center bg-kumo-recessed">
			<Loader size="lg" />
		</div>
	);
}

function PublicNotFound() {
	return (
		<div className="flex min-h-screen items-center justify-center bg-kumo-recessed p-6">
			<Empty
				icon={<WarningIcon size={48} className="text-kumo-inactive" />}
				title="Share link not found"
				description="This shared inbox link is no longer available."
			/>
		</div>
	);
}

function EmailListSkeleton() {
	return (
		<div className="animate-pulse space-y-1 p-2">
			{Array.from({ length: 8 }).map((_, index) => (
				<div key={index} className="flex items-center gap-3 px-3 py-3">
					<div className="h-2 w-2 rounded-full bg-kumo-fill" />
					<div className="flex-1 space-y-2">
						<div className="flex items-center gap-2">
							<div className="h-3 w-24 rounded bg-kumo-fill" />
							<div className="h-3 flex-1 rounded bg-kumo-fill" />
							<div className="h-3 w-12 rounded bg-kumo-fill" />
						</div>
						<div className="h-2.5 w-3/4 rounded bg-kumo-fill" />
					</div>
				</div>
			))}
		</div>
	);
}

function MessageView({
	email,
	token,
	mailboxEmail,
	onPreviewImage,
}: {
	email: Email;
	token: string;
	mailboxEmail?: string;
	onPreviewImage: (url: string, filename: string) => void;
}) {
	const isSelf = email.sender === mailboxEmail;
	const senderLabel = isSelf ? "You" : email.sender;
	const body = rewriteInlineImagesWithUrl(
		email.body || "",
		email.id,
		email.attachments,
		(attachmentId, emailId) => publicAttachmentUrl(token, emailId, attachmentId),
	);

	return (
		<div className="border-b border-kumo-line px-4 py-4 last:border-b-0 md:px-6">
			<div className="mb-3 flex items-start justify-between gap-3">
				<div className="flex min-w-0 items-center gap-2.5">
					<div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${isSelf ? "bg-kumo-brand text-kumo-inverse" : "bg-kumo-fill text-kumo-default"}`}>
						{senderLabel.charAt(0).toUpperCase()}
					</div>
					<div className="min-w-0">
						<div className="truncate text-sm font-medium text-kumo-default">
							{senderLabel}
						</div>
						<div className="truncate text-xs text-kumo-subtle">
							To: {email.recipient}
						</div>
					</div>
				</div>
				<span className="shrink-0 text-xs text-kumo-subtle">
					{formatDetailDate(email.date)}
				</span>
			</div>
			<div className="md:ml-[46px]">
				<EmailIframe body={body} autoSize />
				<EmailAttachmentList
					emailId={email.id}
					attachments={email.attachments}
					onPreviewImage={onPreviewImage}
					buildAttachmentUrl={(emailId, attachmentId) =>
						publicAttachmentUrl(token, emailId, attachmentId)
					}
					className="mt-3"
					showHeading
				/>
			</div>
		</div>
	);
}

function PublicEmailPanel({
	token,
	emailId,
	mailboxEmail,
	onBack,
}: {
	token: string;
	emailId: string;
	mailboxEmail?: string;
	onBack: () => void;
}) {
	const [previewImage, setPreviewImage] = useState<{ url: string; filename: string } | null>(null);
	const { data: email, isLoading } = useQuery({
		queryKey: queryKeys.publicShare.detail(token, emailId),
		queryFn: ({ signal }) => api.getPublicShareEmail(token, emailId, { signal }),
		enabled: !!token && !!emailId,
	});
	const threadId = email?.thread_id || "";
	const { data: threadEmails } = useQuery({
		queryKey: queryKeys.publicShare.thread(token, threadId),
		queryFn: ({ signal }) => api.getPublicShareThread(token, threadId, { signal }),
		enabled: !!token && !!threadId,
		retry: false,
	});

	const messages = useMemo(() => {
		const list = threadEmails && threadEmails.length > 0 ? threadEmails : email ? [email] : [];
		return [...list].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
	}, [email, threadEmails]);

	if (isLoading) {
		return (
			<div className="flex h-full items-center justify-center">
				<Loader size="lg" />
			</div>
		);
	}

	if (!email) {
		return (
			<div className="flex h-full items-center justify-center p-6">
				<Empty
					icon={<EnvelopeSimpleIcon size={48} className="text-kumo-inactive" />}
					title="Email unavailable"
					description="This message is not available through the shared inbox."
				/>
			</div>
		);
	}

	return (
		<div className="flex h-full flex-col">
			<div className="flex shrink-0 items-center gap-2 border-b border-kumo-line px-3 py-2 md:px-4">
				<Tooltip content="Back to inbox" side="bottom" asChild>
					<Button
						variant="ghost"
						shape="square"
						size="sm"
						icon={<ArrowLeftIcon size={18} />}
						onClick={onBack}
						aria-label="Back to inbox"
						className="md:hidden"
					/>
				</Tooltip>
				<div className="min-w-0 flex-1 px-1">
					<h2 className="truncate text-base font-semibold text-kumo-default">
						{email.subject || "(no subject)"}
					</h2>
					{messages.length > 1 && (
						<div className="text-xs text-kumo-subtle">
							{messages.length} messages in this thread
						</div>
					)}
				</div>
			</div>
			<div className="flex-1 overflow-y-auto">
				{messages.map((message) => (
					<MessageView
						key={message.id}
						email={message}
						token={token}
						mailboxEmail={mailboxEmail}
						onPreviewImage={(url, filename) => setPreviewImage({ url, filename })}
					/>
				))}
			</div>
			<Dialog.Root
				open={previewImage !== null}
				onOpenChange={(open) => {
					if (!open) setPreviewImage(null);
				}}
			>
				<Dialog size="lg">
					<Dialog.Title>{previewImage?.filename}</Dialog.Title>
					{previewImage && (
						<div className="mt-4 flex min-h-[200px] items-center justify-center rounded-lg bg-kumo-tint/30 p-4">
							<img
								src={previewImage.url}
								alt={previewImage.filename}
								className="max-h-[70vh] max-w-full rounded object-contain shadow-sm"
							/>
						</div>
					)}
					<div className="mt-4 flex justify-end">
						<Dialog.Close>
							<Button variant="primary" size="sm">
								Close
							</Button>
						</Dialog.Close>
					</div>
				</Dialog>
			</Dialog.Root>
		</div>
	);
}

export default function PublicShareRoute() {
	const { token = "" } = useParams<{ token: string }>();
	const [page, setPage] = useState(1);
	const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
	const queryClient = useQueryClient();

	const {
		data: meta,
		isLoading: isMetaLoading,
		isError: isMetaError,
	} = useQuery({
		queryKey: queryKeys.publicShare.meta(token),
		queryFn: ({ signal }) => api.getPublicShare(token, { signal }),
		enabled: !!token,
		retry: false,
	});

	const {
		data: emailData,
		isFetching: isRefreshing,
		isLoading: isListLoading,
	} = useQuery({
		queryKey: queryKeys.publicShare.emails(token, page),
		queryFn: ({ signal }) =>
			api.listPublicShareEmails(
				token,
				{ page: String(page), limit: String(PAGE_SIZE) },
				{ signal },
			),
		enabled: !!token && !!meta,
		refetchInterval: 30_000,
	});

	useEffect(() => {
		setSelectedEmailId(null);
		setPage(1);
	}, [token]);

	if (!token || isMetaError) return <PublicNotFound />;
	if (isMetaLoading || !meta) return <PublicShareSkeleton />;

	const emails = emailData?.emails ?? [];
	const totalCount = emailData?.totalCount ?? 0;
	const isPanelOpen = selectedEmailId !== null;

	const handleRefresh = () => {
		queryClient.invalidateQueries({ queryKey: ["public-share", token] });
	};

	return (
		<div className="flex h-screen flex-col overflow-hidden bg-kumo-base">
			<header className="flex shrink-0 items-center justify-between border-b border-kumo-line bg-kumo-base px-4 py-3 md:px-6">
				<div className="min-w-0">
					<div className="flex items-center gap-2">
						<TrayIcon size={18} className="text-kumo-subtle" />
						<h1 className="truncate text-base font-semibold text-kumo-default">
							{meta.mailbox.name}
						</h1>
						<Badge variant="secondary">Read only</Badge>
					</div>
					<div className="truncate text-sm text-kumo-subtle">
						{meta.mailbox.email}
					</div>
				</div>
			</header>
			<main className="flex min-h-0 flex-1">
				<section
					className={`min-w-0 shrink-0 flex-col border-r border-kumo-line ${
						isPanelOpen ? "hidden md:flex md:w-[420px]" : "flex w-full md:w-[420px]"
					}`}
				>
					<div className="flex shrink-0 items-center justify-between border-b border-kumo-line px-4 py-3.5">
						<div>
							<h2 className="text-lg font-semibold text-kumo-default">Inbox</h2>
							{totalCount > 0 && (
								<div className="text-sm text-kumo-subtle">
									{totalCount} conversation{totalCount !== 1 ? "s" : ""}
								</div>
							)}
						</div>
						<Tooltip
							content={isRefreshing ? "Refreshing..." : "Refresh"}
							side="bottom"
							asChild
						>
							<Button
								variant="ghost"
								shape="square"
								size="sm"
								icon={
									<ArrowsClockwiseIcon
										size={18}
										className={isRefreshing ? "animate-spin" : ""}
									/>
								}
								onClick={handleRefresh}
								disabled={isRefreshing}
								aria-label="Refresh"
							/>
						</Tooltip>
					</div>
					<div className="flex-1 overflow-y-auto">
						{isListLoading ? (
							<EmailListSkeleton />
						) : emails.length === 0 ? (
							<div className="flex flex-col items-center justify-center px-6 py-24 text-center">
								<TrayIcon size={48} weight="thin" className="mb-4 text-kumo-subtle" />
								<h3 className="mb-1.5 text-base font-semibold text-kumo-default">
									Inbox is empty
								</h3>
								<p className="max-w-xs text-sm text-kumo-subtle">
									New emails will appear here when they arrive.
								</p>
							</div>
						) : (
							<div>
								{emails.map((email) => {
									const isSelected = selectedEmailId === email.id;
									const snippet = getSnippetText(email.snippet);
									return (
										<button
											key={email.id}
											type="button"
											onClick={() => setSelectedEmailId(email.id)}
											className={`group flex w-full cursor-pointer items-center gap-3 border-b border-kumo-line px-4 py-2.5 text-left transition-colors md:px-5 md:py-3 ${
												isSelected ? "bg-kumo-tint" : "hover:bg-kumo-tint"
											}`}
										>
											<div className="flex w-2.5 shrink-0 justify-center">
												{!email.read && <div className="h-2 w-2 rounded-full bg-kumo-brand" />}
											</div>
											<div className="min-w-0 flex-1">
												<div className="flex items-center gap-2">
													<span className={`truncate text-sm ${!email.read ? "font-semibold text-kumo-default" : "text-kumo-strong"}`}>
														{formatParticipants(email)}
													</span>
													{(email.thread_count ?? 1) > 1 && (
														<span className="shrink-0 rounded-full bg-kumo-fill px-1.5 py-0.5 text-xs font-medium text-kumo-subtle">
															{email.thread_count}
														</span>
													)}
													<span className="ml-auto shrink-0 text-sm text-kumo-subtle">
														{formatListDate(email.date)}
													</span>
												</div>
												<div className="mt-0.5 truncate text-sm">
													<span className={email.read ? "text-kumo-subtle" : "font-medium text-kumo-default"}>
														{email.subject || "(no subject)"}
													</span>
													{snippet && (
														<span className="font-normal text-kumo-subtle">
															{" "}-- {snippet}
														</span>
													)}
												</div>
											</div>
										</button>
									);
								})}
							</div>
						)}
					</div>
					{totalCount > PAGE_SIZE && (
						<div className="flex shrink-0 justify-center border-t border-kumo-line py-3">
							<Pagination
								page={page}
								setPage={setPage}
								perPage={PAGE_SIZE}
								totalCount={totalCount}
							/>
						</div>
					)}
				</section>
				<section className={`min-w-0 flex-1 flex-col ${isPanelOpen ? "flex" : "hidden md:flex"}`}>
					{selectedEmailId ? (
						<PublicEmailPanel
							token={token}
							emailId={selectedEmailId}
							mailboxEmail={meta.mailbox.email}
							onBack={() => setSelectedEmailId(null)}
						/>
					) : (
						<div className="flex h-full items-center justify-center p-6">
							<Empty
								icon={<ImageIcon size={48} className="text-kumo-inactive" />}
								title="Select an email"
								description="Choose a conversation from the inbox."
							/>
						</div>
					)}
				</section>
			</main>
		</div>
	);
}
