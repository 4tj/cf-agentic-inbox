// Copyright (c) 2026 Cloudflare, Inc. Apache-2.0
import { create } from "zustand";
import type { Email } from "~/types";

export type ComposeMode = "new" | "reply" | "reply-all" | "forward";
export interface ComposeOptions {
	mode: ComposeMode;
	mailboxId?: string;
	originalEmail?: Email | null;
	draftEmail?: Email | null;
}
interface UIState {
	selectedEmailId: string | null;
	selectedMailboxId: string | null;
	isComposing: boolean;
	composeMailboxId: string | null;
	_previousEmailId: string | null;
	_previousMailboxId: string | null;
	composeDirty: boolean;
	composeBusy: boolean;
	setComposeDirty: (dirty: boolean) => void;
	setComposeBusy: (busy: boolean) => void;
	selectEmail: (id: string, mailboxId: string) => boolean;
	startCompose: (options?: ComposeOptions) => boolean;
	closePanel: (force?: boolean) => void;
	closeCompose: (force?: boolean) => void;
	composeOptions: ComposeOptions;
	isSidebarOpen: boolean;
	openSidebar: () => void;
	closeSidebar: () => void;
	toggleSidebar: () => void;
	isAgentPanelOpen: boolean;
	agentMailboxId: string | null;
	openAgentPanel: (mailboxId: string) => void;
	closeAgentPanel: () => void;
	isComposeModalOpen: boolean;
	openComposeModal: (options?: ComposeOptions) => void;
	closeComposeModal: () => void;
}
const cleanCompose = {
	isComposing: false,
	isComposeModalOpen: false,
	composeDirty: false,
	composeBusy: false,
	composeMailboxId: null,
	composeOptions: { mode: "new" as const, originalEmail: null },
};

/** Used both by in-place actions and the router blocker, before any reset. */
export function confirmDiscardCompose(): boolean {
	const state = useUIStore.getState();
	if (state.composeBusy) {
		if (typeof window !== "undefined")
			window.alert("Please wait for the draft or message to finish saving.");
		return false;
	}
	return (
		!state.composeDirty ||
		(typeof window !== "undefined" &&
			window.confirm(
				"Discard unsaved changes? Cancel to keep editing or save a draft first.",
			))
	);
}

export const useUIStore = create<UIState>((set, get) => ({
	...cleanCompose,
	selectedEmailId: null,
	selectedMailboxId: null,
	_previousEmailId: null,
	_previousMailboxId: null,
	isSidebarOpen: false,
	isAgentPanelOpen: false,
	agentMailboxId: null,
	setComposeDirty: (composeDirty) => set({ composeDirty }),
	setComposeBusy: (composeBusy) => set({ composeBusy }),
	selectEmail: (id, mailboxId) => {
		if (!confirmDiscardCompose()) return false;
		set({ ...cleanCompose, selectedEmailId: id, selectedMailboxId: mailboxId });
		return true;
	},
	startCompose: (options) => {
		const mailboxId = options?.mailboxId || get().selectedMailboxId;
		if (!mailboxId || !confirmDiscardCompose()) return false;
		const mode = options?.mode || "new";
		const keepEmail = mode !== "new" && get().selectedMailboxId === mailboxId;
		set((state) => ({
			...cleanCompose,
			isComposing: true,
			composeMailboxId: mailboxId,
			isAgentPanelOpen: false,
			_previousEmailId: state.selectedEmailId,
			_previousMailboxId: state.selectedMailboxId,
			selectedEmailId: keepEmail ? state.selectedEmailId : null,
			selectedMailboxId: keepEmail ? mailboxId : null,
			composeOptions: { ...options, mode, mailboxId },
			isSidebarOpen: false,
		}));
		return true;
	},
	closePanel: (force) => {
		if (force !== true && !confirmDiscardCompose()) return;
		set({
			...cleanCompose,
			selectedEmailId: null,
			selectedMailboxId: null,
			_previousEmailId: null,
			_previousMailboxId: null,
		});
	},
	closeCompose: (force) => {
		if (force !== true && !confirmDiscardCompose()) return;
		set((state) => ({
			...cleanCompose,
			selectedEmailId: state._previousEmailId,
			selectedMailboxId: state._previousMailboxId,
		}));
	},
	openSidebar: () => set({ isSidebarOpen: true }),
	closeSidebar: () => set({ isSidebarOpen: false }),
	toggleSidebar: () => set({ isSidebarOpen: !get().isSidebarOpen }),
	openAgentPanel: (agentMailboxId) =>
		set({ isAgentPanelOpen: true, agentMailboxId }),
	closeAgentPanel: () => set({ isAgentPanelOpen: false }),
	openComposeModal: (options) => {
		if (get().startCompose(options))
			set({ isComposing: false, isComposeModalOpen: true });
	},
	closeComposeModal: () => {
		if (confirmDiscardCompose()) set(cleanCompose);
	},
}));
