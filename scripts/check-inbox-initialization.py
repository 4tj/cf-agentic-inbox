#!/usr/bin/env python3
"""Explicitly mocked browser-only config/creation failure recovery. No mailbox
writes reach the Worker. Verifies retry is enabled and creation runs only once
per attempt, including a first failed config fetch and a later failed creation.
"""
import argparse, base64, json, pathlib, subprocess, time, urllib.parse
p = argparse.ArgumentParser()
p.add_argument('--url', default='http://127.0.0.1:52811')
p.add_argument('--session', default='sho2811-initialization')
p.add_argument('--out', default='../artifacts/initialization-qa')
args = p.parse_args()
assert urllib.parse.urlparse(args.url).hostname in ('127.0.0.1', 'localhost')
out = pathlib.Path(args.out).resolve(); out.mkdir(parents=True, exist_ok=True)
log = []
def ab(*cmd):
    result = subprocess.run(['agent-browser', '--session', args.session, '--json', *cmd], text=True, capture_output=True, timeout=65)
    log.append({'command':list(cmd), 'stdout':result.stdout, 'stderr':result.stderr, 'exit':result.returncode})
    (out/'commands.json').write_text(json.dumps(log, indent=2))
    assert result.returncode == 0, (cmd, result.stdout, result.stderr)
    data = json.loads(result.stdout); assert data['success'], data
    if cmd[0] == 'close': time.sleep(0.5)
    return data.get('data', {})
def wait(code): ab('wait', '--fn', 'Boolean('+code+')')
def reload_list(): ab('find', 'role', 'button', 'click', '--name', 'Reload list', '--exact')
ab('close'); ab('open', 'about:blank')
ab('network', 'route', '**/api/v1/config', '--abort')
ab('open', args.url+'/')
wait('document.body.innerText.includes("List not fully loaded") && !Array.from(document.querySelectorAll("button")).find(b=>b.innerText==="Reload list")?.disabled')
fixture = (pathlib.Path(__file__).parent/'fixtures/directory-init-mock.js').read_text()
fixture += '\nwindow.__initQA.failConfig=false;window.__initQA.failCreate=true;'
ab('eval', '-b', base64.b64encode(fixture.encode()).decode())
reload_list(); wait('document.body.innerText.includes("Fixture creation unavailable")')
first = ab('eval', 'window.__initQA').get('result')
assert first['attempts'] == 1 and not first['created'], first
ab('eval', 'window.__initQA.failCreate=false')
reload_list(); wait('document.body.innerText.includes("No emails")')
ab('click', 'nav[aria-label="Email categories"] a:nth-child(2)')
wait('location.pathname==="/all/sent" && document.body.innerText.includes("No emails")')
recovered = ab('eval', 'window.__initQA').get('result')
assert recovered['attempts'] == 2 and len(recovered['created']) == 1, recovered
(out/'checks.json').write_text(json.dumps({'pass':True, 'scope':'browser-only mocked config/creation, no real mailbox writes', 'failedCreation':first, 'recoveredAfterNavigation':recovered}, indent=2))
ab('close')
print(json.dumps({'pass':True, 'evidence':str(out)}, indent=2))
