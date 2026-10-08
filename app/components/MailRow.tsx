import { StarIcon } from "@phosphor-icons/react";
import { formatListDate } from "shared/dates";
import { getSnippetText } from "~/lib/utils";
import type { Email } from "~/types";

export function emailIsUnread(email: Email) {
	return email.thread_unread_count !== undefined
		? email.thread_unread_count > 0
		: !email.read;
}
export default function MailRow({
	email,
	selected,
	mailboxLabel,
	onOpen,
	onToggleStar,
	readOnly = false,
}: {
	email: Email;
	selected: boolean;
	mailboxLabel?: string;
	onOpen: () => void;
	onToggleStar?: () => void;
	readOnly?: boolean;
}) {
	const unread = emailIsUnread(email);
	const names = [
		...new Set(
			(email.participants || email.sender)
				.split(",")
				.map((name) => name.trim().split("@")[0]),
		),
	];
	const sender =
		names.length > 3
			? `${names.slice(0, 2).join(", ")} +${names.length - 2}`
			: names.join(", ");
	return (
		<div
			role="button"
			tabIndex={0}
			aria-label={`${email.subject || "(no subject)"}${mailboxLabel ? ` · ${mailboxLabel}` : ""}`}
			aria-pressed={selected}
			data-mailbox={mailboxLabel}
			data-email-id={email.id}
			onClick={onOpen}
			onKeyDown={(event) => {
				if (
					event.target === event.currentTarget &&
					(event.key === "Enter" || event.key === " ")
				) {
					event.preventDefault();
					onOpen();
				}
			}}
			className={`mail-row ${selected ? "is-selected" : ""}`}
		>
			<span className="w-2 shrink-0 pt-3">
				{unread && (
					<span className="block w-1.5 h-1.5 rounded-full bg-kumo-brand" />
				)}
			</span>
			<div
				className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-kumo-fill text-xs font-semibold text-kumo-strong"
				aria-hidden="true"
			>
				{sender.slice(0, 2).toUpperCase()}
			</div>
			<div className="flex-1 min-w-0">
				<div className="flex items-center gap-2">
					<span
						className={`truncate text-sm ${unread ? "font-semibold" : "font-medium"}`}
					>
						{sender}
					</span>
					{!readOnly && (email.thread_count ?? 1) > 1 && (
						<span className="text-xs text-kumo-subtle">
							{email.thread_count}
						</span>
					)}
					<time className="ml-auto shrink-0 text-xs text-kumo-subtle">
						{formatListDate(email.date)}
					</time>
				</div>
				<div
					className={`truncate mt-1 text-sm ${unread ? "font-medium" : "text-kumo-strong"}`}
				>
					{email.subject || "(no subject)"}
				</div>
				<div className="truncate text-xs text-kumo-subtle mt-1 leading-relaxed">
					{getSnippetText(email.snippet)}
				</div>
				{!readOnly && (email.has_draft || email.needs_reply) && (
					<span className="inline-block text-xs mt-2 px-1.5 rounded border border-kumo-line text-kumo-subtle">
						{email.has_draft ? "Draft" : "Needs reply"}
					</span>
				)}
				{mailboxLabel && (
					<div
						className="truncate text-xs text-kumo-subtle mt-2"
						title={mailboxLabel}
					>
						{mailboxLabel}
					</div>
				)}
			</div>
			{onToggleStar && (
				<button
					type="button"
					className="shrink-0 self-start mt-0.5 text-kumo-subtle hover:text-kumo-warning"
					aria-label={email.starred ? "Unstar email" : "Star email"}
					onClick={(event) => {
						event.stopPropagation();
						onToggleStar();
					}}
				>
					<StarIcon
						size={15}
						weight={email.starred ? "fill" : "regular"}
						className={email.starred ? "text-kumo-warning" : ""}
					/>
				</button>
			)}
		</div>
	);
}
