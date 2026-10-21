#!/usr/bin/env python3
"""SHO-2923 browser regression checks against disposable localhost fixtures.

Run seed-inbox-ui.py seed --iframe-images first. A task-owned HTTP proxy serves
delayed PNGs/404s; every other request reaches the real local Worker unchanged.
No external image service, browser security bypass, or production credentials.
"""
import argparse
import http.client
import http.server
import json
import pathlib
import struct
import subprocess
import threading
import time
import urllib.parse
import urllib.request
import zlib

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--url', default='http://127.0.0.1:52923')
parser.add_argument('--session', default='sho2923-iframe')
parser.add_argument('--out', default='../artifacts/iframe-qa')
args = parser.parse_args()
upstream = urllib.parse.urlparse(args.url)
assert upstream.scheme == 'http' and upstream.hostname in ('127.0.0.1', 'localhost')
out = pathlib.Path(args.out).resolve()
out.mkdir(parents=True, exist_ok=True)
commands, checks, image_requests = [], [], []


def png():
    def chunk(kind, data):
        return struct.pack('!I', len(data)) + kind + data + struct.pack('!I', zlib.crc32(kind + data))
    # Portrait image with colored bands, making the bottom edge easy to identify.
    rows = b''.join(b'\0' + bytes((40 + y // 15, 110, 180)) * 320 for y in range(2400))
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', 320, 2400, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b''))


IMAGE = png()


class Proxy(http.server.BaseHTTPRequestHandler):
    def log_message(self, *unused):
        pass

    def do_GET(self):
        path = urllib.parse.urlparse(self.path)
        if path.path.startswith('/__qa2923/'):
            delay = float(urllib.parse.parse_qs(path.query)['delay'][0])
            start = time.monotonic()
            time.sleep(delay)
            status = 404 if 'missing' in path.path else 200
            body = b'Not found' if status == 404 else IMAGE
            self.send_response(status)
            self.send_header('Content-Type', 'image/png')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            cancelled = False
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                cancelled = True  # A replaced/collapsed iframe can cancel its request.
            image_requests.append({'path': self.path, 'status': status,
                                   'elapsed': time.monotonic() - start, 'cancelled': cancelled})
            return
        self.forward()

    def forward(self):
        connection = http.client.HTTPConnection(upstream.hostname, upstream.port, timeout=30)
        headers = {key: value for key, value in self.headers.items()
                   if key.lower() not in ('host', 'connection', 'upgrade', 'accept-encoding')}
        body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        try:
            connection.request(self.command, self.path, body, headers)
            response = connection.getresponse()
            data = response.read()
            self.send_response(response.status)
            for key, value in response.getheaders():
                if key.lower() not in ('connection', 'transfer-encoding', 'content-length'):
                    self.send_header(key, value)
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            connection.close()

    do_POST = do_PUT = do_DELETE = forward


def ab(*arguments):
    result = subprocess.run(['agent-browser', '--session', args.session, '--json', *arguments],
                            capture_output=True, text=True, timeout=60)
    commands.append({'command': arguments, 'stdout': result.stdout, 'stderr': result.stderr, 'exit': result.returncode})
    (out / 'commands.json').write_text(json.dumps(commands, indent=2))
    assert result.returncode == 0, result.stdout + result.stderr
    response = json.loads(result.stdout)
    assert response['success'], response
    return response.get('data', {})


def js(script):
    return ab('eval', script).get('result')


def wait(script):
    ab('wait', '--fn', script)


def frame_js(expression):
    # agent-browser's eval currently stays in the parent for these OOPIFs.
    # Attach only to srcdoc targets in this task's own browser, using Node's
    # built-in WebSocket (no test dependency or browser security flags).
    endpoint = ab('get', 'cdp-url')['cdpUrl']
    program = """
    const ws = new WebSocket(process.argv[1]);
    await new Promise((resolve, reject) => {ws.onopen=resolve;ws.onerror=reject});
    let id=0; const pending=new Map();
    ws.onmessage = event => {
        const message=JSON.parse(event.data);
        if (message.id) {pending.get(message.id)(message);pending.delete(message.id)}
    };
    async function call(method,params={},sessionId) {
        const response=await new Promise(resolve=>{
            pending.set(++id,resolve);ws.send(JSON.stringify({id,method,params,sessionId}));
        });
        if(response.error) throw Error(JSON.stringify(response.error));
        return response.result;
    }
    try {
        const {targetInfos}=await call('Target.getTargets');
        let found=false;
        for (const target of targetInfos.filter(t=>t.type==='iframe'&&t.url==='about:srcdoc')) {
            const {sessionId}=await call('Target.attachToTarget',{targetId:target.targetId,flatten:true});
            const marker=await call('Runtime.evaluate',{expression:'!!document.querySelector("#qa-end")',returnByValue:true},sessionId);
            if(!marker.result.value) continue;
            const result=await call('Runtime.evaluate',{expression:process.argv[2],returnByValue:true,awaitPromise:true},sessionId);
            if(result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
            console.log(JSON.stringify(result.result.value));found=true;break;
        }
        if(!found) throw Error('QA iframe target not found');
    } finally {ws.close()}
    """
    result = subprocess.run(['node', '--input-type=module', '-e', program, endpoint, expression],
                            capture_output=True, text=True, timeout=20)
    commands.append({'frameExpression': expression, 'stdout': result.stdout, 'stderr': result.stderr, 'exit': result.returncode})
    (out / 'commands.json').write_text(json.dumps(commands, indent=2))
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def check(name, passed, evidence):
    checks.append({'check': name, 'pass': bool(passed), 'evidence': evidence})
    (out / 'checks.json').write_text(json.dumps(checks, indent=2))
    print(('PASS ' if passed else 'FAIL ') + name, flush=True)


def api(path, body=None):
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(args.url + path, data=data, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.load(response)


def open_mail(name, public=False):
    ab('frame', 'main')
    ab('set', 'viewport', '1440', '1000')
    ab('open', origin + ('/s/' + token if public else '/'))
    selector = f'.mail-row[data-email-id="qa2923-{name}"]'
    wait(f'!!document.querySelector({json.dumps(selector)})')
    ab('snapshot', '-i')
    ab('scrollintoview', selector)
    ab('click', selector)
    wait(f"document.querySelector('iframe')?.srcdoc.includes('AFTER {name}')")


def measure():
    # CDP frame context can inspect opaque origins without changing the sandbox.
    # Allow the production message/React render to settle; no QA resize messages.
    result = frame_js("""(async () => {
        await Promise.all(Array.from(document.images).map(image => image.complete ? null :
            new Promise(resolve => {image.addEventListener('load',resolve,{once:true});
                image.addEventListener('error',resolve,{once:true})})));
        await new Promise(resolve => setTimeout(resolve,150));
        const text = document.createRange();
        text.selectNodeContents(document.querySelector('#qa-end'));
        const end = text.getBoundingClientRect();
        return {height: innerHeight, content: document.body.scrollHeight,
            bodyHeight: document.body.getBoundingClientRect().height, end: end.bottom,
            overflow: getComputedStyle(document.body).overflowY,
            images: Array.from(document.images).map(i => ({complete:i.complete,
                naturalHeight:i.naturalHeight, height:i.getBoundingClientRect().height})),
            csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]').content};
    })()""")
    result['sandbox'] = js("document.querySelector('iframe').getAttribute('sandbox')")
    return result


def fits(m):
    return m['height'] >= m['content'] and m['height'] >= m['end']


def layout():
    return js("""(() => {
        const frames = [...document.querySelectorAll('.mail-detail-pane iframe')];
        const scrolls = [...document.querySelectorAll('.mail-detail-pane *')].filter(e =>
            /auto|scroll/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight);
        return {frames: frames.length, scrolls: scrolls.length,
            overlap: frames.some((f,i) => i && frames[i-1].getBoundingClientRect().bottom > f.getBoundingClientRect().top),
            bodyScroll: document.documentElement.scrollHeight > innerHeight};
    })()""")


server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Proxy)
thread = threading.Thread(target=server.serve_forever)
thread.start()
origin = f'http://127.0.0.1:{server.server_port}'
try:
    share = api('/api/v1/mailboxes/sales%40example.test/share-link')
    if not share.get('token'):
        share = api('/api/v1/mailboxes/sales%40example.test/share-link/reset', {})
    token = share['token']
    for public, number in ((False, 1), (True, 2)):
        open_mail('late', public)
        m = measure()
        check(f'@E{number} delayed tall image and trailing text fit', fits(m)
              and m['images'][0]['naturalHeight'] >= 2000 and m['images'][0]['height'] >= 2000, m)
    open_mail('multi')
    m = measure()
    check('@E3 staggered images fit after all loads', fits(m)
          and len(m['images']) == 2 and all(i['naturalHeight'] == 2400 for i in m['images']), m)
    open_mail('reflow')
    desktop = measure()
    ab('set', 'viewport', '390', '844')
    mobile = measure()
    check('@E4 desktop to mobile reflow remains visible', fits(desktop) and fits(mobile)
          and mobile['content'] > desktop['content'], {'desktop': desktop, 'mobile': mobile})
    open_mail('short')
    m = measure()
    check('@E5 short text has no blank space or internal scrollbar',
          0 <= m['height'] - m['content'] <= 24 and m['overflow'] == 'hidden', m)
    open_mail('broken')
    samples = [measure()]
    # Sample over a full ten seconds after the 404, also detecting runaway loops.
    for unused in range(5):
        ab('wait', '2000')
        samples.append(measure())
    check('@E6 failed image leaves text visible and height stable for 10 seconds',
          all(fits(m) for m in samples) and len({m['height'] for m in samples}) == 1
          and samples[0]['images'][0]['naturalHeight'] == 0, samples)
    expected_csp = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data: cid: https:; script-src 'unsafe-inline';"
    expected_sandbox = 'allow-scripts allow-popups allow-top-navigation-by-user-activation'
    check('@E7 sandbox and CSP remain byte-for-byte unchanged',
          samples[0]['csp'] == expected_csp and samples[0]['sandbox'] == expected_sandbox, samples[0])
    open_mail('single')
    m = measure()
    end = frame_js("(async()=>{window.scrollTo(0,document.body.scrollHeight);await new Promise(r=>setTimeout(r,150));return {top:document.querySelector('#qa-end').getBoundingClientRect().top,bottom:document.querySelector('#qa-end').getBoundingClientRect().bottom,height:innerHeight,scroll:scrollY}})()")
    check('@E8 SingleMessageView scrolls to the end', m['content'] > m['height']
          and end['scroll'] > 0 and 0 <= end['top'] < end['bottom'] <= end['height'], end)
    for width in (1440, 390):
        open_mail('late')
        ab('set', 'viewport', str(width), '900')
        m = measure()
        # Expand the other two real messages, then collapse/reopen the image mail.
        js("document.querySelectorAll('.mail-detail-pane button.w-full').forEach(b => b.click())")
        wait("document.querySelectorAll('.mail-detail-pane iframe').length === 3")
        before = layout()
        ab('screenshot', str(out / f'thread-{width}-top.png'))
        js("document.querySelector('button[aria-label=\"Collapse message\"]').click()")
        wait("document.querySelectorAll('.mail-detail-pane iframe').length === 2")
        js("document.querySelector('.mail-detail-pane button.w-full').click()")
        wait("document.querySelectorAll('.mail-detail-pane iframe').length === 3")
        reopened = measure()
        after = layout()
        js("(() => {let e=document.querySelector('iframe').parentElement;while(e&&!(/auto|scroll/.test(getComputedStyle(e).overflowY)&&e.scrollHeight>e.clientHeight))e=e.parentElement;if(e)e.scrollTop=2200})()")
        ab('screenshot', str(out / f'thread-{width}-bottom.png'))
        check(f'@F1 {width}px three messages, one panel scrollbar, collapse/reopen',
              fits(m) and fits(reopened) and all(v['frames'] == 3 and v['scrolls'] == 1
              and not v['overlap'] and not v['bodyScroll'] for v in (before, after)),
              {'before': before, 'after': after, 'reopened': reopened})
    check('Delayed image responses really take at least 1.5s', bool(image_requests)
          and all(r['elapsed'] >= 1.5 for r in image_requests), image_requests)
    for name in ('vh', 'min-vh'):
        for public in (False, True):
            open_mail(name, public)
            samples = frame_js("""(async () => {
                await new Promise(resolve => setTimeout(resolve,150));
                const samples = [];
                for (let i = 0; i <= 5; i++) {
                    if (i) await new Promise(resolve => setTimeout(resolve,2000));
                    samples.push({time:performance.now(), height:innerHeight,
                        content:document.body.scrollHeight});
                }
                return samples;
            })()""")
            check(f'@R1-1 {name} {"share" if public else "thread"} stable for 10 seconds',
                  samples[-1]['time'] - samples[0]['time'] >= 10000
                  and len({s['height'] for s in samples}) == 1
                  and all(0 < s['height'] <= s['content'] + 24 for s in samples), samples)
finally:
    (out / 'image-requests.json').write_text(json.dumps(image_requests, indent=2))
    try:
        ab('close')
    finally:
        server.shutdown()
        server.server_close()
        thread.join()

raise SystemExit(0 if all(c['pass'] for c in checks) else 1)
