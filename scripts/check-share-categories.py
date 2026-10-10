#!/usr/bin/env python3
"""SHO-2822 local Share QA; use fresh seed-inbox-ui.py fixtures and local R2 attachment."""
import argparse, json, pathlib, subprocess, time, urllib.parse, urllib.request, urllib.error
p=argparse.ArgumentParser(); p.add_argument('--url',default='http://127.0.0.1:52811');p.add_argument('--session',default='sho2822-share');p.add_argument('--profile');p.add_argument('--cdp');p.add_argument('--out',default='../artifacts/share-qa');args=p.parse_args()
assert urllib.parse.urlparse(args.url).hostname in ('127.0.0.1','localhost')
out=pathlib.Path(args.out).resolve();out.mkdir(parents=True,exist_ok=True)
log=[];checks=[]
def ab(*cmd):
    r=subprocess.run(['agent-browser','--session',args.session,'--json',*(['--profile',args.profile] if args.profile else []),*(['--cdp',args.cdp] if args.cdp else []),*cmd],capture_output=True,text=True,timeout=55)
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

share = api('/api/v1/mailboxes/sales%40example.test/share-link')
if not share.get('token'):
    share = api('/api/v1/mailboxes/sales%40example.test/share-link/reset', {})
token = share['token']
base = '/api/public/share/' + token
read_before = api('/api/v1/mailboxes/sales%40example.test/emails/qa2811-spam')['read']
assert read_before is False, 'Requires unread Spam fixture'
ab('open', args.url + '/s/' + token)
ab('set', 'viewport', '1440', '1000')
wait("document.querySelectorAll('.mail-row').length===25")
ab('snapshot', '-i')
check('All initially selected', js("document.querySelector('nav[aria-label=\"Email categories\"] [aria-current=page]').textContent==='All'"))
check('All has Inbox count and no Spam', api(base+'/emails')['totalCount']==80 and all(e['folder_id']=='inbox' for e in api(base+'/emails')['emails']))
ab('fill', 'input[aria-label="Page number"]', '2')
ab('press', 'Enter')
wait("document.querySelector('input[aria-label=\"Page number\"]').value==='2' && !document.querySelector('button[aria-label=Refresh]').disabled")
button('Spam')
wait("document.querySelectorAll('.mail-row').length===1 && document.querySelector('.mail-row').innerText.includes('Spam example')")
ab('snapshot', '-i')
check('Spam only with its own count', api(base+'/emails?folder=spam')['totalCount']==1)
check('Changing category clears detail and resets pagination', js("document.querySelector('.mail-detail-pane').innerText.includes('Select an email') && !document.querySelector('input[aria-label=\"Page number\"]')"))
click('.mail-row[data-email-id="qa2811-spam"]')
wait("document.querySelector('.mail-detail-pane h2')?.textContent==='Spam example'")
check('Spam body loads through public detail and thread', api(base+'/emails/qa2811-spam')['body'].find('Spam example')>=0 and len(api(base+'/threads/qa2811-spam'))==1)
check('Spam stays unread', api('/api/v1/mailboxes/sales%40example.test/emails/qa2811-spam')['read']==read_before)
wait("document.querySelector('iframe[title=\"Email content\"]')?.srcdoc.includes('Spam example')")
check('Spam body reaches sandboxed iframe', js("document.querySelector('iframe').sandbox.value==='allow-scripts allow-popups allow-top-navigation-by-user-activation'"))
capture('share-spam-desktop.png')
button('All')
wait("document.querySelectorAll('.mail-row').length===25")
check('Returning All uses page 1 and clears Spam detail', js("document.querySelector('input[aria-label=\"Page number\"]').value==='1' && document.querySelector('.mail-detail-pane').innerText.includes('Select an email')"))
click('.mail-row[data-email-id="qa2811-email-000"]')
wait("document.querySelector('.mail-detail-pane').innerText.includes('3 messages in this thread')")
check('Inbox thread still excludes draft', all(e['folder_id']!='draft' for e in api(base+'/threads/qa2811-thread-000')))
with urllib.request.urlopen(args.url+base+'/emails/qa2811-email-000/attachments/qa2811-attachment') as r:
    check('Inbox attachment still serves real local R2 bytes', r.read()==b'Local QA attachment only.\n')
ab('set', 'viewport', '390', '844')
button('Back to inbox')
button('Spam')
wait("document.querySelectorAll('.mail-row').length===1")
check('Mobile Spam tab and list fit viewport', js('document.documentElement.scrollWidth<=innerWidth'))
capture('share-spam-mobile.png')
# Inject only a browser transport fault; all normal responses come from local Worker/DO/R2.
js("window.__realFetch=window.fetch;window.fetch=async(input,init)=>{const u=new URL(typeof input==='string'?input:input.url,location.origin);if(u.pathname.endsWith('/emails'))return new Response(JSON.stringify({error:'Local Spam list fault'}),{status:503,headers:{'Content-Type':'application/json'}});return window.__realFetch(input,init)}")
button('Refresh');wait("document.body.innerText.includes('Could not load emails')")
check('Spam failure not rendered as empty', js("!document.body.innerText.includes('Spam is empty')"))
js('window.fetch=window.__realFetch');button('Retry');wait("!document.body.innerText.includes('Could not load emails')")
check('Retry keeps Spam selected', js("document.querySelector('nav[aria-label=\"Email categories\"] [aria-current=page]').textContent==='Spam'"))
check('No private or Agent requests', not ab('network','requests','--filter','/api/v1/').get('requests') and not ab('network','requests','--filter','/agents/').get('requests'))
check('No write controls', js("!Array.from(document.querySelectorAll('button,a')).some(e=>['Send','Reply','Compose','Agent','Manage mailboxes'].includes(e.innerText))"))
empty=api('/api/v1/mailboxes/empty%40example.test/share-link')
if not empty.get('token'):empty=api('/api/v1/mailboxes/empty%40example.test/share-link/reset',{})
ab('open',args.url+'/s/'+empty['token']);wait("document.body.innerText.includes('Inbox is empty')")
ab('snapshot','-i');button('Spam');wait("document.body.innerText.includes('Spam is empty')")
check('Empty Spam has category-specific state',True)
ab('open',args.url+'/s/invalid-sho2822-token');wait("document.body.innerText.includes('Share link not found')")
check('Invalid token remains unavailable',True)
ab('close')
print(json.dumps({'passed':len(checks),'evidence':str(out)},indent=2))
