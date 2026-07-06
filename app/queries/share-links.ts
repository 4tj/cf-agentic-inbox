// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "~/services/api";
import { queryKeys } from "./keys";

export function useMailboxShareLink(mailboxId: string | undefined) {
	return useQuery({
		queryKey: mailboxId
			? queryKeys.mailboxes.shareLink(mailboxId)
			: ["mailboxes", "_disabled_share_link"],
		queryFn: () => api.getMailboxShareLink(mailboxId!),
		enabled: !!mailboxId,
	});
}

export function useResetMailboxShareLink() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (mailboxId: string) => api.resetMailboxShareLink(mailboxId),
		onSuccess: (data, mailboxId) => {
			qc.setQueryData(queryKeys.mailboxes.shareLink(mailboxId), data);
		},
	});
}
