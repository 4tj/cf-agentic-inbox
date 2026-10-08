// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useQuery } from "@tanstack/react-query";
import { searchParameters } from "~/lib/search-params";
import api from "~/services/api";
import type { Email } from "~/types";
import { queryKeys } from "./keys";

export const SEARCH_PAGE_SIZE = 25;

interface SearchResponse {
	emails: Email[];
	totalCount: number;
}

export function useSearchEmails(
	mailboxId: string | undefined,
	query: string,
	page: number,
) {
	return useQuery<{ results: Email[]; totalCount: number }>({
		queryKey: mailboxId && query
			? queryKeys.search.results(mailboxId, query, page)
			: ["search", "_disabled"],
		queryFn: async ({ signal }) => {
			const params = { ...searchParameters(query), page: String(page), limit: String(SEARCH_PAGE_SIZE) };
			const data = await api.searchEmails(mailboxId!, params, { signal }) as
				| SearchResponse
				| Email[];
			if (data && typeof data === "object" && "emails" in data) {
				return {
					results: (data as SearchResponse).emails ?? [],
					totalCount: (data as SearchResponse).totalCount ?? 0,
				};
			}
			const arr = Array.isArray(data) ? data : [];
			return { results: arr, totalCount: arr.length };
		},
		enabled: !!mailboxId && !!query,
	});
}
