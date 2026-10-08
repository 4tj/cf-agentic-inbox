import { describe, expect, it } from "vitest";
import { AggregateFeed, type FetchSource } from "../app/lib/aggregate-feed";
import type { Email } from "../app/types";

const makeRows = (count: number, start: number, step = 1): Email[] =>
	Array.from({ length: count }, (_, i) => ({
		id: `email-${i ^ 1}`,
		thread_id: `thread-${i}`,
		subject: `Subject ${i}`,
		sender: "buyer@example.test",
		recipient: "sales@example.test",
		date: new Date((start - Math.floor(i / 2) * step) * 1000).toISOString(),
		read: false,
		starred: false,
	}));
const sources: Record<string, Email[]> = {
	sales: makeRows(80, 2000),
	info: makeRows(55, 1940),
	support: makeRows(37, 2000, 7),
	empty: [],
};
const ids = Object.keys(sources);
const expected = Object.entries(sources)
	.flatMap(([mailboxId, rows]) => rows.map((row) => ({ ...row, mailboxId })))
	.sort(
		(a, b) =>
			Date.parse(b.date) - Date.parse(a.date) ||
			a.mailboxId.localeCompare(b.mailboxId),
	);
const fetchSource: FetchSource = async (id, page) => ({
	emails: sources[id].slice((page - 1) * 25, page * 25),
	totalCount: sources[id].length,
});
async function finish(feed: AggregateFeed) {
	for (
		let i = 0;
		i < 20 && feed.getSnapshot().hasMore && !feed.getSnapshot().error;
		i++
	)
		await feed.loadMore();
}

describe("active-scope aggregate feed", () => {
	it("merges source pages, ties, empty sources and colliding cross-mailbox ids without losing dominant sources", async () => {
		expect(
			expected.slice(0, 50).filter((row) => row.mailboxId === "sales").length,
		).toBeGreaterThan(25);
		const feed = new AggregateFeed(ids, fetchSource);
		await feed.reload(false);
		await finish(feed);
		expect(feed.getSnapshot().rows).toEqual(expected);
		expect(expected).toHaveLength(172);
		expect(feed.getSnapshot().hasMore).toBe(false);
	});

	for (const [id, rows] of Object.entries(sources)) {
		for (
			let page = 1;
			page <= Math.max(1, Math.ceil(rows.length / 25));
			page++
		) {
			it(`invalidates failed ${id} page ${page}; rebuild replaces and recovers all rows`, async () => {
				let failing: [string, number] | null = [id, page];
				let calls = 0;
				const feed = new AggregateFeed(
					ids,
					async (source, nextPage, signal) => {
						calls++;
						if (failing?.[0] === source && failing[1] === nextPage)
							throw new Error("fixture failure");
						return fetchSource(source, nextPage, signal);
					},
				);
				await feed.reload(false);
				await finish(feed);
				expect(feed.getSnapshot().error).toContain(id);
				const oldRows = feed.getSnapshot().rows;
				const oldCalls = calls;
				await feed.loadMore();
				expect(calls).toBe(oldCalls);
				failing = [id, 1];
				await feed.reload();
				expect(feed.getSnapshot().error).not.toBeNull();
				expect(feed.getSnapshot().rows).toBe(oldRows);
				failing = null;
				await feed.reload();
				expect(feed.getSnapshot().rows).toEqual(expected.slice(0, 25));
				expect(feed.getSnapshot().reloadVersion).toBe(1);
				await finish(feed);
				expect(feed.getSnapshot().rows).toEqual(expected);
			});
		}
	}

	it("does not publish stale responses after a rebuild even when fetch ignores abort", async () => {
		let release!: () => void;
		const wait = new Promise<void>((resolve) => {
			release = resolve;
		});
		let call = 0;
		const feed = new AggregateFeed(["sales"], async (id, page, signal) => {
			if (++call === 1) {
				await wait;
				return { emails: [makeRows(1, 9999)[0]], totalCount: 1 };
			}
			return fetchSource(id, page, signal);
		});
		const old = feed.reload(false);
		await feed.reload();
		const current = feed.getSnapshot();
		release();
		await old;
		expect(feed.getSnapshot()).toBe(current);
		expect(current.rows[0].date).toBe(sources.sales[0].date);
	});

	it("patches source-local metadata without truncating loaded pages or affecting colliding IDs", async () => {
		const feed = new AggregateFeed(ids, fetchSource);
		await feed.reload(false);
		await feed.loadMore();
		const before = feed.getSnapshot().rows;
		const target = before.find((row) => row.mailboxId === "sales")!;
		feed.patch((row) =>
			row.mailboxId === target.mailboxId && row.id === target.id
				? { ...row, starred: true }
				: row,
		);
		expect(feed.getSnapshot().rows).toHaveLength(50);
		expect(feed.getSnapshot().rows.filter((row) => row.starred)).toEqual([
			{ ...target, starred: true },
		]);
		await finish(feed);
		expect(feed.getSnapshot().rows).toHaveLength(172);
	});

	it("bounds source concurrency and handles empty sources", async () => {
		let active = 0,
			peak = 0;
		const feed = new AggregateFeed(
			Array.from({ length: 10 }, (_, i) => String(i)),
			async () => {
				active++;
				peak = Math.max(peak, active);
				await Promise.resolve();
				active--;
				return { emails: [], totalCount: 0 };
			},
		);
		await feed.reload();
		expect(peak).toBeLessThanOrEqual(3);
		expect(feed.getSnapshot().hasMore).toBe(false);
	});
});
