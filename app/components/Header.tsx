// Copyright (c) 2026 Cloudflare, Inc. Apache-2.0
import { Button } from "@cloudflare/kumo";
import { GearSixIcon, ListIcon, RobotIcon } from "@phosphor-icons/react";
import { Link, useLocation } from "react-router";
import { useUIStore } from "~/hooks/useUIStore";
import { useWorkspace } from "~/hooks/useWorkspace";

export default function Header() {
	const { mailboxId, agent } = useWorkspace();
	const { toggleSidebar, isAgentPanelOpen, selectedMailboxId } = useUIStore();
	const location = useLocation();
	const settingsId = mailboxId || selectedMailboxId;
	return (
		<header className="flex h-14 shrink-0 items-center gap-3 px-3 border-b border-kumo-line bg-kumo-base md:px-5">
			<Button
				variant="ghost"
				shape="square"
				size="sm"
				icon={<ListIcon size={20} />}
				onClick={toggleSidebar}
				aria-label="Open inbox navigation"
				className="md:hidden"
			/>
			<div
				className="min-w-0 truncate text-xs text-kumo-subtle"
				title={mailboxId}
			>
				Mail /{" "}
				{location.pathname === "/manage"
					? "Manage mailboxes"
					: mailboxId || "All Inboxes"}
			</div>
			<div className="flex gap-2 ml-auto shrink-0">
				<Button
					variant={isAgentPanelOpen ? "secondary" : "ghost"}
					size="sm"
					icon={<RobotIcon size={18} />}
					onClick={agent}
					aria-label="Open Agent"
				>
					<span className="hidden sm:inline">Agent / MCP</span>
				</Button>
				{settingsId && (
					<Link
						to={`/mailbox/${encodeURIComponent(settingsId)}/settings`}
						aria-label={`Settings for ${settingsId}`}
						title={`Settings for ${settingsId}`}
						className="inline-flex items-center justify-center p-2 rounded-md hover:bg-kumo-tint"
					>
						<GearSixIcon size={18} />
					</Link>
				)}
			</div>
		</header>
	);
}
