// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import {
	Button,
	Dialog,
	Input,
	Table,
	Text,
	Tooltip,
	useKumoToastManager,
} from "@cloudflare/kumo";
import { InfoIcon, PlusIcon } from "@phosphor-icons/react";
import { type FormEvent, useState } from "react";
import { useBindDomain, useUnbindDomain } from "~/queries/domains";
import { DomainRow } from "~/components/DomainRow";

/**
 * Domain management dialog: bind a new domain, and review / toggle
 * subaddressing / unbind the ones already bound.
 *
 * The list lives here rather than on the Mailboxes page so a long list of
 * domains never pushes the mailboxes themselves below the fold.
 */
export function DomainsDialog({
	open,
	onOpenChange,
	domains,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	domains: string[];
}) {
	const toastManager = useKumoToastManager();
	const bindDomain = useBindDomain();
	const unbindDomain = useUnbindDomain();

	const [isBindFormOpen, setIsBindFormOpen] = useState(false);
	const [newDomain, setNewDomain] = useState("");
	const [isBinding, setIsBinding] = useState(false);
	const [bindError, setBindError] = useState<string | null>(null);
	const [domainToUnbind, setDomainToUnbind] = useState<string | null>(null);
	const [isUnbinding, setIsUnbinding] = useState(false);

	const closeBindForm = () => {
		setIsBindFormOpen(false);
		setNewDomain("");
		setBindError(null);
	};

	const handleBind = async (e: FormEvent) => {
		e.preventDefault();
		setBindError(null);
		const domain = newDomain.trim().toLowerCase();
		if (!domain) {
			setBindError("Please enter a domain");
			return;
		}
		setIsBinding(true);
		try {
			await bindDomain.mutateAsync(domain);
			toastManager.add({ title: `Domain ${domain} bound successfully!` });
			closeBindForm();
		} catch (err: unknown) {
			const message =
				(err instanceof Error ? err.message : null) || "Failed to bind domain";
			setBindError(message);
		} finally {
			setIsBinding(false);
		}
	};

	const handleUnbind = async () => {
		if (!domainToUnbind) return;
		setIsUnbinding(true);
		try {
			await unbindDomain.mutateAsync(domainToUnbind);
			toastManager.add({ title: `Domain ${domainToUnbind} unbound` });
			setDomainToUnbind(null);
		} catch {
			toastManager.add({ title: "Failed to unbind domain", variant: "error" });
		} finally {
			setIsUnbinding(false);
		}
	};

	return (
		<>
			<Dialog.Root
				open={open}
				onOpenChange={(next) => {
					onOpenChange(next);
					if (!next) closeBindForm();
				}}
			>
				<Dialog size="lg" className="p-6">
					<Dialog.Title className="text-base font-semibold mb-2">
						Domains
					</Dialog.Title>
					<Dialog.Description className="text-kumo-subtle text-sm mb-4">
						Bind a domain in your Cloudflare account and its Email Routing and
						Sending are configured automatically.
					</Dialog.Description>

					{isBindFormOpen ? (
						<form onSubmit={handleBind} className="mb-3 flex items-center gap-2">
							<div className="flex-1">
								<Input
									aria-label="Domain"
									placeholder="example.com"
									size="sm"
									className="w-full"
									value={newDomain}
									onChange={(e) => setNewDomain(e.target.value)}
									autoFocus
									required
								/>
							</div>
							<Button
								type="submit"
								variant="primary"
								size="sm"
								loading={isBinding}
								disabled={isBinding}
							>
								Bind
							</Button>
							<Button
								type="button"
								variant="secondary"
								size="sm"
								onClick={closeBindForm}
								disabled={isBinding}
							>
								Cancel
							</Button>
						</form>
					) : (
						<div className="mb-3 flex justify-end">
							<Button
								variant="secondary"
								size="sm"
								icon={<PlusIcon size={14} />}
								onClick={() => setIsBindFormOpen(true)}
							>
								Bind Domain
							</Button>
						</div>
					)}

					{bindError && (
						<div className="mb-3">
							<Text variant="error" size="sm">
								{bindError}
							</Text>
						</div>
					)}

					<div className="h-72 overflow-y-auto rounded-lg border border-kumo-line">
						{domains.length === 0 ? (
							<div className="flex h-full items-center justify-center px-6 text-center text-sm text-kumo-subtle">
								No domains bound yet.
							</div>
						) : (
							<Table>
								<Table.Header className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10">
									<Table.Row>
										<Table.Head>Domain</Table.Head>
										<Table.Head>
											<span className="inline-flex items-center gap-1">
												Subaddressing
												<Tooltip content="Deliver mail sent to name+detail@domain into the name@domain mailbox. Toggles the Cloudflare Email Routing setting for that zone.">
													<InfoIcon size={14} className="text-kumo-subtle" />
												</Tooltip>
											</span>
										</Table.Head>
										<Table.Head>
											<span className="sr-only">Actions</span>
										</Table.Head>
									</Table.Row>
								</Table.Header>
								<Table.Body>
									{domains.map((d) => (
										<DomainRow
											key={d}
											domain={d}
											onUnbind={() => setDomainToUnbind(d)}
										/>
									))}
								</Table.Body>
							</Table>
						)}
					</div>

					<div className="flex justify-end pt-4">
						<Dialog.Close
							render={(props) => (
								<Button {...props} variant="secondary" size="sm">
									Close
								</Button>
							)}
						/>
					</div>
				</Dialog>
			</Dialog.Root>

			{/* Unbind confirmation, stacked on top of the domains dialog */}
			<Dialog.Root
				open={domainToUnbind !== null}
				onOpenChange={(next) => {
					if (!next) setDomainToUnbind(null);
				}}
			>
				<Dialog size="sm" className="p-6">
					<Dialog.Title className="text-base font-semibold mb-2">
						Unbind Domain
					</Dialog.Title>
					<Dialog.Description className="text-kumo-subtle text-sm mb-5">
						Remove{" "}
						<strong className="text-kumo-default">{domainToUnbind}</strong> from
						this inbox? Its Cloudflare Email Routing and Sending configuration is
						left unchanged — you can re-bind it later.
					</Dialog.Description>
					<div className="flex justify-end gap-2">
						<Dialog.Close
							render={(props) => (
								<Button {...props} variant="secondary" size="sm">
									Cancel
								</Button>
							)}
						/>
						<Button
							variant="destructive"
							size="sm"
							loading={isUnbinding}
							onClick={handleUnbind}
						>
							Unbind
						</Button>
					</div>
				</Dialog>
			</Dialog.Root>
		</>
	);
}
