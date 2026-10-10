// Copyright (c) 2026 Cloudflare, Inc. Apache-2.0
// Public-token queries only. Do not wrap this route in the private workspace.
import {
	Badge,
	Button,
	Dialog,
	Empty,
	Loader,
	Pagination,
} from "@cloudflare/kumo";
import {
	ArrowLeftIcon,
	ArrowsClockwiseIcon,
	EnvelopeSimpleIcon,
	ListIcon,
	WarningIcon,
	XIcon,
} from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useParams } from "react-router";
import { Folders } from "../../shared/folders";
import EmailAttachmentList from "~/components/EmailAttachmentList";
import EmailIframe from "~/components/EmailIframe";
import InboxNavigation from "~/components/InboxNavigation";
import MailRow from "~/components/MailRow";
import { formatDetailDate, rewriteInlineImagesWithUrl } from "~/lib/utils";
import { queryKeys } from "~/queries/keys";
import api, { ApiError } from "~/services/api";
import type { Email } from "~/types";

const PAGE_SIZE = 25;
const SHARE_CATEGORIES = [
	{ folder: Folders.INBOX, label: "All" },
	{ folder: Folders.SPAM, label: "Spam" },
] as const;
function publicAttachmentUrl(
	token: string,
	emailId: string,
	attachmentId: string,
) {
	return `/api/public/share/${encodeURIComponent(token)}/emails/${encodeURIComponent(emailId)}/attachments/${encodeURIComponent(attachmentId)}`;
}
function LoadError({
	title,
	error,
	retry,
}: {
	title: string;
	error?: Error | null;
	retry: () => void;
}) {
	return (
		<div role="alert" className="p-5">
			<h2 className="font-semibold">{title}</h2>
			<p className="mt-2 text-sm text-kumo-subtle break-words">
				{error?.message}
			</p>
			<Button variant="secondary" size="sm" onClick={retry} className="mt-3">
				Retry
			</Button>
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
	mailboxEmail: string;
	onPreviewImage: (url: string, filename: string) => void;
}) {
	const isSelf = email.sender === mailboxEmail;
	const body = rewriteInlineImagesWithUrl(
		email.body || "",
		email.id,
		email.attachments,
		(attachmentId, emailId) =>
			publicAttachmentUrl(token, emailId, attachmentId),
	);
	return (
		<div className="border-b border-kumo-line px-4 py-5 last:border-b-0 md:px-6">
			<div className="mb-4 flex flex-wrap items-start gap-3">
				<div
					className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${isSelf ? "bg-kumo-brand text-kumo-inverse" : "bg-kumo-fill"}`}
				>
					{email.sender.charAt(0).toUpperCase()}
				</div>
				<div className="min-w-0 flex-1">
					<div className="text-sm font-medium break-all">{email.sender}</div>
					<div className="text-xs text-kumo-subtle break-all mt-1">
						To: {email.recipient}
					</div>
				</div>
				<time className="text-xs text-kumo-subtle">
					{formatDetailDate(email.date)}
				</time>
			</div>
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
	mailboxEmail: string;
	onBack: () => void;
}) {
	const [preview, setPreview] = useState<{
		url: string;
		filename: string;
	} | null>(null);
	const detail = useQuery({
		queryKey: queryKeys.publicShare.detail(token, emailId),
		queryFn: ({ signal }) =>
			api.getPublicShareEmail(token, emailId, { signal }),
		retry: false,
	});
	const email = detail.data;
	const threadId = email?.thread_id || "";
	const thread = useQuery({
		queryKey: queryKeys.publicShare.thread(token, threadId),
		queryFn: ({ signal }) =>
			api.getPublicShareThread(token, threadId, { signal }),
		enabled: !!threadId,
		retry: false,
	});
	const messages = useMemo(() => {
		const list = thread.data?.length ? thread.data : email ? [email] : [];
		return [...list].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
	}, [email, thread.data]);
	return (
		<div className="flex h-full flex-col">
			<div className="flex shrink-0 items-center gap-2 border-b border-kumo-line px-3 py-3">
				<Button
					variant="ghost"
					shape="square"
					size="sm"
					icon={<ArrowLeftIcon size={18} />}
					onClick={onBack}
					aria-label="Back to inbox"
				/>
				<div className="min-w-0 flex-1">
					<h2 className="text-base font-semibold break-words">
						{email?.subject || (detail.isLoading ? "Loading email…" : "Email")}
					</h2>
					{messages.length > 1 && (
						<div className="text-xs text-kumo-subtle mt-1">
							{messages.length} messages in this thread
						</div>
					)}
				</div>
			</div>
			<div className="flex-1 min-h-0 overflow-y-auto">
				{detail.isLoading ? (
					<div className="p-12 flex justify-center">
						<Loader />
					</div>
				) : detail.error ? (
					<LoadError
						title={
							detail.error instanceof ApiError && detail.error.status === 404
								? "Email unavailable"
								: "Could not load email"
						}
						error={detail.error}
						retry={() => void detail.refetch()}
					/>
				) : (
					messages.map((message) => (
						<MessageView
							key={message.id}
							email={message}
							token={token}
							mailboxEmail={mailboxEmail}
							onPreviewImage={(url, filename) => setPreview({ url, filename })}
						/>
					))
				)}
				{thread.error && (
					<LoadError
						title="Thread not fully loaded"
						error={thread.error}
						retry={() => void thread.refetch()}
					/>
				)}
			</div>
			<Dialog.Root
				open={!!preview}
				onOpenChange={(open) => {
					if (!open) setPreview(null);
				}}
			>
				<Dialog className="p-5">
					<Dialog.Title>{preview?.filename}</Dialog.Title>
					{preview && (
						<img
							src={preview.url}
							alt={preview.filename}
							className="mt-4 max-h-[70vh] max-w-full object-contain"
						/>
					)}
					<Button className="mt-4" onClick={() => setPreview(null)}>
						Close
					</Button>
				</Dialog>
			</Dialog.Root>
		</div>
	);
}
export default function PublicShareRoute() {
	const { token = "" } = useParams();
	return <PublicShareView key={token} token={token} />;
}
function PublicShareView({ token }: { token: string }) {
	const [folder, setFolder] = useState<string>(Folders.INBOX);
	const [page, setPage] = useState(1);
	const [selected, setSelected] = useState<string | null>(null);
	const [navOpen, setNavOpen] = useState(false);
	const client = useQueryClient();
	const meta = useQuery({
		queryKey: queryKeys.publicShare.meta(token),
		queryFn: ({ signal }) => api.getPublicShare(token, { signal }),
		enabled: !!token,
		retry: false,
	});
	const list = useQuery({
		queryKey: queryKeys.publicShare.emails(token, folder, page),
		queryFn: ({ signal }) =>
			api.listPublicShareEmails(
				token,
				{ folder, page: String(page), limit: String(PAGE_SIZE) },
				{ signal },
			),
		enabled: !!token && !!meta.data,
		refetchInterval: 30_000,
		retry: false,
	});
	if (!token || (meta.error instanceof ApiError && meta.error.status === 404))
		return (
			<div className="flex min-h-dvh items-center justify-center bg-kumo-recessed p-6">
				<Empty
					icon={<WarningIcon size={48} />}
					title="Share link not found"
					description="This shared inbox link is no longer available."
				/>
			</div>
		);
	if (meta.error)
		return (
			<div className="flex min-h-dvh items-center justify-center bg-kumo-recessed">
				<LoadError
					title="Could not load shared inbox"
					error={meta.error}
					retry={() => void meta.refetch()}
				/>
			</div>
		);
	if (!meta.data)
		return (
			<div className="flex h-dvh items-center justify-center">
				<Loader size="lg" />
			</div>
		);
	const mailbox = meta.data.mailbox;
	const sidebar = (
		<InboxNavigation readOnly items={[mailbox]} activeId={mailbox.id} />
	);
	const count = list.data?.totalCount ?? 0;
	const emails = list.data?.emails ?? [];
	const refresh = () => {
		void client.invalidateQueries({ queryKey: ["public-share", token] });
	};
	return (
		<div className="flex h-dvh overflow-hidden bg-kumo-base">
			<div className="hidden md:flex shrink-0">{sidebar}</div>
			<div className="min-w-0 flex-1 flex flex-col">
				<header className="h-14 flex shrink-0 items-center gap-3 px-3 border-b border-kumo-line md:px-5">
					<Button
						variant="ghost"
						size="sm"
						shape="square"
						icon={<ListIcon size={20} />}
						aria-label="Open shared inbox navigation"
						className="md:hidden"
						onClick={() => setNavOpen(true)}
					/>
					<span className="text-xs text-kumo-subtle truncate">
						Shared Inbox / {mailbox.email}
					</span>
					<Badge variant="secondary" className="ml-auto shrink-0">
						Read only
					</Badge>
				</header>
				<main
					className={`mail-split flex-1 min-h-0 ${selected ? "detail-open" : ""}`}
				>
					<section className="mail-list-pane" aria-label="Shared email list">
						<div className="px-5 pt-5 pb-4 border-b border-kumo-line">
							<div className="flex items-center gap-2">
								<h1
									className="text-xl font-semibold truncate flex-1"
									title={mailbox.name}
								>
									{mailbox.name}
								</h1>
								<Button
									variant="ghost"
									size="sm"
									shape="square"
									aria-label="Refresh"
									onClick={refresh}
									disabled={list.isFetching}
									icon={
										<ArrowsClockwiseIcon
											size={17}
											className={list.isFetching ? "animate-spin" : ""}
										/>
									}
								/>
							</div>
							<div className="text-xs text-kumo-subtle mt-1 break-all">
								{mailbox.email} · Received mail
							</div>
							<nav aria-label="Email categories" className="mt-5 flex gap-1">
								{SHARE_CATEGORIES.map((category) => (
									<button
										key={category.folder}
										type="button"
										aria-current={folder === category.folder ? "page" : undefined}
										className={`px-4 py-1.5 rounded-md text-sm font-medium ${folder === category.folder ? "bg-kumo-fill" : "text-kumo-subtle hover:bg-kumo-fill"}`}
										onClick={() => {
											if (folder === category.folder) return;
											setFolder(category.folder);
											setPage(1);
											setSelected(null);
										}}
									>
										{category.label}
									</button>
								))}
							</nav>
						</div>
						{list.error && (
							<LoadError
								title="Could not load emails"
								error={list.error}
								retry={() => void list.refetch()}
							/>
						)}
						<div
							className="flex-1 min-h-0 overflow-y-auto"
							data-testid="mail-list-scroll"
						>
							{list.isLoading ? (
								<div className="p-12 flex justify-center">
									<Loader />
								</div>
							) : (
								emails.map((email) => (
									<MailRow
										key={email.id}
										readOnly
										email={email}
										selected={selected === email.id}
										onOpen={() => setSelected(email.id)}
									/>
								))
							)}
							{!list.isLoading && !list.error && !emails.length && (
								<div className="px-6 py-20 text-center">
									<h2 className="font-medium">{folder === Folders.SPAM ? "Spam is empty" : "Inbox is empty"}</h2>
									<p className="mt-2 text-sm text-kumo-subtle">
										New emails will appear here when they arrive.
									</p>
								</div>
							)}
						</div>
						{count > PAGE_SIZE && (
							<div className="shrink-0 border-t border-kumo-line py-3 flex justify-center">
								<Pagination
									page={page}
									setPage={setPage}
									perPage={PAGE_SIZE}
									totalCount={count}
								/>
							</div>
						)}
					</section>
					<section
						className="mail-detail-pane"
						aria-label="Shared email content"
					>
						{selected ? (
							<PublicEmailPanel
								key={selected}
								token={token}
								emailId={selected}
								mailboxEmail={mailbox.email}
								onBack={() => setSelected(null)}
							/>
						) : (
							<div className="flex h-full flex-col items-center justify-center gap-3 text-kumo-subtle">
								<EnvelopeSimpleIcon size={40} weight="thin" />
								<h2 className="font-medium">Select an email</h2>
								<p className="text-sm">This shared inbox is read only.</p>
							</div>
						)}
					</section>
				</main>
			</div>
			<Dialog.Root open={navOpen} onOpenChange={setNavOpen}>
				<Dialog
					size="sm"
					className="p-0 rounded-none"
					style={{
						position: "fixed",
						inset: "0 auto 0 0",
						translate: "none",
						width: "min(288px, 90vw)",
						minWidth: 0,
						height: "100dvh",
						maxHeight: "none",
					}}
				>
					<Dialog.Title className="sr-only">Shared Inbox</Dialog.Title>
					<Button
						className="absolute right-1 top-1"
						variant="ghost"
						shape="square"
						aria-label="Close navigation"
						icon={<XIcon size={18} />}
						onClick={() => setNavOpen(false)}
					/>
					{sidebar}
				</Dialog>
			</Dialog.Root>
		</div>
	);
}
