// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Loader, Switch, Table, Text, useKumoToastManager } from "@cloudflare/kumo";
import { XIcon } from "@phosphor-icons/react";
import { useSetSubaddressing, useSubaddressing } from "~/queries/domains";

/**
 * One bound domain as a table row, with its Cloudflare subaddressing switch.
 *
 * Its own component because the subaddressing state is one query per domain,
 * and hooks cannot be called inside the `domains.map()` loop.
 */
export function DomainRow({
	domain,
	onUnbind,
}: {
	domain: string;
	onUnbind: () => void;
}) {
	const toastManager = useKumoToastManager();
	const { data, isPending, isError, error } = useSubaddressing(domain);
	const setSubaddressing = useSetSubaddressing();

	const handleToggle = async (enabled: boolean) => {
		try {
			await setSubaddressing.mutateAsync({ domain, enabled });
			toastManager.add({
				title: `Subaddressing ${enabled ? "enabled" : "disabled"} for ${domain}`,
			});
		} catch (err: unknown) {
			const message =
				(err instanceof Error ? err.message : null) ||
				"Failed to update subaddressing";
			toastManager.add({ title: message, variant: "error" });
		}
	};

	return (
		<Table.Row>
			<Table.Cell className="text-sm text-kumo-default">{domain}</Table.Cell>
			<Table.Cell>
				{isPending ? (
					<Loader size="sm" />
				) : isError ? (
					// Surface the Cloudflare failure instead of rendering an "off"
					// switch that would misreport the zone's real state.
					<Text variant="error" size="sm">
						{(error as Error)?.message || "unavailable"}
					</Text>
				) : (
					<Switch
						size="sm"
						aria-label={`Subaddressing for ${domain}`}
						checked={data?.enabled ?? false}
						disabled={setSubaddressing.isPending}
						transitioning={setSubaddressing.isPending}
						onCheckedChange={handleToggle}
					/>
				)}
			</Table.Cell>
			<Table.Cell className="text-right">
				<Button
					variant="ghost"
					size="sm"
					shape="square"
					icon={<XIcon size={14} />}
					aria-label={`Unbind ${domain}`}
					onClick={onUnbind}
				/>
			</Table.Cell>
		</Table.Row>
	);
}
