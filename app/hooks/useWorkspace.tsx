import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "~/services/api";
import { useMailboxes } from "~/queries/mailboxes";
import { queryKeys } from "~/queries/keys";
import type { Mailbox } from "~/types";

interface Workspace {
	mailboxId?: string;
	accounts: Mailbox[];
	loading: boolean;
	error: string | null;
	retry: () => void;
	compose: () => void;
	agent: () => void;
}
export const WorkspaceContext = createContext<Workspace | null>(null);
export function useWorkspace() {
	const value = useContext(WorkspaceContext);
	if (!value) throw new Error("Private workspace required");
	return value;
}

/** The shell owns config-driven initialization once, not each mailbox view. */
export function useMailboxDirectory() {
	const client = useQueryClient();
	useEffect(
		() =>
			client.getMutationCache().subscribe((event) => {
				if (event.type !== "updated" || event.action.type !== "success") return;
				const variables = event.mutation.state.variables as
					| { mailboxId?: string; data?: { read?: boolean; starred?: boolean } }
					| undefined;
				if (
					variables?.mailboxId &&
					(!variables.data || variables.data.read !== undefined)
				) {
					// Directory counts are a shared cache; other mailbox email caches stay intact.
					void client.invalidateQueries({
						queryKey: queryKeys.mailboxes.all,
						exact: true,
					});
				}
			}),
		[client],
	);
	const mailboxes = useMailboxes();
	const config = useQuery({
		queryKey: queryKeys.config,
		queryFn: api.getConfig,
		staleTime: Infinity,
	});
	const initialized = useRef(false);
	const [creating, setCreating] = useState(false);
	const [initializationError, setInitializationError] = useState<string | null>(
		null,
	);
	const [attempt, setAttempt] = useState(0);
	useEffect(() => {
		if (initialized.current || !config.data || !mailboxes.data) return;
		initialized.current = true;
		const existing = new Set(mailboxes.data.map((m) => m.email.toLowerCase()));
		const missing = config.data.emailAddresses.filter(
			(email) => !existing.has(email.toLowerCase()),
		);
		if (!missing.length) {
			setInitializationError(null);
			setCreating(false);
			return;
		}
		setCreating(true);
		let cancelled = false;
		(async () => {
			try {
				for (const email of missing)
					await api.createMailbox(email, email.split("@")[0]);
				await mailboxes.refetch();
				if (!cancelled) setInitializationError(null);
			} catch (error) {
				if (!cancelled)
					setInitializationError(
						error instanceof Error
							? error.message
							: "Could not initialize mailboxes",
					);
			} finally {
				if (!cancelled) setCreating(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [config.data, !!mailboxes.data, attempt]);
	const accounts = config.data?.emailAddresses.length
		? config.data.emailAddresses.map(
				(email) =>
					mailboxes.data?.find(
						(m) => m.email.toLowerCase() === email.toLowerCase(),
					) ??
					({
						id: email,
						email,
						name: email.split("@")[0],
						unreadCount: 0,
					} as Mailbox),
			)
		: (mailboxes.data ?? []);
	const error =
		initializationError || (config.error || mailboxes.error)?.message || null;
	return {
		accounts,
		loading:
			config.isLoading ||
			mailboxes.isLoading ||
			creating ||
			(!!error && (config.isFetching || mailboxes.isFetching)),
		error,
		retry: () => {
			void Promise.all([config.refetch(), mailboxes.refetch()]).then(() => {
				// A first successful config/list retry initializes naturally. Only
				// restart the one-shot effect after an actual creation failure.
				if (initializationError) {
					initialized.current = false;
					setAttempt((n) => n + 1);
				}
			});
		},
	};
}
