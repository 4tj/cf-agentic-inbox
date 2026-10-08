#!/usr/bin/env python3
"""Local real-API browser checks via agent-browser. Requires seed-inbox-ui.py fixture.
No remote access and no email sending. Network faults are explicitly injected in
browser fetch; all normal lists/details/drafts/sharing use local Workers/DO/R2.
"""
import argparse, datetime, json, pathlib, subprocess, time, urllib.parse, urllib.request

parser = argparse.ArgumentParser()
parser.add_argument("--url", default="http://127.0.0.1:52811")
parser.add_argument("--session", default="sho2811-qa")
parser.add_argument("--out", default="../artifacts/browser-qa")
args = parser.parse_args()
assert urllib.parse.urlparse(args.url).hostname in ("127.0.0.1", "localhost")
OUT = pathlib.Path(args.out).resolve(); OUT.mkdir(parents=True, exist_ok=True)
log = []; checks = []

def ab(*args_, session=None):
    result = subprocess.run(["agent-browser", "--session", session or args.session, "--json", *args_], text=True, capture_output=True, timeout=65)
    log.append({"command": list(args_), "stdout": result.stdout, "stderr": result.stderr, "exit": result.returncode})
    (OUT / "commands.json").write_text(json.dumps(log, indent=2))
    if result.returncode: raise AssertionError(result.stdout + result.stderr)
    data = json.loads(result.stdout)
    assert data["success"], data
    if args_[0] == 'close': time.sleep(0.5)  # CLI acknowledgment precedes daemon exit
    return data.get("data", {})

def js(script): return ab("eval", script).get("result")
def wait(script): return ab("wait", "--fn", script)
def button(name): return ab("find", "role", "button", "click", "--name", name, "--exact")
def link(name):
    selector = '.inbox-sidebar > a' if name == 'All Inboxes' else f'nav[aria-label="Email categories"] a:nth-child({["All","Send","Spam"].index(name)+1})'
    return ab('click', selector)
def rows(): return js("Array.from(document.querySelectorAll('.mail-row')).map(e=>[e.dataset.mailbox,e.dataset.emailId])")
def check(name, condition, detail=None):
    assert condition, (name, detail)
    checks.append({"check": name, "pass": True, "evidence": detail})
    (OUT / "checks.json").write_text(json.dumps(checks, indent=2))

def api(path, body=None, method=None):
    data = None if body is None else json.dumps(body).encode()
    with urllib.request.urlopen(urllib.request.Request(args.url + path, data=data, method=method, headers={"Content-Type":"application/json"}), timeout=20) as response:
        return json.load(response)

COUNT = "document.querySelectorAll('.mail-row').length"
READY = "!document.querySelector('button[aria-label=\"Refresh emails\"]')?.disabled"
IDS = [m['id'] for m in api('/api/v1/mailboxes')]
expected = []
for mailbox in sorted(IDS):
    page = 1
    while True:
        data = api('/api/v1/mailboxes/' + urllib.parse.quote(mailbox, safe='') + '/emails?' + urllib.parse.urlencode({'folder':'inbox','threaded':'true','page':page,'limit':25}))
        expected += [{**email, 'mailboxId':mailbox} for email in data['emails']]
        if page * 25 >= data['totalCount']: break
        page += 1
expected.sort(key=lambda r: (-datetime.datetime.fromisoformat(r['date'].replace('Z','+00:00')).timestamp(), r['mailboxId']))
expected_ids = [[row['mailboxId'], row['id']] for row in expected]
assert len(expected) == 172, f"Use a fresh complete fixture, got {len(expected)}"
(OUT / 'expected-inbox-identities.json').write_text(json.dumps(expected_ids, indent=2))

ab('close')
ab('open', args.url + '/')
ab('set', 'viewport', '1440', '1000')
wait(COUNT + ' === 25 && ' + READY)
check('initial aggregate ordered first batch', rows() == expected_ids[:25])
check('initial Agent not requested', not ab('network', 'requests', '--filter', '/agents/').get('requests'))
ab('snapshot', '-i')
ab('screenshot', str(OUT / 'all-inboxes.png'))
for count in (50,75,100,125,150,172):
    button('Load more'); wait(COUNT + f' === {count} && ' + READY)
