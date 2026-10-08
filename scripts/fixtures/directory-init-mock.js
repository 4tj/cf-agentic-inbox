(() => {
  const original = window.fetch.bind(window);
  const mailbox = {id: 'configured.qa2811@example.test', email: 'configured.qa2811@example.test', name: 'Configured QA', unreadCount: 0};
  const creationCase = new URL(location.href).searchParams.has('creation-failure');
  window.__initQA = { failConfig: !creationCase, failCreate: creationCase, attempts: 0, created: [], requests: [] };
  const json = (body, status=200) => new Response(JSON.stringify(body), { status, headers: {'Content-Type':'application/json'} });
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.origin);
    const state = window.__initQA;
    if (!url.pathname.startsWith('/api/v1/')) return original(input, init);
    state.requests.push({method: init?.method || 'GET', path:url.pathname});
    if (url.pathname === '/api/v1/config') return state.failConfig ? json({error:'Fixture config unavailable'},503) : json({domains:[],emailAddresses:[mailbox.email]});
    if (url.pathname === '/api/v1/mailboxes') {
      if (init?.method === 'POST') {
        state.attempts++;
        if (state.failCreate) return json({error:'Fixture creation unavailable'},503);
        if (state.created.length) return json({error:'Duplicate creation detected'},409);
        state.created.push(mailbox); return json(mailbox,201);
      }
      return json(state.created);
    }
    if (url.pathname === '/api/v1/mailboxes/'+mailbox.id+'/emails') return json({emails:[], totalCount:0});
    if (url.pathname === '/api/v1/mailboxes/'+mailbox.id) return json(mailbox);
    return original(input, init);
  };
})();
