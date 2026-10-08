import { Button, Dialog } from "@cloudflare/kumo";
import { XIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	Link,
	Outlet,
	useBeforeUnload,
	useBlocker,
	useLocation,
	useMatch,
} from "react-router";
import Sidebar from "~/components/Sidebar";
import Header from "~/components/Header";
import AgentSidebar from "~/components/AgentSidebar";
import ComposeEmail from "~/components/ComposeEmail";
import { MailboxContext } from "~/hooks/useMailboxContext";
import { confirmDiscardCompose, useUIStore } from "~/hooks/useUIStore";
import { useMailboxDirectory, WorkspaceContext } from "~/hooks/useWorkspace";

export default function WorkspaceRoute() {
	const mailboxId = useMatch("/mailbox/:mailboxId/*")?.params.mailboxId;
	const directory = useMailboxDirectory();
	const location = useLocation();
	const ui = useUIStore();
	const [chooseFor, setChooseFor] = useState<"compose" | "agent" | null>(null);
	const prevLocation = useRef(location.key);
	const blocker = useBlocker(
		({ currentLocation, nextLocation }) =>
			(ui.composeDirty || ui.composeBusy) &&
			(currentLocation.pathname !== nextLocation.pathname ||
				currentLocation.search !== nextLocation.search),
	);
	useEffect(() => {
		if (blocker.state !== "blocked") return;
		if (confirmDiscardCompose()) {
			useUIStore.getState().closePanel(true);
			blocker.proceed();
		} else blocker.reset();
	}, [blocker]);
	useBeforeUnload(
		useCallback((event) => {
			if (
				useUIStore.getState().composeDirty ||
				useUIStore.getState().composeBusy
			) {
				event.preventDefault();
				event.returnValue = "";
			}
		}, []),
	);
	useEffect(() => {
		if (prevLocation.current === location.key) return;
		prevLocation.current = location.key;
		// Navigation has already passed the router's leave guard.
		ui.closePanel(true);
		ui.closeSidebar();
		ui.closeAgentPanel();
	}, [location.key]);
	const openCompose = (id: string) => {
		if (
			location.pathname === "/manage" ||
			location.pathname.endsWith("/settings")
		)
			ui.openComposeModal({ mode: "new", mailboxId: id });
		else ui.startCompose({ mode: "new", mailboxId: id });
	};
	const compose = () => {
		if (mailboxId) openCompose(mailboxId);
		else setChooseFor("compose");
	};
	const agent = () => {
		const id = mailboxId || ui.selectedMailboxId;
		if (id) ui.openAgentPanel(id);
		else setChooseFor("agent");
	};
	return (
		<WorkspaceContext.Provider
			value={{ ...directory, mailboxId, compose, agent }}
		>
			<div className="flex h-dvh overflow-hidden bg-kumo-base">
				<div className="hidden md:flex shrink-0">
					<Sidebar />
				</div>
				<div className="flex min-w-0 flex-1 flex-col">
					<Header />
					<main className="flex-1 min-h-0 overflow-hidden">
						<Outlet />
					</main>
				</div>
			</div>
			<Dialog.Root
				open={ui.isSidebarOpen}
				onOpenChange={(open) => {
					if (!open) ui.closeSidebar();
				}}
			>
				<Dialog
					size="sm"
					className="p-0 rounded-none"
					style={{
						position: "fixed",
						inset: "0 auto 0 0",
						translate: "none",
						maxWidth: "none",
						width: "min(288px, 90vw)",
						minWidth: 0,
						height: "100dvh",
						maxHeight: "none",
					}}
				>
					<Dialog.Title className="sr-only">Inboxes</Dialog.Title>
					<Button
						variant="ghost"
						shape="square"
						icon={<XIcon size={18} />}
						aria-label="Close inbox navigation"
						onClick={ui.closeSidebar}
						className="absolute right-1 top-1 z-10"
					/>
					<Sidebar />
				</Dialog>
			</Dialog.Root>
			<Dialog.Root
				open={ui.isAgentPanelOpen}
				onOpenChange={(open) => {
					if (!open) ui.closeAgentPanel();
				}}
			>
				<Dialog
					className="p-0 rounded-none flex flex-col"
					style={{
						position: "fixed",
						inset: "0 0 0 auto",
						translate: "none",
						maxWidth: "none",
						width: "min(440px, 100vw)",
						minWidth: 0,
						height: "100dvh",
						maxHeight: "none",
					}}
				>
					<div className="flex items-center gap-2 px-4 py-3 border-b border-kumo-line">
						<Dialog.Title
							className="min-w-0 flex-1 text-sm truncate"
							title={ui.agentMailboxId || ""}
						>
							Agent · {ui.agentMailboxId}
						</Dialog.Title>
						<Button
							variant="ghost"
							shape="square"
							icon={<XIcon size={18} />}
							aria-label="Close Agent"
							onClick={ui.closeAgentPanel}
						/>
					</div>
					<div className="flex-1 min-h-0">
						{ui.isAgentPanelOpen && ui.agentMailboxId && (
							<MailboxContext.Provider value={ui.agentMailboxId}>
								<AgentSidebar key={ui.agentMailboxId} />
							</MailboxContext.Provider>
						)}
					</div>
				</Dialog>
			</Dialog.Root>
			<Dialog.Root
				open={chooseFor !== null}
				onOpenChange={(open) => {
					if (!open) setChooseFor(null);
				}}
			>
				<Dialog size="sm" className="p-5 max-w-[calc(100vw-2rem)]">
					<Dialog.Title className="font-semibold">
						{chooseFor === "agent"
							? "Choose an Agent mailbox"
							: "Choose the sending mailbox"}
					</Dialog.Title>
					<div className="max-h-72 overflow-y-auto mt-4 space-y-2">
						{directory.accounts.map((account) => (
							<Button
								key={account.id}
								variant="secondary"
								className="w-full justify-start truncate"
								onClick={() => {
									const purpose = chooseFor;
									setChooseFor(null);
									if (purpose === "agent") ui.openAgentPanel(account.id);
									else openCompose(account.id);
								}}
							>
								{account.email}
							</Button>
						))}
						{directory.accounts.length === 0 && (
							<Link
								to="/manage"
								onClick={() => setChooseFor(null)}
								className="text-kumo-link"
							>
								Create a mailbox first
							</Link>
						)}
					</div>
					<Button
						variant="ghost"
						onClick={() => setChooseFor(null)}
						className="mt-4"
					>
						Cancel
					</Button>
				</Dialog>
			</Dialog.Root>
			{ui.isComposeModalOpen && ui.composeMailboxId && (
				<MailboxContext.Provider value={ui.composeMailboxId}>
					<ComposeEmail />
				</MailboxContext.Provider>
			)}
		</WorkspaceContext.Provider>
	);
}
