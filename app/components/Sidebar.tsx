// Copyright (c) 2026 Cloudflare, Inc. Apache-2.0
import { Button } from "@cloudflare/kumo";
import {
	GearSixIcon,
	GlobeIcon,
	PencilSimpleIcon,
} from "@phosphor-icons/react";
import { Link, useLocation, useParams } from "react-router";
import InboxNavigation from "./InboxNavigation";
import { useWorkspace } from "~/hooks/useWorkspace";
import { useUIStore } from "~/hooks/useUIStore";

export default function Sidebar() {
	const { accounts, mailboxId, compose } = useWorkspace();
	const { folder } = useParams();
	const location = useLocation();
	const closeSidebar = useUIStore((s) => s.closeSidebar);
	const category = ["inbox", "sent", "spam"].includes(folder || "")
		? folder!
		: "inbox";
	return (
		<InboxNavigation
			items={accounts.map((account) => ({
				...account,
				to: `/mailbox/${encodeURIComponent(account.id)}/emails/${category}`,
			}))}
			activeId={
				location.pathname === "/manage" ? undefined : mailboxId || "all"
			}
			allTo={category === "inbox" ? "/" : `/all/${category}`}
			onNavigate={closeSidebar}
			compose={
				<Button
					variant="primary"
					icon={<PencilSimpleIcon size={16} />}
					onClick={compose}
					className="w-full"
				>
					Compose
				</Button>
			}
			footer={
				<>
					<Link
						to="/manage?domains=1"
						onClick={closeSidebar}
						className="inbox-nav-item text-sm"
					>
						<GlobeIcon size={18} />
						Domains
					</Link>
					<Link
						to="/manage"
						onClick={closeSidebar}
						className="inbox-nav-item text-sm"
					>
						<GearSixIcon size={18} />
						Manage mailboxes
					</Link>
				</>
			}
		/>
	);
}
