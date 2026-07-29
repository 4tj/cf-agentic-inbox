// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "~/services/api";
import { queryKeys } from "./keys";

export function useBindDomain() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (domain: string) => api.bindDomain(domain),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: queryKeys.domains });
			qc.invalidateQueries({ queryKey: queryKeys.config });
		},
	});
}

export function useUnbindDomain() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (domain: string) => api.unbindDomain(domain),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: queryKeys.domains });
			qc.invalidateQueries({ queryKey: queryKeys.config });
		},
	});
}

/**
 * Live `support_subaddress` state for a domain, read straight from Cloudflare.
 * Not cached in R2 on purpose — the Cloudflare dashboard can flip it too.
 */
export function useSubaddressing(domain: string) {
	return useQuery({
		queryKey: queryKeys.subaddressing(domain),
		queryFn: () => api.getSubaddressing(domain),
		enabled: Boolean(domain),
		retry: false,
	});
}

export function useSetSubaddressing() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ domain, enabled }: { domain: string; enabled: boolean }) =>
			api.setSubaddressing(domain, enabled),
		onSuccess: (result) => {
			qc.setQueryData(queryKeys.subaddressing(result.domain), result);
		},
	});
}
