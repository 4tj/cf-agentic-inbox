# Inbox workspace (SHO-2811)

Implements the approved v2.1 proposal on baseline `ca922749da15f03b22ce0702355a326ff39bfe0d`. Frontend-only: no changes to Workers, storage schemas, authentication, API contracts, email delivery, AI/MCP workflows, or deployment configuration.

## Behavior and boundaries

- `/` is a genuine All Inboxes message/conversation feed, not the mailbox management directory. `/manage` retains mailbox/domain management; existing `/mailbox/:mailboxId/emails/:folder`, `/mailbox/:mailboxId/search`, settings and public `/s/:token` links remain valid.
- Desktop ≥1200px: 240–256px inbox navigation, 380–420px message list, remaining width for content. At 768–1199px, keep navigation and switch list/detail; mobile uses a navigation drawer. Returning from detail retains the mounted list's scroll position.
- Left-hand scope and selected email identity are independent. Rows, details, attachments, replies, drafts and actions carry mailbox + email IDs. Opening a row does not change All Inboxes into a single-mailbox view.
- **All** means normal Inbox mail; **Send** means the existing `sent` folder; **Spam** means `spam`. Switching mailbox scope preserves these primary categories. More retains Drafts, Archive, Trash and mailbox-local custom folders/creation.
- Search uses the same existing operators in both scopes and remains cross-folder unless `in:` explicitly narrows it. Search results are messages, not conversation counts. Main tabs exit search rather than implicitly intersecting it.
- Compose from All Inboxes first asks for a sender. Reply/forward use the selected email's mailbox and visibly show From. Unsaved changes are guarded before navigation, in-place selection or closing; manual Save as Draft remains. Ordinary attachments are still **not persisted in drafts** (existing API limitation); saving with attachments therefore does not clear the discard guard.
- Agent is initially closed and unmounted. Only an explicit click opens the drawer and connects it to a selected/chosen mailbox; there is no `default` mailbox fallback. Closing unmounts the connection but does not clear server history. The existing MCP tab is retained.
- Public Share remains an independent token query tree, not a hidden private workspace. It shows one authorized mailbox, All, refresh/pagination, read-only content and permitted attachments/thread context (including existing sent replies, excluding drafts). No private mailbox query, search, Send/Spam browse controls, Agent, configuration or write controls are mounted. Public rows omit the API's private-inclusive `thread_count`; the opened thread counts only its returned, permitted messages. Transient errors and invalid tokens have distinct states.

## Aggregate implementation

`app/lib/aggregate-feed.ts` merges per-mailbox pages (25 each), with at most three concurrent source fetches. It fetches an exhausted source's next page before selecting the next global row. Dates use the API's representative email date; ties across sources use mailbox ID, ties within a source keep API order. No cross-mailbox deduplication/thread merging.

Batches publish only on complete success. A source error invalidates the entire merge and its cursors; old published rows remain visibly incomplete, and Load more is disabled. Explicit Reload list starts every source from page 1. A successful first batch **replaces** the old rows, resets list scroll and announces the refresh without closing detail/composition. Failed rebuilds retain old rows/error. Generation checks and AbortSignal prevent late old responses from publishing into the new feed.

Read/star metadata updates preserve loaded depth and remain source-local. Structural mutations rebuild the active aggregate; an already-failed feed still requires explicit Reload. Single-mailbox email/search/folder caches are invalidated only for the affected mailbox, plus the shared directory's unread counts.

Limitations are deliberate: offset pagination is not a snapshot; incoming/deleted mail and non-unique date ordering can shift page boundaries. Deduplicating already-published identities does not solve snapshot consistency. There is no global random-access page number, all-mailbox polling fleet, background synchronizer or backend aggregate endpoint.

## Local acceptance environment

Prerequisites: installed Node/npm, Python 3 and `agent-browser`. Run from a **fresh isolated checkout/worktree**, with its own local `.wrangler` state and browser session. Never use these fixtures against an existing mailbox or remote service. Fixture preparation refuses non-localhost URLs and existing test mailboxes; offline seeding only writes into marker-created local DO databases, never changes schema.

