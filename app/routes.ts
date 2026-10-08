// Copyright (c) 2026 Cloudflare, Inc. Apache-2.0
import { index, layout, route, type RouteConfig } from "@react-router/dev/routes";

export default [
	route("s/:token", "routes/public-share.tsx"),
	layout("routes/workspace.tsx", [
		index("routes/all-inboxes.tsx"),
		route("all/:folder", "routes/all-folder.tsx"),
		route("search", "routes/all-search.tsx"),
		route("manage", "routes/home.tsx"),
		route("mailbox/:mailboxId", "routes/mailbox.tsx", [
			index("routes/mailbox-index.tsx"),
			route("emails/:folder", "routes/email-list.tsx"),
			route("settings", "routes/settings.tsx"),
			route("search", "routes/search-results.tsx"),
		]),
	]),
	route("*", "routes/not-found.tsx"),
] satisfies RouteConfig;
