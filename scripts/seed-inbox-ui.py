#!/usr/bin/env python3
"""Disposable localhost QA fixture. Never connects to a remote service.
1. With dev:local running: python3 scripts/seed-inbox-ui.py prepare --url http://127.0.0.1:52811
2. Stop that dev server, then: python3 scripts/seed-inbox-ui.py seed
3. Restart dev:local. Optional attachment: see docs/inbox-ui-qa.md.
Only inserts test rows into already-created local DO databases; no schema changes.
"""
import argparse, datetime, json, pathlib, sqlite3, urllib.request, urllib.parse

ROOT = pathlib.Path(__file__).resolve().parents[1]
MAILBOXES = {"sales@example.test": 80, "info@example.test": 55, "support.with.a.deliberately.long.address@example.test": 37, "empty@example.test": 0}
ANCHOR = "SHO2811-QA-ANCHOR:"


def request(base, path, body=None):
    data = None if body is None else json.dumps(body).encode()
    with urllib.request.urlopen(urllib.request.Request(base + path, data=data, headers={"Content-Type": "application/json"}), timeout=20) as response:
        return json.load(response)


def prepare(url):
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "http" or parsed.hostname not in ("127.0.0.1", "localhost"):
        raise SystemExit("Refusing anything except an explicit localhost HTTP dev server")
    existing = {m["id"] for m in request(url, "/api/v1/mailboxes")}
    for mailbox in MAILBOXES:
        path = "/api/v1/mailboxes/" + urllib.parse.quote(mailbox, safe="")
        if mailbox in existing:
            raise SystemExit(f"Fixture mailbox already exists: {mailbox}. Use a fresh isolated worktree/state directory; do not overwrite other data.")
        request(url, "/api/v1/mailboxes", {"email": mailbox, "name": mailbox.split("@")[0].capitalize()})
        request(url, path + "/drafts", {"subject": ANCHOR + mailbox, "body": "Local-only QA marker"})
    print(json.dumps({"prepared": list(MAILBOXES), "next": "Stop this dev server before running seed"}, indent=2))


def seed():
    paths = list((ROOT / ".wrangler/state/v3/do").rglob("*.sqlite"))
    found = {}
    for path in paths:
        conn = sqlite3.connect(path)
        try:
            anchors = conn.execute("select subject from emails where subject like ?", (ANCHOR + "%",)).fetchall()
            if not anchors:
                continue
            mailbox = anchors[0][0][len(ANCHOR):]
            if mailbox not in MAILBOXES:
                continue
            if conn.execute("select count(*) from emails").fetchone()[0] != 1:
                raise SystemExit(f"Refusing nonempty fixture mailbox {mailbox}")
            conn.execute("delete from emails where subject = ?", (ANCHOR + mailbox,))
            conn.execute("insert into folders(id,name,is_deletable) values('qa2811-custom','Customer projects',1)")
            count = MAILBOXES[mailbox]
            source = list(MAILBOXES).index(mailbox)
            base = datetime.datetime(2026, 10, 8, 12, tzinfo=datetime.timezone.utc)
            offset = (0, 600, 0, 0)[source]
            step = (1, 1, 7, 1)[source]
            def insert(id, subject, folder="inbox", seconds=0, thread=None, body=None):
                date = (base - datetime.timedelta(seconds=seconds)).isoformat(timespec="milliseconds").replace("+00:00", "Z")
                sender = mailbox if folder in ("sent", "draft") else f"buyer{source}@customer.test"
                conn.execute("insert into emails(id,folder_id,subject,sender,recipient,date,read,starred,body,thread_id,message_id) values(?,?,?,?,?,?,?,?,?,?,?)", (
                    id, folder, subject, sender, "buyer@customer.test" if folder in ("sent", "draft") else mailbox, date,
                    int(folder == "sent"), 0, body or f"<p>Local QA only — {mailbox}</p><p>{subject}</p>", thread or id, f"{id}@fixture.test"))
            for i in range(count):
                insert(f"qa2811-email-{i:03}", f"Order update {i:03}", seconds=offset + (i // 2) * step, thread=f"qa2811-thread-{i:03}")
            if count:
                insert("qa2811-followup", "Re: Order update 000", seconds=900, thread="qa2811-thread-000")
                insert("qa2811-sent-context", "Re: Order update 000", "sent", 2000, "qa2811-thread-000", "<p>Existing sent context — visible in the shared conversation.</p>")
                insert("qa2811-draft-context", "Re: Order update 000", "draft", 3000, "qa2811-thread-000", "<p>PRIVATE DRAFT — must never appear on public share.</p>")
                for folder in ("sent", "spam", "draft", "archive", "trash", "qa2811-custom"):
                    insert("qa2811-" + folder, folder.capitalize() + " example", folder, 4000)
                conn.execute("insert into attachments(id,email_id,filename,mimetype,size,disposition) values(?,?,?,?,?,?)", (
                    "qa2811-attachment", "qa2811-email-000", "qa2811-note.txt", "text/plain", 26, "attachment"))
            conn.commit()
            found[mailbox] = {"inboxConversations": count, "localDatabase": str(path.relative_to(ROOT))}
        finally:
            conn.close()
    if len(found) != len(MAILBOXES):
        raise SystemExit(f"Expected {len(MAILBOXES)} fresh marker databases, found {len(found)}")
    print(json.dumps({"seeded": found, "totalInboxConversations": sum(MAILBOXES.values())}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["prepare", "seed"])
    parser.add_argument("--url", default="http://127.0.0.1:52811")
    args = parser.parse_args()
    prepare(args.url.rstrip("/")) if args.action == "prepare" else seed()