```sh
npm ci
npm run typecheck
npm test
npm run build

# Terminal 1 (choose your own free port when another agent is testing):
npm run dev:local -- --host 127.0.0.1 --port 52811 --strictPort

# Terminal 2, while the server is running:
python3 scripts/seed-inbox-ui.py prepare --url http://127.0.0.1:52811

# Stop Terminal 1 with Ctrl-C before the following offline local fixture step:
python3 scripts/seed-inbox-ui.py seed
npx wrangler r2 object put agentic-inbox/attachments/qa2811-email-000/qa2811-attachment/qa2811-note.txt \
  --file docs/fixtures/qa2811-note.txt --content-type text/plain --local

# Restart Terminal 1 with the same dev:local command, then Terminal 2:
python3 scripts/check-inbox-ui.py --url http://127.0.0.1:52811 --session sho2811-qa --out ../artifacts/browser-qa
python3 scripts/check-inbox-interactions.py --url http://127.0.0.1:52811 --session sho2811-interactions --out ../artifacts/interactions-qa
python3 scripts/check-inbox-initialization.py --url http://127.0.0.1:52811 --session sho2811-initialization --out ../artifacts/initialization-qa

# Close only your own sessions and stop your own dev server when finished:
agent-browser --session sho2811-qa close
agent-browser --session sho2811-interactions close
```

A first Vite development visit (especially first lazy Agent import) can trigger dependency optimization/full reload. Let it finish and rerun the check with a fresh test session; do not interpret a dev reload as saved composition. No Vite/automation configuration was changed to bypass this. The browser scripts write raw commands, assertions and screenshots to their output directory. On a failure inspect those files before retrying; API writes may already have succeeded. Repeated successful interaction checks can create additional explicitly named local QA drafts, but do not change the 172 Inbox conversation identities.

### Data and coverage

Four mailboxes: 80 + 55 + 37 Inbox conversations and one genuinely empty mailbox. A source dominates more than one page; timestamps tie; mailbox-local email/thread IDs and subjects deliberately collide across mailboxes. Includes multi-message threads, sent context, private drafts, Spam/Archive/Trash, a long address, a custom folder and a real local R2 attachment.

- `shared/aggregate-feed.test.ts`: complete 172-row merge, ten source/page failure positions, failed-rebuild retention, replacement recovery, late-response isolation, bounded concurrency and source-local metadata patching.
- `shared/ui-store.test.ts`: compound identity, no guessed sender/Agent, reply context, busy/dirty guards, and React click events cannot be mistaken for forced discard.
- `check-inbox-ui.py`: full real-API pagination/order and 172-row recovery; intentionally failed later source page and failed rebuild; detail retention; tabs/scope/custom folders/search; source-only read/star/archive actions and loaded-depth retention.
- `check-inbox-interactions.py`: reply identity, navigation/Back/close/search guards, real local draft save, aggregate sender choice, attachment upload and injected send failure; explicit Agent connection/reopen/MCP; medium/mobile scroll/focus/overflow; public-only requests, allowed thread/attachment reads, draft rejection, unchanged unread state, Share failure and invalid token.

- `check-inbox-initialization.py`: browser-only mocked config/creation failures; retry stays enabled, creation retries once and does not repeat on navigation. No mailbox writes reach the Worker in this probe.

### What is mocked or not claimed

List/send failures are injected **in the test browser**, not backend changes. Automated confirmation choices are stubbed to exercise guard outcomes; native confirm Cancel/Accept was also checked manually in the browser. Normal mailbox lists, metadata, details, thread reads, drafts, moves, read/star writes, token checks and attachment bytes use the actual local Worker/DO/R2. Tests never send outbound mail or request AI generation.

`dev:local` bypasses Cloudflare Access and disables remote bindings. Local Share tests and unchanged backend security unit tests do not prove a deployed JWT/Access configuration. Real delivery, AI generation, nonempty production Agent history, cloud configuration and post-deployment behavior are not validated. Merge/deployment require separate authorization after independent implementation review.
