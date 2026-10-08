/** Frontend-only merge of mailbox-scoped, date-descending metadata pages.
 * Source ties retain API order; this does not create a snapshot over offset APIs.
 */
import type { Email } from "../types";

export type ScopedEmail = Email & { mailboxId: string };
export interface SourcePage {
	emails: Email[];
	totalCount: number;
}
export type FetchSource = (
	mailboxId: string,
	page: number,
	signal: AbortSignal,
) => Promise<SourcePage>;
export interface FeedState {
	rows: ScopedEmail[];
	loading: boolean;
	error: string | null;
	hasMore: boolean;
	/** Only a successful explicit rebuild moves the list back to its top. */
	reloadVersion: number;
}

class Merge {
	private sources: {
		id: string;
		page: number;
		rows: ScopedEmail[];
		index: number;
		ended: boolean;
	}[];
	private failed = false;
	constructor(
		ids: string[],
		private fetchSource: FetchSource,
		private signal: AbortSignal,
	) {
		this.sources = [...ids]
			.sort()
			.map((id) => ({ id, page: 0, rows: [], index: 0, ended: false }));
	}
	get hasMore() {
		return this.sources.some((s) => s.index < s.rows.length || !s.ended);
	}
	patch(update: (row: ScopedEmail) => ScopedEmail) {
		this.sources.forEach((source) => {
			source.rows = source.rows.map(update);
		});
	}
	async batch(size = 25): Promise<ScopedEmail[]> {
		if (this.failed) throw new Error("Reload the list before loading more.");
		const batch: ScopedEmail[] = [];
		try {
			while (batch.length < size) {
				const empty = this.sources.filter(
					(s) => s.index === s.rows.length && !s.ended,
				);
				// Bounded fan-out, only for the active view. No per-mailbox polling.
				for (let i = 0; i < empty.length; i += 3) {
					await Promise.all(
						empty.slice(i, i + 3).map(async (source) => {
							try {
								const result = await this.fetchSource(
									source.id,
									source.page + 1,
									this.signal,
								);
								source.page++;
								source.rows = result.emails.map((email) => ({
									...email,
									mailboxId: source.id,
								}));
								source.index = 0;
								source.ended =
									result.emails.length === 0 ||
									source.page * 25 >= result.totalCount;
							} catch (error) {
								throw new Error(
									`${source.id}: ${error instanceof Error ? error.message : "Could not load emails"}`,
								);
							}
						}),
					);
				}
				if (this.signal.aborted) throw new Error("Cancelled");
				let next: (typeof this.sources)[number] | undefined;
				for (const source of this.sources) {
					if (source.index >= source.rows.length) continue;
					if (
						!next ||
						Date.parse(source.rows[source.index].date) >
							Date.parse(next.rows[next.index].date)
					)
						next = source;
				}
				if (!next) break;
				batch.push(next.rows[next.index++]);
			}
			return batch;
		} catch (error) {
			this.failed = true;
			throw error; // Never resume partially consumed buffers after failure.
		}
	}
}

/** Owns publication, cancellation, and v2.1's rebuild-on-error contract. */
export class AggregateFeed {
	private state: FeedState = {
		rows: [],
		loading: true,
		error: null,
		hasMore: true,
		reloadVersion: 0,
	};
	private listeners = new Set<() => void>();
	private generation = 0;
	private controller?: AbortController;
	private merge?: Merge;
	constructor(
		private ids: string[],
		private fetchSource: FetchSource,
	) {}
	getSnapshot = () => this.state;
	subscribe = (listener: () => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};
	private publish(patch: Partial<FeedState>) {
		this.state = { ...this.state, ...patch };
		this.listeners.forEach((listener) => listener());
	}
	/** Read/star changes do not reorder normal lists or throw away loaded depth. */
	patch(update: (row: ScopedEmail) => ScopedEmail) {
		this.merge?.patch(update);
		this.publish({ rows: this.state.rows.map(update) });
	}
	dispose = () => {
		this.generation++;
		this.controller?.abort();
		this.merge = undefined;
	};
	async reload(explicit = true) {
		this.dispose();
		const generation = this.generation;
		const controller = (this.controller = new AbortController());
		const merge = new Merge(this.ids, this.fetchSource, controller.signal);
		// Keep published rows and the error until a whole first batch succeeds.
		this.publish({ loading: true });
		try {
			const rows = await merge.batch();
			if (generation !== this.generation) return;
			this.merge = merge;
			this.publish({
				rows,
				loading: false,
				error: null,
				hasMore: merge.hasMore,
				reloadVersion: this.state.reloadVersion + (explicit ? 1 : 0),
			});
		} catch (error) {
			this.fail(generation, error);
		}
	}
	async loadMore() {
		if (
			this.state.loading ||
			this.state.error ||
			!this.merge ||
			!this.state.hasMore
		)
			return;
		const generation = this.generation;
		const merge = this.merge;
		this.publish({ loading: true });
		try {
			const batch = await merge.batch();
			if (generation !== this.generation) return;
			// Offset drift can repeat an email; never deduplicate across mailboxes.
			const seen = new Set(
				this.state.rows.map((row) => JSON.stringify([row.mailboxId, row.id])),
			);
			const rows = batch.filter((row) => {
				const key = JSON.stringify([row.mailboxId, row.id]);
				if (seen.has(key)) return false;
				seen.add(key);
				return true;
			});
			this.publish({
				rows: [...this.state.rows, ...rows],
				loading: false,
				hasMore: merge.hasMore,
			});
		} catch (error) {
			this.fail(generation, error);
		}
	}
	private fail(generation: number, error: unknown) {
		if (generation !== this.generation) return;
		this.merge = undefined;
		this.controller?.abort();
		this.publish({
			loading: false,
			error: error instanceof Error ? error.message : "Could not load emails",
		});
	}
}
