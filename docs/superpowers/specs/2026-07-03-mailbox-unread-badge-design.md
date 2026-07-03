# Mailbox Unread Badge — Design

**Date:** 2026-07-03
**Status:** Approved (design)

## Goal

On the **Mailboxes** list page (`app/routes/home.tsx`, `<h1>Mailboxes</h1>`), show each
mailbox's **unread email count** as a `Badge`, matching the existing folder-level unread
badges already rendered in the sidebar (`FolderLink` in `app/components/Sidebar.tsx`).

"Unread count" means **unread emails in the mailbox's Inbox folder only** (`folder_id = "inbox"`,
`read = 0`). This mirrors the account-level unread semantics of mainstream mail clients
(Gmail, Apple Mail) and avoids Sent/Draft noise.

## Current Architecture (relevant facts)

- The Mailboxes list page is `app/routes/home.tsx`. It renders one row per mailbox linking
  to `/mailbox/:id`.
- `GET /api/v1/mailboxes` (`workers/index.ts`) lists mailboxes from R2 bucket metadata via
  `listMailboxes()` (`workers/lib/email-helpers.ts`). It returns only `{ id, email, name }` —
  **no unread count**.
- Each mailbox is an independent `MailboxDO` Durable Object with its own SQLite DB. Unread
  counts are computed inside the DO. `getFolders()` already computes per-folder `unreadCount`
  via `SUM(CASE WHEN read = 0 THEN 1 ELSE 0 END)`, grouped by folder — this powers the sidebar
  badges but requires a mailbox to be opened.
- There is currently **no mailbox-level unread total** exposed by any endpoint.
- Folder ID constant: `Folders.INBOX === "inbox"` (`shared/folders.ts`).
- The sidebar badge pattern is `{unreadCount > 0 && <Badge variant="secondary">{unreadCount}</Badge>}`.

## Chosen Approach

**Extend `GET /api/v1/mailboxes`** to include an inbox `unreadCount` per mailbox, computed by
concurrently querying each mailbox's DO. Rejected alternatives:

- **Per-mailbox `listFolders` from the frontend** — N HTTP requests, heavier query (computes
  all folders), and requires `useQueries` in `home.tsx`.
- **Dedicated `/api/v1/mailboxes/unread` endpoint** — keeps `mailboxes` lightweight but adds a
  second endpoint + a second frontend query to merge. Not worth it at this scale.

Mailbox count is small (personal agentic inbox), the DO call is a lightweight indexed `COUNT`,
and all calls run concurrently — so folding the count into the existing list endpoint is the
simplest fit for the existing data flow.

## Changes

### Backend (`workers/`)

1. **`MailboxDO.getInboxUnreadCount()`** — new lightweight method in `workers/durableObject/index.ts`,
   in the same style as `getFolders()` (drizzle):
   ```ts
   async getInboxUnreadCount(): Promise<number> {
     const row = this.db
       .select({
         count: sql<number>`COALESCE(SUM(CASE WHEN ${schema.emails.read} = 0 THEN 1 ELSE 0 END), 0)`.mapWith(Number),
       })
       .from(schema.emails)
       .where(eq(schema.emails.folder_id, Folders.INBOX))
       .get();
     return row?.count ?? 0;
   }
   ```

2. **`GET /api/v1/mailboxes`** (`workers/index.ts`) — for each listed mailbox, resolve its DO
   stub (`getMailboxStub(c.env, m.id)`) and call `getInboxUnreadCount()` concurrently with
   `Promise.all`. Merge the result as `unreadCount`. A failing DO call resolves to `0`
   (`.catch(() => 0)`) so one bad mailbox never breaks the whole list.
   ```ts
   const allMailboxes = await listMailboxes(c.env.BUCKET);
   const withUnread = await Promise.all(
     allMailboxes.map(async (m) => {
       const unreadCount = await getMailboxStub(c.env, m.id)
         .getInboxUnreadCount()
         .catch(() => 0);
       return { ...m, name: m.id, unreadCount };
     }),
   );
   return c.json(withUnread);
   ```

### Frontend (`app/`)

3. **`app/types/index.ts`** — add optional field to `Mailbox`:
   ```ts
   export interface Mailbox {
     id: string;
     email: string;
     name: string;
     settings?: MailboxSettings;
     unreadCount?: number;
   }
   ```

4. **`app/routes/home.tsx`** — render the badge on each row:
   - `accounts` has two sources. When `isConfigured` (built from `emailAddresses`), the
     `unreadCount` is not present on those synthetic account objects, so build an
     `email → unreadCount` map from `mailboxes` (keyed lowercase; `account.id === email === mailboxId`)
     and look up each account's count. When not configured, `account.unreadCount` is already present.
   - In each mailbox row, before the delete button, render:
     ```tsx
     {unreadCount > 0 && <Badge variant="secondary">{unreadCount}</Badge>}
     ```
     Import `Badge` from `@cloudflare/kumo` (same import source as the sidebar).

## Edge Cases

- **No unread** → badge is not rendered (`unreadCount > 0` guard), matching the sidebar.
- **DO query failure** → that mailbox's `unreadCount` is `0`; the list still renders.
- **Configured (EMAIL_ADDRESSES) mode** → accounts come from `emailAddresses`; counts are
  merged in from the `mailboxes` query by email. If a configured address has no mailbox record
  yet (auto-create pending), it has no count → no badge.

## Testing

- Unit test for `getInboxUnreadCount()`: seed emails across folders (inbox read/unread, sent
  unread) and assert the method counts **only** inbox + `read = 0`, excluding sent and read mail.
- Follow the existing test setup in `workers/receive-email.test.ts` for constructing the DO /
  seeding rows.

## Out of Scope (YAGNI)

- Real-time / live-updating badge counts (relies on normal query refetch / invalidation).
- Unread totals across all folders (explicitly chose Inbox-only).
- Badge on any surface other than the Mailboxes list page.
