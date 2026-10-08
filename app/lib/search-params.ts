import { parseSearchQuery } from "./search-parser";
/** Same mailbox search semantics for single and aggregate views. */
export function searchParameters(query: string): Record<string, string> {
	const parsed = parseSearchQuery(query);
	const params: Record<string, string> = {};
	for (const field of [
		"query",
		"from",
		"to",
		"subject",
		"folder",
		"date_start",
		"date_end",
	] as const) {
		if (parsed[field]) params[field] = parsed[field];
	}
	if (parsed.is_read !== undefined) params.is_read = String(parsed.is_read);
	if (parsed.is_starred !== undefined)
		params.is_starred = String(parsed.is_starred);
	if (parsed.has_attachment) params.has_attachment = "true";
	return params;
}