check('all 172 real-API conversations ordered without omissions or cross-mailbox collapse', rows() == expected_ids, {'count':len(rows())})
check('pagination reaches an explicit end', js("document.body.innerText.includes('No more messages')"))
button('Refresh emails'); wait(COUNT + ' === 25 && ' + READY)
ab('click', '.mail-row[data-mailbox="sales@example.test"][data-email-id="qa2811-email-000"]')
wait("document.querySelector('.mail-detail-pane')?.innerText.includes('Mailbox: sales@example.test') && " + READY)
check('aggregate selection stays at All Inboxes', js("location.pathname==='/' && document.querySelector('a[aria-current=page][href=\"/\"]')?.innerText==='All Inboxes'"))
check('real thread includes reply and attachment', js("document.querySelector('.mail-detail-pane').innerText.includes('qa2811-note.txt')"))
ab('screenshot', str(OUT / 'selected-email.png'))

# Failure after a source's initial page is exhausted. No partial publication.
js("window.__qaFetch=window.fetch;window.__qaFailure={source:'sales@example.test',page:2};window.fetch=async function(input,init){const u=new URL(typeof input==='string'?input:input.url,location.origin);if(window.__qaFailure&&u.pathname==='/api/v1/mailboxes/'+window.__qaFailure.source+'/emails'&&u.searchParams.get('page')===String(window.__qaFailure.page)){return new Response(JSON.stringify({error:'Injected local source failure'}),{status:503,headers:{'Content-Type':'application/json'}});}return window.__qaFetch(input,init);}")
old = rows(); button('Load more')
wait("document.body.innerText.includes('List not fully loaded') && " + READY)
check('failed page preserves the whole published batch', rows() == old)
check('failed feed cannot Load more or claim completion', js("!Array.from(document.querySelectorAll('button')).some(b=>b.innerText==='Load more')&&!document.body.innerText.includes('No more messages')"))
check('failed load retains selected detail', js("document.querySelector('.mail-detail-pane').innerText.includes('Mailbox: sales@example.test')"))
js("window.__qaFailure.page=1")
button('Reload list'); wait(READY)
check('failed rebuild preserves rows and error', rows() == old and js("document.body.innerText.includes('List not fully loaded')"))
js("document.querySelector('[data-testid=mail-list-scroll]').scrollTop=400;window.__qaFailure=null")
button('Reload list'); wait(COUNT + ' === 25 && ' + READY + " && !document.body.innerText.includes('List not fully loaded')")
check('rebuild replaces, resets scroll, announces success and preserves selection', rows() == expected_ids[:25] and js("document.querySelector('[data-testid=mail-list-scroll]').scrollTop===0&&document.body.innerText.includes('List reloaded')&&document.querySelector('.mail-detail-pane').innerText.includes('Mailbox: sales@example.test')"))
for count in (50,75,100,125,150,172):
    button('Load more'); wait(COUNT + f' === {count} && ' + READY)
check('real-API recovery returns all 172 identities', rows() == expected_ids)
js('window.fetch=window.__qaFetch')

