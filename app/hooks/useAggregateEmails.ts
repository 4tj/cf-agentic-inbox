import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AggregateFeed, type SourcePage } from "~/lib/aggregate-feed";
import api from "~/services/api";

export function useAggregateEmails(
	ids: string[],
	params: Record<string, string>,
	search: boolean,
	enabled: boolean,
) {
	const client = useQueryClient();
	const key = JSON.stringify([ids.slice().sort(), params, search]);
	const feed = useMemo(
		() =>
			new AggregateFeed(ids, async (id, page, signal) => {
				const query = { ...params, page: String(page), limit: "25" };
				const response = search
					? await api.searchEmails(id, query, { signal })
					: await api.listEmails(
							id,
							{ ...query, threaded: "true" },
							{ signal },
						);
				if (Array.isArray(response))
					return { emails: response, totalCount: response.length };
				return response as SourcePage;
				// A new scope owns its own feed: old responses cannot reach the new snapshot.
			}),
		[key],
	);
	const state = useSyncExternalStore(
		feed.subscribe,
		feed.getSnapshot,
		feed.getSnapshot,
	);
	useEffect(() => {
		if (!enabled) return;
		void feed.reload(false);
		return () => feed.dispose();
	}, [feed, enabled]);
	useEffect(() => {
		if (!enabled) return;
		return client.getMutationCache().subscribe((event) => {
			if (event.type !== "updated" || event.action.type !== "success") return;
			const variables = event.mutation.state.variables as
				| {
						mailboxId?: string;
						id?: string;
						threadId?: string;
						data?: { read?: boolean; starred?: boolean };
				  }
				| undefined;
			if (!variables?.mailboxId || !ids.includes(variables.mailboxId)) return;
			const { mailboxId, id, threadId, data } = variables;
			if (
				!(
					search &&
					(params.is_read !== undefined || params.is_starred !== undefined)
				) &&
				(threadId || (id && data))
			) {
				feed.patch((row) => {
					if (row.mailboxId !== mailboxId) return row;
					if (threadId && row.thread_id === threadId)
						return { ...row, read: true, thread_unread_count: 0 };
					if (id !== row.id || !data) return row;
					const count = row.thread_unread_count;
					return {
						...row,
						...data,
						...(count !== undefined &&
						data.read !== undefined &&
						data.read !== row.read
							? {
									thread_unread_count: Math.max(
										0,
										count + (data.read ? -1 : 1),
									),
								}
							: {}),
					};
				});
			} else if (!feed.getSnapshot().error) void feed.reload(false);
		});
	}, [client, feed, enabled, key]);
	return {
		...state,
		reload: () => feed.reload(),
		loadMore: () => feed.loadMore(),
	};
}
