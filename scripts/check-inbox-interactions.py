#!/usr/bin/env python3
"""Local browser acceptance: compose guards, source identity, Agent, public share,
and responsive panes. No real outbound email: the send endpoint is deliberately
failed inside this browser before it can reach the Worker. AI is not invoked.
"""
import argparse, json, pathlib, subprocess, time, urllib.parse, urllib.request, urllib.error
p=argparse.ArgumentParser(); p.add_argument('--url',default='http://127.0.0.1:52811');p.add_argument('--session',default='sho2811-interactions');p.add_argument('--out',default='../artifacts/interactions-qa');args=p.parse_args()
assert urllib.parse.urlparse(args.url).hostname in ('127.0.0.1','localhost')
out=pathlib.Path(args.out).resolve();out.mkdir(parents=True,exist_ok=True)
log=[];checks=[]
def ab(*cmd):
    r=subprocess.run(['agent-browser','--session',args.session,'--json',*cmd],capture_output=True,text=True,timeout=65)
    log.append({'command':list(cmd),'stdout':r.stdout,'stderr':r.stderr,'exit':r.returncode});(out/'commands.json').write_text(json.dumps(log,indent=2))
    assert r.returncode==0,(cmd,r.stdout,r.stderr)
    d=json.loads(r.stdout);assert d['success'],d
    if cmd[0]=='close': time.sleep(0.5)  # agent-browser acknowledges before its daemon exits
    return d.get('data',{})
def js(code):return ab('eval',code).get('result')
def wait(code):return ab('wait','--fn','Boolean('+code+')')
def click(selector):return ab('click',selector)
def button(name):return ab('find','role','button','click','--name',name,'--exact')
def check(name,yes,detail=None):
    assert yes,(name,detail)
    checks.append({'check':name,'pass':True,'evidence':detail});(out/'checks.json').write_text(json.dumps(checks,indent=2))
def api(path,body=None):
    with urllib.request.urlopen(urllib.request.Request(args.url+path,data=None if body is None else json.dumps(body).encode(),headers={'Content-Type':'application/json'}),timeout=20) as r:return json.load(r)
def capture(name):ab('snapshot','-i');ab('screenshot',str(out/name))
ready="!document.querySelector('button[aria-label=\"Refresh emails\"]')?.disabled"
root="location.pathname==='/'"
row='.mail-row[data-mailbox="sales@example.test"][data-email-id="qa2811-email-001"]'
ab('close');ab('open',args.url+'/');ab('set','viewport','1440','1000');wait(ready+' && document.querySelectorAll(".mail-row").length===25')
# Establish a router history entry for the unsaved browser-Back guard.
click('nav[aria-label="Email categories"] a:nth-child(2)');wait("location.pathname==='/all/sent' && "+ready)
click('nav[aria-label="Email categories"] a:first-child');wait(root+' && '+ready)
click(row);wait('document.querySelector("button[aria-label=Reply]")');click('button[aria-label="Reply"]');wait('document.querySelector("input[placeholder^=Email]")')
check('reply shows selected source From and actual recipient',js("document.querySelector('.mail-detail-pane').innerText.includes('From: sales@example.test')&&document.querySelector('input[placeholder=\"recipient@example.com\"]').value==='buyer0@customer.test'"))
ab('fill','input[placeholder="Email subject"]','QA2811 guarded reply')
js("window.__confirmCalls=0;window.__allowDiscard=false;window.confirm=()=>{window.__confirmCalls++;return window.__allowDiscard;}")
for selector in ('nav[aria-label="Email categories"] a:nth-child(2)','nav[aria-label="Mailboxes"] a[href*="info%40"]','a[href="/manage"]','button[aria-label="Close compose"]'):
    before=js('window.__confirmCalls');click(selector);wait('window.__confirmCalls>'+str(before));check('unsaved guard: '+selector,js(root+" && document.querySelector('input[placeholder=\"Email subject\"]').value==='QA2811 guarded reply'"))
