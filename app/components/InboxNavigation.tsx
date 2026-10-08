import type { ReactNode } from "react";
import { Link } from "react-router";
import { EnvelopeIcon, TrayIcon } from "@phosphor-icons/react";

interface Item {
	id: string;
	email: string;
	to?: string;
	unreadCount?: number;
}
/** Presentation only: safe to reuse with a single public mailbox, no private hooks. */
export default function InboxNavigation({
	items,
	activeId,
	allTo,
	compose,
	footer,
	readOnly = false,
	onNavigate,
}: {
	items: Item[];
	activeId?: string;
	allTo?: string;
	compose?: ReactNode;
	footer?: ReactNode;
	readOnly?: boolean;
	onNavigate?: () => void;
}) {
	return (
		<aside
			className="inbox-sidebar"
			aria-label={readOnly ? "Shared inbox" : "Inboxes"}
		>
			<div className="flex items-center gap-2.5 px-3 pb-6 text-lg font-semibold tracking-tight">
				<TrayIcon size={24} />
				Agentic Inbox
			</div>
			{compose && <div className="pb-5">{compose}</div>}
			{allTo && (
				<Link
					to={allTo}
					onClick={onNavigate}
					aria-current={activeId === "all" ? "page" : undefined}
					className={`inbox-nav-item ${activeId === "all" ? "is-active" : ""}`}
				>
					<TrayIcon size={19} />
					<span>All Inboxes</span>
				</Link>
			)}
			<div className="px-3 pt-6 pb-2 text-xs font-semibold uppercase tracking-wider text-kumo-subtle">
				{readOnly ? "Shared Inbox" : "Inboxes"}
			</div>
			<nav
				className="min-h-0 flex-1 overflow-y-auto"
				aria-label={readOnly ? "Shared mailbox" : "Mailboxes"}
			>
				{items.map((item) => {
					const content = (
						<>
							<EnvelopeIcon size={18} className="shrink-0" />
							<span className="min-w-0 break-all flex-1" title={item.email}>
								{item.email}
							</span>
							{!readOnly && (item.unreadCount ?? 0) > 0 && (
								<span
									className="text-xs bg-kumo-fill px-1.5 rounded"
									aria-label={`${item.unreadCount} unread messages`}
								>
									{item.unreadCount}
								</span>
							)}
						</>
					);
					const className = `inbox-nav-item text-xs ${activeId === item.id ? "is-active" : ""}`;
					return item.to ? (
						<Link
							key={item.id}
							to={item.to}
							onClick={onNavigate}
							aria-current={activeId === item.id ? "page" : undefined}
							className={className}
						>
							{content}
						</Link>
					) : (
						<div key={item.id} className={className}>
							{content}
						</div>
					);
				})}
			</nav>
			<div className="pt-4 mt-4 border-t border-kumo-line">
				{readOnly ? (
					<span className="text-xs text-kumo-subtle">
						Read only · One shared inbox
					</span>
				) : (
					footer
				)}
			</div>
		</aside>
	);
}
