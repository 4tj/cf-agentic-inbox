import { createContext, useContext } from "react";

/** Explicit operation identity, independent of the left-hand list scope. */
export const MailboxContext = createContext<string | undefined>(undefined);
export function useMailboxContext() {
	return useContext(MailboxContext);
}