before=js('window.__confirmCalls');ab('fill','input[aria-label="Search emails"]','in:spam example');ab('press','Enter');wait('window.__confirmCalls>'+str(before));check('unsaved search guard retains composer',js(root+" && !!document.querySelector('input[placeholder=\"Email subject\"]')"))
before=js('window.__confirmCalls');ab('back');wait('window.__confirmCalls>'+str(before));check('unsaved browser Back guard retains composer',js(root+" && !!document.querySelector('input[placeholder=\"Email subject\"]')"))
button('Refresh emails');wait(ready);check('list rebuild does not discard editing',js("document.querySelector('input[placeholder=\"Email subject\"]').value==='QA2811 guarded reply'"))
button('Save as Draft');wait("document.body.innerText.includes('Draft saved')");before=js('window.__confirmCalls')
click('nav[aria-label="Email categories"] a:nth-child(2)');wait("location.pathname==='/all/sent' && "+ready)
check('manual draft save releases navigation guard',js('window.__confirmCalls')==before)
drafts=api('/api/v1/mailboxes/sales%40example.test/search?subject=QA2811%20guarded%20reply&folder=draft&limit=25')
check('draft persisted through real source-mailbox API',len(drafts['emails'])>=1)
click('nav[aria-label="Email categories"] a:first-child');wait(root+' && '+ready)
# New aggregate compose must ask for a sender. Test a regular attachment and a
# failed outbound request without ever sending to the server or external mail.
button('Compose');wait("document.querySelector('[role=dialog]')?.innerText.includes('Choose the sending mailbox')")
check('All Inboxes does not guess a sending mailbox',js("!document.querySelector('input[placeholder=\"Email subject\"]')"))
button('info@example.test');wait("document.querySelector('.mail-detail-pane').innerText.includes('From: info@example.test')")
ab('fill','input[placeholder="recipient@example.com"]','buyer@customer.test');ab('fill','input[placeholder="Email subject"]','QA2811 local failure')
ab('fill','[contenteditable=true]','Local QA only — do not deliver.')
ab('upload','input[type=file]',str(pathlib.Path('docs/fixtures/qa2811-note.txt').resolve()))
wait("document.querySelector('.mail-detail-pane').innerText.includes('qa2811-note.txt')")
js("window.__baseFetch=window.fetch;window.__outgoing=[];window.fetch=async(input,init)=>{const u=new URL(typeof input==='string'?input:input.url,location.origin);if(init?.method==='POST'&&/\\/(emails|reply|forward)$/.test(u.pathname)){window.__outgoing.push({path:u.pathname,body:JSON.parse(init.body)});return new Response(JSON.stringify({error:'Intentional local send failure; nothing delivered'}),{status:503,headers:{'Content-Type':'application/json'}});}return window.__baseFetch(input,init)}")
button('Send');wait("document.body.innerText.includes('Intentional local send failure')")
payload=js('window.__outgoing[0]');check('send failure preserves composer and source + attachments',payload['path']=='/api/v1/mailboxes/info@example.test/emails' and len(payload['body']['attachments'])==1 and js("document.querySelector('input[placeholder=\"Email subject\"]').value==='QA2811 local failure'"),payload)
js('window.__allowDiscard=true');button('Discard');wait("!document.querySelector('input[placeholder=\"Email subject\"]')")
# Explicit Agent opening with no selected message must first choose a mailbox.
js("window.__ws=[];window.WebSocket=new Proxy(window.WebSocket,{construct(target,args){window.__ws.push(String(args[0]));return Reflect.construct(target,args)}})")
check('no Agent connection before the click',not ab('network','requests','--filter','/agents/').get('requests'))
click('button[aria-label="Open Agent"]');wait("document.querySelector('[role=dialog]')?.innerText.includes('Choose an Agent mailbox')")
check('Agent mailbox picker has not connected yet',js('window.__ws.length===0'))
button('sales@example.test');wait('window.__ws.length>0');wait("document.querySelector('[role=dialog]')?.innerText.includes('Agent · sales@example.test')")
check('Agent connects only to chosen mailbox',js("window.__ws.every(url=>decodeURIComponent(url).includes('sales@example.test')&&!url.includes('default'))"),js('window.__ws'))
click('button[aria-label="Close Agent"]');wait("!document.querySelector('[role=dialog]')")
check('Agent closes without clearing history',not ab('network','requests','--filter','clear-history').get('requests'))
click(row);wait("document.querySelector('.mail-detail-pane').innerText.includes('Mailbox: sales@example.test')")
click('button[aria-label="Open Agent"]');wait('window.__ws.length>1');check('Agent reopen uses selected email mailbox',js("document.querySelector('[role=dialog]').innerText.includes('Agent · sales@example.test')"))
button('MCP');wait("document.querySelector('[role=dialog]').innerText.includes('Connect via MCP')");check('MCP tab retained',True)
click('button[aria-label="Close Agent"]');wait("!document.querySelector('[role=dialog]')");click('button[aria-label="Back to list"]')
# At medium and mobile widths panes switch rather than overflowing or shrinking
# a four-column workspace. DOM list stays mounted so Back preserves its scroll.
for width in (1024,390):
    ab('set','viewport',str(width),'844');wait(ready)
    check(f'{width}px list has no horizontal overflow',js('document.documentElement.scrollWidth<=innerWidth'))
    js("document.querySelector('[data-testid=mail-list-scroll]').scrollTop=400")
    click('.mail-row[data-mailbox="sales@example.test"][data-email-id="qa2811-email-002"]');wait("document.querySelector('.mail-detail-pane').innerText.includes('Mailbox: sales@example.test')")
    check(f'{width}px detail has no horizontal overflow',js('document.documentElement.scrollWidth<=innerWidth'))
    if width==390:capture('mobile-detail.png')
    click('button[aria-label="Back to list"]');check(f'{width}px Back restores list scroll',js("document.querySelector('[data-testid=mail-list-scroll]').scrollTop===400"))