# Scope/category transitions and the mailbox-aware write endpoint.
link('Send'); wait(READY + " && location.pathname==='/all/sent' && " + COUNT + '>0')
check('Send is sent mail over all mailboxes', js("document.querySelector('.mail-list-pane').innerText.includes('Sent mail')"), {'rows':len(rows())})
link('Spam'); wait(READY + " && location.pathname==='/all/spam' && " + COUNT + '===3')
check('Spam aggregates only the three nonempty mailboxes', len(rows()) == 3)
ab('click', 'nav[aria-label="Mailboxes"] a[href*="sales%40example.test"]')
wait("location.pathname.includes('/mailbox/sales') && location.pathname.endsWith('/spam') && " + READY)
check('mailbox scope retains Spam category', js("document.querySelector('.mail-list-pane h1').innerText==='Sales' && "+COUNT+'===1'))
link('All'); wait(READY + ' && ' + COUNT + '===25')
ab('select', 'select[aria-label="More folders"]', 'qa2811-custom'); wait(READY + " && location.pathname.endsWith('/qa2811-custom') && " + COUNT + '===1')
check('custom folders stay mailbox-specific', js("document.querySelector('.mail-list-pane').innerText.includes('Customer projects')"))
link('All Inboxes'); wait(READY + ' && ' + COUNT + '===25')
ab('fill', 'input[aria-label="Search emails"]', 'in:spam example'); ab('press', 'Enter')
wait(READY + " && location.pathname==='/search' && " + COUNT + '===3')
check('search uses explicit operators, message results and no active category', js("document.querySelector('.mail-list-pane').innerText.includes('3 messages')&&!document.querySelector('nav[aria-label=\"Email categories\"] [aria-current]')"))
ab('fill', 'input[aria-label="Search emails"]', 'nonexistent-qa2811-string'); ab('press', 'Enter')
wait("document.body.innerText.includes('No results found')")
check('empty search is not an empty mailbox', True)
link('All'); wait(READY + ' && ' + COUNT + '===25')
check('Agent still closed after navigation', js("!document.querySelector('[role=dialog]')") and not ab('network','requests','--filter','/agents/').get('requests'))
# Colliding IDs must still address only one mailbox, and opening an unread
# conversation on page two must not truncate the loaded aggregate list.
source = 'support.with.a.deliberately.long.address@example.test'
source_path = '/api/v1/mailboxes/' + urllib.parse.quote(source, safe='')
api(source_path + '/emails/qa2811-email-001', {'read':False}, 'PUT')
button('Refresh emails'); wait(READY + ' && ' + COUNT + '===25'); button('Load more'); wait(READY + ' && ' + COUNT + '===50')
ab('click', f'.mail-row[data-mailbox="{source}"][data-email-id="qa2811-email-001"]')
wait("document.querySelector('.mail-detail-pane').innerText.includes('Mailbox: '+"+json.dumps(source)+") && " + READY)
wait("Array.from(document.querySelectorAll('.mail-row[aria-pressed=true] span')).every(e=>!e.classList.contains('font-semibold'))")
check('opening unread mail preserves 50 loaded rows', len(rows()) == 50)
other_before = api('/api/v1/mailboxes/sales%40example.test/emails/qa2811-email-001')['starred']
star_before = api(source_path + '/emails/qa2811-email-001')['starred']
ab('click', f'.mail-row[data-mailbox="{source}"][data-email-id="qa2811-email-001"] button')
wait(f"document.querySelector('.mail-row[data-mailbox=\"{source}\"][data-email-id=\"qa2811-email-001\"] button').getAttribute('aria-label')===" + json.dumps('Star email' if star_before else 'Unstar email'))
check('star writes only the source despite colliding email ID', api(source_path + '/emails/qa2811-email-001')['starred'] != star_before and api('/api/v1/mailboxes/sales%40example.test/emails/qa2811-email-001')['starred'] == other_before)
ab('click', f'.mail-row[data-mailbox="{source}"][data-email-id="qa2811-email-001"] button')
button('Move to folder'); button('Archive')
wait("document.querySelector('.mail-detail-pane').innerText.includes('Select an email') && " + READY)
check('archive writes only the source mailbox', api(source_path + '/emails/qa2811-email-001')['folder_id']=='archive' and api('/api/v1/mailboxes/sales%40example.test/emails/qa2811-email-001')['folder_id']=='inbox')
api(source_path + '/emails/qa2811-email-001/move', {'folderId':'inbox'})
button('Refresh emails'); wait(READY + ' && ' + COUNT + '===25')
ab('snapshot', '-i')
print(json.dumps({'passed':len(checks),'evidence':str(OUT)}, indent=2))
