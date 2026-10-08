import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUIStore } from "../app/hooks/useUIStore";

beforeEach(() => {
	useUIStore.getState().closePanel(true);
	useUIStore.getState().closeAgentPanel();
	vi.stubGlobal("window", { confirm: vi.fn(() => false), alert: vi.fn() });
});
describe("mailbox operation identity and editing guard", () => {
	it("keeps colliding email IDs in separate mailboxes", () => {
		useUIStore.getState().selectEmail("same-id", "sales@example.test");
		expect(useUIStore.getState().selectedMailboxId).toBe("sales@example.test");
		useUIStore.getState().selectEmail("same-id", "info@example.test");
		expect(useUIStore.getState().selectedMailboxId).toBe("info@example.test");
	});
	it("does not invent an aggregate compose or Agent mailbox", () => {
		expect(useUIStore.getState().isAgentPanelOpen).toBe(false);
		expect(useUIStore.getState().startCompose()).toBe(false);
		expect(useUIStore.getState().isComposing).toBe(false);
	});
	it("reply inherits selection; new mail has an explicitly chosen From", () => {
		useUIStore.getState().selectEmail("email", "sales@example.test");
		useUIStore.getState().startCompose({ mode: "reply" });
		expect(useUIStore.getState().composeMailboxId).toBe("sales@example.test");
		expect(useUIStore.getState().selectedEmailId).toBe("email");
		useUIStore.getState().closeCompose();
		useUIStore
			.getState()
			.startCompose({ mode: "new", mailboxId: "info@example.test" });
		expect(useUIStore.getState().composeMailboxId).toBe("info@example.test");
		expect(useUIStore.getState().selectedEmailId).toBeNull();
	});
	it("blocks in-place selection, compose replacement and close before discarding editing state", () => {
		useUIStore
			.getState()
			.startCompose({ mode: "new", mailboxId: "sales@example.test" });
		useUIStore.getState().setComposeDirty(true);
		expect(
			useUIStore.getState().selectEmail("other", "info@example.test"),
		).toBe(false);
		expect(
			useUIStore
				.getState()
				.startCompose({ mode: "new", mailboxId: "info@example.test" }),
		).toBe(false);
		useUIStore.getState().closePanel();
		// A React click event must never be interpreted as force=true.
		useUIStore.getState().closePanel({ type: "click" } as unknown as boolean);
		useUIStore.getState().closeCompose();
		expect(useUIStore.getState().composeMailboxId).toBe("sales@example.test");
		expect(useUIStore.getState().composeDirty).toBe(true);
		vi.mocked(window.confirm).mockReturnValue(true);
		expect(
			useUIStore.getState().selectEmail("other", "info@example.test"),
		).toBe(true);
		expect(useUIStore.getState().isComposing).toBe(false);
	});
	it("does not discard an in-flight save or send", () => {
		useUIStore
			.getState()
			.startCompose({ mode: "new", mailboxId: "sales@example.test" });
		useUIStore.getState().setComposeBusy(true);
		vi.mocked(window.confirm).mockReturnValue(true);
		useUIStore.getState().closeCompose();
		expect(useUIStore.getState().isComposing).toBe(true);
		expect(window.alert).toHaveBeenCalledOnce();
	});
});
