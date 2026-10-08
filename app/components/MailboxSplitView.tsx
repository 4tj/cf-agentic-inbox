// Copyright (c) 2026 Cloudflare, Inc. Apache-2.0
import type { ReactNode } from "react";
import { EnvelopeIcon } from "@phosphor-icons/react";
import ComposePanel from "./ComposePanel";
import EmailPanel from "./EmailPanel";
import { MailboxContext } from "~/hooks/useMailboxContext";
import { useUIStore } from "~/hooks/useUIStore";

export default function MailboxSplitView({
	selectedEmailId,
	isComposing,
	children,
}: {
	selectedEmailId: string | null;
	isComposing: boolean;
	children: ReactNode;
}) {
	const { selectedMailboxId, composeMailboxId } = useUIStore();
	const open = selectedEmailId !== null || isComposing;
	return (
		<div className={`mail-split ${open ? "detail-open" : ""}`}>
			<section className="mail-list-pane" aria-label="Email list">
				{children}
			</section>
			<section className="mail-detail-pane" aria-label="Email content">
				{isComposing && composeMailboxId ? (
					<MailboxContext.Provider value={composeMailboxId}>
						<div className="flex flex-col h-full overflow-y-auto">
							<ComposePanel key={composeMailboxId} />
							{selectedEmailId && selectedMailboxId === composeMailboxId && (
								<div className="border-t border-kumo-line">
									<EmailPanel
										key={`${selectedMailboxId}/${selectedEmailId}`}
										emailId={selectedEmailId}
									/>
								</div>
							)}
						</div>
					</MailboxContext.Provider>
				) : selectedEmailId && selectedMailboxId ? (
					<MailboxContext.Provider value={selectedMailboxId}>
						<EmailPanel
							key={`${selectedMailboxId}/${selectedEmailId}`}
							emailId={selectedEmailId}
						/>
					</MailboxContext.Provider>
				) : (
					<div className="flex h-full flex-col items-center justify-center text-kumo-subtle gap-3 px-5">
						<EnvelopeIcon size={40} weight="thin" />
						<h2 className="text-base font-medium">Select an email</h2>
						<p className="text-sm text-center">
							Choose a conversation from the list.
						</p>
					</div>
				)}
			</section>
		</div>
	);
}
