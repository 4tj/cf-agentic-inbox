import { Button, Dialog, Input, Loader, Pagination } from "@cloudflare/kumo";
import {
	ArrowsClockwiseIcon,
	MagnifyingGlassIcon,
	XIcon,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { SYSTEM_FOLDER_IDS } from "shared/folders";
import { useWorkspace } from "~/hooks/useWorkspace";
import { useUIStore } from "~/hooks/useUIStore";
import { useAggregateEmails } from "~/hooks/useAggregateEmails";
import { useEmails, useMarkThreadRead, useUpdateEmail } from "~/queries/emails";
import { useSearchEmails } from "~/queries/search";
import { useCreateFolder, useFolders } from "~/queries/folders";
import { useMailbox } from "~/queries/mailboxes";
import { searchParameters } from "~/lib/search-params";
import type { ScopedEmail } from "~/lib/aggregate-feed";
import MailRow, { emailIsUnread } from "./MailRow";
import MailboxSplitView from "./MailboxSplitView";

const labels: Record<string, string> = {
	inbox: "Received mail",
	sent: "Sent mail",
	spam: "Spam",
	draft: "Drafts",
	archive: "Archive",
	trash: "Trash",
};

export default function MailList({ search = false }: { search?: boolean }) {
	const { mailboxId, folder = "inbox" } = useParams();
	const [params] = useSearchParams();
	const query = search ? params.get("q") || "" : "";
	return (
		<MailListView
			key={JSON.stringify([mailboxId, folder, search, query])}
			mailboxId={mailboxId}
			folder={folder}
			search={search}
			query={query}
		/>
	);
}

function MailListView({
	mailboxId,
	folder,
	search,
	query,
}: {
	mailboxId?: string;
	folder: string;
	search: boolean;
	query: string;
}) {
	const workspace = useWorkspace();
	const navigate = useNavigate();
	const ui = useUIStore();
	const [page, setPage] = useState(1);
	const [input, setInput] = useState(query);
	const [createOpen, setCreateOpen] = useState(false);
	const [folderName, setFolderName] = useState("");
	const [createError, setCreateError] = useState("");
	const scrollRef = useRef<HTMLDivElement>(null);
	const { data: mailbox, error: mailboxError } = useMailbox(mailboxId);
	const { data: folders = [] } = useFolders(mailboxId);
	const createFolder = useCreateFolder();
	const update = useUpdateEmail();
	const markThreadRead = useMarkThreadRead();
	const request = useMemo(
		() => (search ? searchParameters(query) : { folder }),
		[search, query, folder],
	);
	const aggregate = useAggregateEmails(
		workspace.accounts.map((m) => m.id),
		request,
		search,
		!mailboxId &&
			!workspace.loading &&
			!workspace.error &&
			(!search || !!query.trim()),
	);
	const single = useEmails(
		mailboxId,
		{ folder, page: String(page), limit: "25" },
		{ enabled: !search, refetchInterval: 30_000 },
	);
	const results = useSearchEmails(mailboxId, search ? query : "", page);
	const raw = search ? results.data?.results : single.data?.emails;
	const emails: ScopedEmail[] = mailboxId
		? (raw ?? []).map((email) => ({ ...email, mailboxId }))
		: aggregate.rows;
	const error =
		workspace.error ||
		mailboxError?.message ||
		(mailboxId
			? (search ? results.error : single.error)?.message
			: aggregate.error);
	const loading =
		workspace.loading ||
		(workspace.error || (search && !query.trim())
			? false
			: mailboxId
				? search
					? results.isFetching
					: single.isFetching
				: aggregate.loading);
	const count =
		(search ? results.data?.totalCount : single.data?.totalCount) ?? 0;
	const title = mailboxId
		? mailbox?.settings?.fromName || mailbox?.name || mailboxId
		: "All Inboxes";
	const folderLabel =
		labels[folder] || folders.find((f) => f.id === folder)?.name || folder;
	const searchFolder = request.folder || "All folders";
	useEffect(() => {
		if (aggregate.reloadVersion > 0) scrollRef.current?.scrollTo({ top: 0 });
	}, [aggregate.reloadVersion]);
	const folderPath = (id: string) =>
		mailboxId
			? `/mailbox/${encodeURIComponent(mailboxId)}/emails/${encodeURIComponent(id)}`
			: id === "inbox"
				? "/"
				: `/all/${id}`;
	const submitSearch = () => {
		if (input.trim())
			navigate(
				`${mailboxId ? `/mailbox/${encodeURIComponent(mailboxId)}` : ""}/search?q=${encodeURIComponent(input.trim())}`,
			);
	};
	const refresh = () => {
		if (workspace.error) {
			workspace.retry();
			return;
		}
		if (!mailboxId) void aggregate.reload();
		else {
			void (search ? results.refetch() : single.refetch());
		}
	};
	const openEmail = (email: ScopedEmail) => {
		if (!ui.selectEmail(email.id, email.mailboxId)) return;
		if (emailIsUnread(email)) {
			if (!search && email.thread_id && (email.thread_count ?? 1) > 1)
				markThreadRead.mutate({
					mailboxId: email.mailboxId,
					threadId: email.thread_id,
				});
			else
				update.mutate({
					mailboxId: email.mailboxId,
					id: email.id,
					data: { read: true },
				});
		}
	};
	return (
		<MailboxSplitView
			selectedEmailId={ui.selectedEmailId}
			isComposing={ui.isComposing}
		>
			<div className="shrink-0 px-5 pt-5 pb-4 border-b border-kumo-line">
				<div className="flex items-center gap-2">
					<h1 className="text-xl font-semibold truncate flex-1" title={title}>
						{title}
					</h1>
					<Button
						variant="ghost"
						shape="square"
						size="sm"
						icon={
							<ArrowsClockwiseIcon
								size={17}
								className={loading ? "animate-spin" : ""}
							/>
						}
						onClick={refresh}
						disabled={loading}
						aria-label="Refresh emails"
					/>
				</div>
				<div
					className="text-xs text-kumo-subtle mt-1 mb-5 break-all"
					title={mailboxId}
				>
					{mailboxId || `${workspace.accounts.length} inboxes`} ·{" "}
					{search ? `Search results · ${searchFolder}` : folderLabel}
				</div>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						submitSearch();
					}}
					className="relative flex items-center"
				>
					<Input
						className="w-full"
						aria-label="Search emails"
						placeholder={
							mailboxId ? "Search this mailbox…" : "Search all inboxes…"
						}
						value={input}
						onChange={(event) => setInput(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Escape") {
								setInput("");
								if (search) navigate(folderPath("inbox"));
							}
						}}
					/>
					{input ? (
						<button
							type="button"
							aria-label="Clear search"
							className="absolute right-3 text-kumo-subtle"
							onClick={() => {
								setInput("");
								if (search) navigate(folderPath("inbox"));
							}}
						>
							<XIcon size={15} />
						</button>
					) : (
						<MagnifyingGlassIcon
							className="absolute right-3 text-kumo-subtle pointer-events-none"
							size={16}
						/>
					)}
				</form>
				<div className="flex items-center gap-2 mt-4">
					<nav
						aria-label="Email categories"
						className="inline-flex bg-kumo-fill/60 p-1 rounded-lg gap-0.5"
					>
						{[
							["inbox", "All"],
							["sent", "Send"],
							["spam", "Spam"],
						].map(([id, label]) => (
							<Link
								key={id}
								to={folderPath(id)}
								aria-current={!search && folder === id ? "page" : undefined}
								className={`px-3 py-1 rounded-md text-sm ${!search && folder === id ? "bg-kumo-base shadow-sm font-medium" : "text-kumo-subtle hover:text-kumo-default"}`}
							>
								{label}
							</Link>
						))}
					</nav>
					<select
						aria-label="More folders"
						value=""
						className="ml-auto min-w-0 w-20 bg-transparent text-xs text-kumo-subtle p-1"
						onChange={(event) => {
							if (event.target.value === "create") setCreateOpen(true);
							else if (event.target.value)
								navigate(folderPath(event.target.value));
						}}
					>
						<option value="">More</option>
						{["draft", "archive", "trash"].map((id) => (
							<option key={id} value={id}>
								{labels[id]}
							</option>
						))}
						{folders
							.filter(
								(f) => !(SYSTEM_FOLDER_IDS as readonly string[]).includes(f.id),
							)
							.map((f) => (
								<option value={f.id} key={f.id}>
									{f.name}
								</option>
							))}
						{mailboxId && <option value="create">New folder…</option>}
					</select>
				</div>
			</div>
			{error && (
				<div
					role="alert"
					className="p-4 text-sm border-b border-kumo-line bg-kumo-recessed"
				>
					<p className="font-medium">
						{!mailboxId ? "List not fully loaded" : "Could not load emails"}
					</p>
					<p className="text-xs mt-1 break-words text-kumo-subtle">{error}</p>
					{emails.length > 0 && (
						<p className="text-xs mt-1">
							Previously loaded messages may be out of date.
						</p>
					)}
					<Button
						size="sm"
						variant="secondary"
						onClick={refresh}
						disabled={loading}
						className="mt-2"
					>
						{mailboxId ? "Retry" : "Reload list"}
					</Button>
				</div>
			)}
			{!mailboxId && aggregate.reloadVersion > 0 && !error && (
				<div role="status" className="px-5 py-2 text-xs text-kumo-subtle">
					List reloaded
				</div>
			)}
			<div
				ref={scrollRef}
				className="flex-1 min-h-0 overflow-y-auto"
				data-testid="mail-list-scroll"
			>
				{loading && emails.length === 0 ? (
					<div className="flex justify-center p-12">
						<Loader />
					</div>
				) : (
					emails.map((email) => (
						<MailRow
							key={JSON.stringify([email.mailboxId, email.id])}
							email={email}
							selected={
								ui.selectedEmailId === email.id &&
								ui.selectedMailboxId === email.mailboxId
							}
							mailboxLabel={!mailboxId ? email.mailboxId : undefined}
							onOpen={() => openEmail(email)}
							onToggleStar={() =>
								update.mutate({
									mailboxId: email.mailboxId,
									id: email.id,
									data: { starred: !email.starred },
								})
							}
						/>
					))
				)}
				{!loading && !error && emails.length === 0 && (
					<div className="px-6 py-20 text-center">
						<h2 className="font-medium">
							{workspace.accounts.length === 0
								? "No mailboxes yet"
								: search
									? query
										? "No results found"
										: "Search your emails"
									: folder === "draft"
										? "No drafts"
										: "No emails"}
						</h2>
						<p className="mt-2 text-sm text-kumo-subtle">
							{search
								? "Try keywords, from:name, in:inbox or is:unread."
								: `Messages in ${folderLabel.toLowerCase()} will appear here.`}
						</p>
						{workspace.accounts.length === 0 && (
							<Link to="/manage" className="inline-block mt-4 text-kumo-link">
								Create a mailbox
							</Link>
						)}
					</div>
				)}
			</div>
			{mailboxId
				? count > 25 && (
						<div className="shrink-0 border-t border-kumo-line py-3 flex justify-center">
							<Pagination
								page={page}
								setPage={setPage}
								perPage={25}
								totalCount={count}
							/>
						</div>
					)
				: !error &&
					!workspace.loading &&
					workspace.accounts.length > 0 &&
					(!search || !!query) && (
						<div className="shrink-0 border-t border-kumo-line px-5 py-2 flex justify-between items-center gap-2 text-xs text-kumo-subtle">
							<span>
								{emails.length} {search ? "messages" : "conversations"}
							</span>
							{aggregate.hasMore ? (
								<Button
									size="sm"
									variant="ghost"
									onClick={() => void aggregate.loadMore()}
									disabled={loading}
								>
									{loading ? "Loading…" : "Load more"}
								</Button>
							) : (
								<span>No more messages</span>
							)}
						</div>
					)}
			<Dialog.Root open={createOpen} onOpenChange={setCreateOpen}>
				<Dialog size="sm" className="p-5">
					<Dialog.Title className="font-semibold">New folder</Dialog.Title>
					<form
						className="mt-4 space-y-4"
						onSubmit={async (event) => {
							event.preventDefault();
							if (!mailboxId || !folderName.trim()) return;
							setCreateError("");
							try {
								await createFolder.mutateAsync({
									mailboxId,
									name: folderName.trim(),
								});
								setCreateOpen(false);
								setFolderName("");
							} catch (error) {
								setCreateError(
									error instanceof Error
										? error.message
										: "Could not create folder",
								);
							}
						}}
					>
						<Input
							label="Folder name"
							required
							value={folderName}
							onChange={(event) => setFolderName(event.target.value)}
						/>
						{createError && <p role="alert">{createError}</p>}
						<div className="flex justify-end gap-2">
							<Button
								type="button"
								variant="ghost"
								onClick={() => setCreateOpen(false)}
							>
								Cancel
							</Button>
							<Button type="submit" loading={createFolder.isPending}>
								Create
							</Button>
						</div>
					</form>
				</Dialog>
			</Dialog.Root>
		</MailboxSplitView>
	);
}
