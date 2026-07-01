// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "~/services/api";
import type { DomainEntry } from "~/services/api";
import { queryKeys } from "./keys";

export function useDomains() {
	return useQuery<DomainEntry[]>({
		queryKey: queryKeys.domains,
		queryFn: () => api.listDomains(),
	});
}

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
