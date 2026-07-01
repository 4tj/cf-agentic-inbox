// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/** Global store for domains bound to this inbox, kept in a single R2 object. */

export interface DomainEntry {
	domain: string;
	zoneId: string;
	boundAt: string;
}

const DOMAINS_KEY = "config/domains.json";
const DOMAIN_REGEX = /^(?=.{1,253}$)([a-z0-9](-?[a-z0-9])*\.)+[a-z]{2,}$/;

export function isValidDomain(domain: string): boolean {
	return DOMAIN_REGEX.test(domain);
}

export async function listDomains(bucket: R2Bucket): Promise<DomainEntry[]> {
	const obj = await bucket.get(DOMAINS_KEY);
	if (!obj) return [];
	try {
		return (await obj.json()) as DomainEntry[];
	} catch {
		return [];
	}
}

export async function addDomain(bucket: R2Bucket, entry: DomainEntry): Promise<void> {
	const domains = await listDomains(bucket);
	if (domains.some((d) => d.domain === entry.domain)) return;
	domains.push(entry);
	await bucket.put(DOMAINS_KEY, JSON.stringify(domains));
}

export async function removeDomain(bucket: R2Bucket, domain: string): Promise<void> {
	const domains = await listDomains(bucket);
	await bucket.put(DOMAINS_KEY, JSON.stringify(domains.filter((d) => d.domain !== domain)));
}
