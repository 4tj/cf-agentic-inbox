// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

export const DEFAULT_SHARE_HOST = "sharemail.shopless.pro";

interface ShareHostEnv {
	SHARE_HOST?: string;
}

function normalizedShareHost(env: ShareHostEnv): string {
	return (env.SHARE_HOST || DEFAULT_SHARE_HOST).trim().toLowerCase();
}

function isLocalhost(hostname: string): boolean {
	return hostname === "localhost" || hostname === "127.0.0.1";
}

function isPublicSharePath(pathname: string): boolean {
	return (
		pathname === "/s" ||
		pathname.startsWith("/s/") ||
		pathname === "/api/public/share" ||
		pathname.startsWith("/api/public/share/") ||
		pathname.startsWith("/assets/") ||
		pathname === "/favicon.svg" ||
		pathname === "/favicon.ico"
	);
}

export function isPublicShareRequestUrl(
	input: string | URL | Request,
	env: ShareHostEnv,
	options: { allowLocalDevelopment?: boolean } = {},
): boolean {
	const url =
		input instanceof Request
			? new URL(input.url)
			: input instanceof URL
				? input
				: new URL(input);
	const hostname = url.hostname.toLowerCase();
	const isShareHost =
		hostname === normalizedShareHost(env) ||
		(options.allowLocalDevelopment === true && isLocalhost(hostname));

	return isShareHost && isPublicSharePath(url.pathname);
}

export function buildShareUrl(token: string, env: ShareHostEnv): string {
	return `https://${normalizedShareHost(env)}/s/${token}`;
}