click('button[aria-label="Open inbox navigation"]');wait("document.querySelector('[role=dialog]')?.innerText.includes('Inboxes')")
check('mobile navigation focus stays inside drawer',js("!!document.activeElement.closest('[role=dialog]')"));ab('press','Escape');wait("!document.querySelector('[role=dialog]')")
check('mobile drawer restores trigger focus',js("document.activeElement.getAttribute('aria-label')==='Open inbox navigation'"))
capture('mobile-list.png')

# Public route uses a real local token, thread data and attachment, but no private
# list/hooks, mutation controls, search or Agent. Local DEV bypasses Access; this
# check is not proof of production JWT enforcement.
share=api('/api/v1/mailboxes/sales%40example.test/share-link')
if not share.get('token'):share=api('/api/v1/mailboxes/sales%40example.test/share-link/reset',{})
token=share['token'];(out/'local-share.json').write_text(json.dumps(share,indent=2))
read_before=api('/api/v1/mailboxes/sales%40example.test/emails/qa2811-email-003')['read']
assert read_before is False, 'Read-only check requires an unread fixture message'
ab('close');ab('open',args.url+'/s/'+token);ab('set','viewport','1440','1000');wait("document.querySelectorAll('.mail-row').length===25")
check('Share uses no private API calls or Agent',not ab('network','requests','--filter','/api/v1/').get('requests') and not ab('network','requests','--filter','/agents/').get('requests'))
check('Share shows one mailbox and no private navigation/actions/search',js("Array.from(document.querySelectorAll('input')).every(e=>e.getAttribute('aria-label')==='Page number')&&!document.body.innerText.includes('info@example.test')&&!document.body.innerText.includes('support.with')&&!Array.from(document.querySelectorAll('button,a')).some(e=>['Send','Spam','Reply','Compose','Agent','All Inboxes','Manage mailboxes'].includes(e.innerText))"))
click('.mail-row[data-email-id="qa2811-email-000"]');wait("document.querySelector('.mail-detail-pane').innerText.includes('3 messages in this thread')")
check('Share retains sent context but not draft context',js("document.querySelector('.mail-detail-pane').innerText.includes('qa2811-note.txt')&&!document.body.innerText.includes('PRIVATE DRAFT')"))
attachment=args.url+'/api/public/share/'+token+'/emails/qa2811-email-000/attachments/qa2811-attachment'
with urllib.request.urlopen(attachment) as response:check('Shared attachment reads real local R2 bytes',response.read()==b'Local QA attachment only.\n')
try:api('/api/public/share/'+token+'/emails/qa2811-draft-context');raise AssertionError('Draft leaked')
except urllib.error.HTTPError as e:check('Public API rejects a guessed draft ID',e.code==404)
capture('share-desktop.png')
click('.mail-row[data-email-id="qa2811-email-003"]');wait("document.querySelector('.mail-detail-pane').innerText.includes('Order update 003')")
check('Share reading does not mark an email read',api('/api/v1/mailboxes/sales%40example.test/emails/qa2811-email-003')['read']==read_before)
ab('set','viewport','360','800');check('360px Share detail has no overflow',js('document.documentElement.scrollWidth<=innerWidth'));click('button[aria-label="Back to inbox"]');capture('share-mobile.png')
# A transient list error must not be rendered as an empty successful inbox.
js("window.__realFetch=window.fetch;window.fetch=async(input,init)=>{const u=new URL(typeof input==='string'?input:input.url,location.origin);if(u.pathname.endsWith('/emails'))return new Response(JSON.stringify({error:'Local shared-list fault'}),{status:503,headers:{'Content-Type':'application/json'}});return window.__realFetch(input,init)}")
button('Refresh');wait("document.body.innerText.includes('Could not load emails')");check('Share network failure is not an empty inbox',js("!document.body.innerText.includes('Inbox is empty')"));js('window.fetch=window.__realFetch');button('Retry');wait("!document.body.innerText.includes('Could not load emails')")
ab('open',args.url+'/s/invalid-qa2811-token');wait("document.body.innerText.includes('Share link not found')");check('invalid share token stays unavailable',True)
print(json.dumps({'passed':len(checks),'evidence':str(out)},indent=2))
