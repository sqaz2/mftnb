'use strict';
(() => {
  const config = window.MFTNB_OWNER_CONFIG;
  const $ = id => document.getElementById(id);
  const sessionKey = 'mftnb-owner-session-v1';
  let token = '', leads = [], filter = 'new', selectedId = null, publicKey = null, deviceEnabled = false;
  let registration, installPrompt, securityToken = '', securityWidget, loading = false;
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  function notice(message, error = false) { $('notice').textContent = message; $('notice').classList.toggle('error', error); }
  function bytes64(bytes) { return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function from64(value) { return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)); }
  function randomToken() { return bytes64(crypto.getRandomValues(new Uint8Array(32))); }
  function saveToken(value) { localStorage.setItem(sessionKey, value); token = value; }
  async function api(action, values = {}) {
    if (!navigator.onLine) throw new Error('You’re offline. Reconnect to view or update your leads.');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch(config.endpoint, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, credentials: 'omit', cache: 'no-store', redirect: 'follow', referrerPolicy: 'no-referrer', body: JSON.stringify({ action: 'owner.' + action, token, ...values }), signal: controller.signal });
      const result = await response.json();
      if (!result.ok) {
        if (result.error === 'Please sign in again.') showLogin(true);
        throw new Error(result.error || 'Your inbox is unavailable. Please try again.');
      }
      return result;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('That took too long. Please try again.');
      if (error instanceof TypeError) throw new Error('Unable to connect. Check your internet connection and try again.');
      throw error;
    } finally { clearTimeout(timer); }
  }
  async function withButton(button, work) {
    if (button.disabled) return;
    button.disabled = true;
    try { await work(); } catch (error) { notice(error.message, true); }
    finally { button.disabled = false; }
  }
  function updateInstall() {
    $('install').hidden = standalone();
    $('installHelp').textContent = ios ? 'In Safari, tap Share, then Add to Home Screen. Open MFTNB Leads from its new icon to enable phone alerts.' : 'Use your browser menu and choose Install app or Add to Home screen, then open MFTNB Leads.';
    $('installButton').hidden = !installPrompt || standalone();
  }
  addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; updateInstall(); });
  addEventListener('appinstalled', () => { installPrompt = null; updateInstall(); });
  $('installButton').addEventListener('click', () => withButton($('installButton'), async () => { await installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; updateInstall(); }));
  function setupSecurity() {
    if (document.getElementById('turnstileScript')) return;
    window.mftnbOwnerTurnstile = () => {
      securityWidget = window.turnstile.render('#securityCheck', { sitekey: config.turnstileSiteKey, action: 'owner_login', theme: 'light', size: 'flexible',
        callback: value => { securityToken = value; $('sendCode').disabled = false; },
        'expired-callback': () => { securityToken = ''; $('sendCode').disabled = true; },
        'error-callback': () => { securityToken = ''; $('sendCode').disabled = true; notice('The security check could not load. Refresh and try again.', true); }
      });
    };
    const script = document.createElement('script'); script.id = 'turnstileScript'; script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=mftnbOwnerTurnstile&render=explicit'; script.async = true;
    script.onerror = () => notice('The security check could not load. Refresh and try again.', true);
    document.head.append(script);
  }
  function resetSecurity() { securityToken = ''; $('sendCode').disabled = true; if (window.turnstile && securityWidget !== undefined) window.turnstile.reset(securityWidget); }
  function showLogin(expired = false) {
    token = ''; try { localStorage.removeItem(sessionKey); } catch (_) {}
    leads = []; $('leadList').replaceChildren(); if ($('leadDialog').open) $('leadDialog').close();
    $('welcome').hidden = false;
    $('dashboard').hidden = true; $('logout').hidden = true; $('login').hidden = false;
    $('emailForm').hidden = false; $('codeForm').hidden = true;
    setupSecurity();
    if (expired) notice('Please sign in again to continue.', true);
  }
  $('emailForm').addEventListener('submit', event => {
    event.preventDefault();
    withButton($('sendCode'), async () => {
      if (!securityToken) throw new Error('Please complete the security check.');
      try {
        const result = await api('code', { email: $('email').value.trim(), turnstileToken: securityToken });
        $('emailForm').hidden = true; $('codeForm').hidden = false; $('code').value = ''; $('code').focus(); notice(result.message);
      } finally { resetSecurity(); }
    }).then(() => { if (!securityToken) $('sendCode').disabled = true; });
  });
  $('changeEmail').addEventListener('click', () => { $('emailForm').hidden = false; $('codeForm').hidden = true; resetSecurity(); notice('Enter the owner email, then request a fresh code.'); });
  $('codeForm').addEventListener('submit', event => {
    event.preventDefault();
    withButton($('codeForm').querySelector('button[type=submit]'), async () => {
      const newToken = randomToken();
      // Check storage before consuming the one-time code.
      localStorage.setItem(sessionKey + '-check', '1'); localStorage.removeItem(sessionKey + '-check');
      await api('verify', { code: $('code').value.trim(), newToken }); saveToken(newToken); $('code').value = ''; notice(''); await refresh();
    });
  });
  function safePhone(value) { return String(value || '').replace(/[^+\d]/g, '').replace(/(?!^)\+/g, ''); }
  const dateLabel = value => new Date(Number(value)).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  function element(tag, text, className) { const node = document.createElement(tag); if (text != null) node.textContent = text; if (className) node.className = className; return node; }
  function render() {
    $('newCount').textContent = leads.filter(lead => lead.status === 'new').length + ' new';
    $('leadList').replaceChildren();
    const visible = leads.filter(lead => filter === 'all' || lead.status === filter);
    $('empty').hidden = !!visible.length;
    visible.forEach(lead => {
      const card = element('button', null, 'lead');
      const top = element('span', null, 'leadTop'); top.append(element('span', lead.kind === 'estimate' ? 'ESTIMATE REQUEST' : 'MESSAGE'), element('span', dateLabel(lead.received)));
      const summary = lead.kind === 'estimate' ? (lead.details.pickup || 'Move details received') + (lead.details.dropoff ? ' → ' + lead.details.dropoff : '') : lead.details.message || 'New message';
      const bottom = element('span', null, 'leadBottom'); bottom.append(element('span', lead.status, 'status ' + lead.status), element('span', 'View lead →'));
      card.append(top, element('span', lead.details.name || 'New contact', 'leadName'), element('span', summary.length > 140 ? summary.slice(0, 140) + '…' : summary, 'leadSummary'), bottom);
      card.addEventListener('click', () => openLead(lead)); $('leadList').append(card);
    });
  }
  document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {
    filter = button.dataset.filter; document.querySelectorAll('[data-filter]').forEach(item => item.setAttribute('aria-pressed', String(item === button))); render();
  }));
  function openLead(lead) {
    selectedId = lead.id;
    $('detailKind').textContent = lead.kind === 'estimate' ? 'Estimate request' : 'Quick message';
    $('detailName').textContent = lead.details.name || 'New contact'; $('detailTime').textContent = 'Received ' + dateLabel(lead.received);
    $('contactActions').replaceChildren(); $('detailFields').replaceChildren(); $('detailNotice').textContent = '';
    const phone = safePhone(lead.details.phone);
    if (phone.length >= 7 && phone.length <= 16) {
      [['Call customer', 'tel:'], ['Text customer', 'sms:']].forEach(([label, prefix]) => { const link = element('a', label, 'button'); link.href = prefix + phone; $('contactActions').append(link); });
    }
    const email = String(lead.details.email || '').trim();
    if (/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(email)) { const link = element('a', 'Email customer', 'button secondary'); link.href = 'mailto:' + encodeURIComponent(email); $('contactActions').append(link); }
    const labels = { phone: 'Phone', email: 'Email', pickup: 'Moving from', dropoff: 'Moving to', moveDate: 'Move date', timeWindow: 'Preferred time', homeType: 'Home type', bedrooms: 'Bedrooms', access: 'Access', inventory: 'Special items', extras: 'Extras', notes: 'Move notes', message: 'Message' };
    Object.entries(labels).forEach(([key, label]) => { if (!lead.details[key]) return; const field = element('dl', null, 'detailField'); field.append(element('dt', label), element('dd', lead.details[key])); $('detailFields').append(field); });
    $('leadStatus').value = lead.status; $('leadDialog').showModal();
  }
  $('closeDetail').addEventListener('click', () => $('leadDialog').close());
  $('leadStatus').addEventListener('change', async () => {
    const lead = leads.find(item => item.id === selectedId); if (!lead) return;
    $('leadStatus').disabled = true;
    try { await api('status', { id: selectedId, status: $('leadStatus').value }); lead.status = $('leadStatus').value; render(); $('detailNotice').textContent = 'Status saved.'; }
    catch (error) { $('leadStatus').value = lead.status; $('detailNotice').textContent = error.message; }
    finally { $('leadStatus').disabled = false; }
  });
  function updatePush() {
    const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    const permitted = supported && Notification.permission === 'granted' && deviceEnabled;
    $('pushHeading').textContent = permitted ? 'Phone alerts are on' : 'Hear about the next lead';
    $('pushHelp').textContent = !supported ? 'Phone alerts need a supported browser. Open this page in Safari on iPhone or Chrome on Android.' : ios && !standalone() ? 'Add MFTNB Leads to your home screen, then open its icon to enable alerts.' : Notification.permission === 'denied' ? 'Notifications are blocked. Allow MFTNB in your phone or browser notification settings, then reopen this app.' : permitted ? 'New leads usually trigger an alert within about a minute. Office emails continue as usual.' : 'Enable phone notifications for new estimate requests and messages.';
    $('enablePush').hidden = permitted; $('enablePush').disabled = !supported || ios && !standalone() || supported && Notification.permission === 'denied';
    $('testPush').hidden = !permitted; $('disablePush').hidden = !deviceEnabled;
  }
  async function refresh() {
    if (!token || loading) return; loading = true; $('refresh').disabled = true;
    try {
      const result = await api('inbox'); leads = result.leads; publicKey = result.publicKey; deviceEnabled = result.notificationsEnabled;
      if (deviceEnabled && registration && 'PushManager' in window && !(await registration.pushManager.getSubscription())) deviceEnabled = false;
      $('welcome').hidden = true;
      $('login').hidden = true; $('dashboard').hidden = false; $('logout').hidden = false; render(); updatePush();
      $('freshness').textContent = 'Updated ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + ' · Latest 200 leads';
      if (deviceEnabled && (!result.lastDeliveryRun || Date.now() - result.lastDeliveryRun > 600000)) notice('The alert service needs attention. Check this inbox and your office email for new leads.', true);
      else notice('');
    } finally { loading = false; $('refresh').disabled = false; }
  }
  $('refresh').addEventListener('click', () => refresh().catch(error => notice(error.message, true)));
  $('enablePush').addEventListener('click', () => {
    // Request directly in the gesture; Safari must not wait for a network call first.
    const permission = Notification.requestPermission();
    withButton($('enablePush'), async () => {
      if (await permission !== 'granted') { updatePush(); throw new Error('Allow notifications to receive new-lead alerts.'); }
      registration = registration || await navigator.serviceWorker.ready;
      if (!publicKey) {
        const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
        const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
        const key = bytes64(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
        const result = await api('keys', { privateKey: privateJwk.d, publicKey: key }); publicKey = result.publicKey;
      }
      let subscription = await registration.pushManager.getSubscription();
      if (subscription && subscription.options.applicationServerKey && bytes64(new Uint8Array(subscription.options.applicationServerKey)) !== publicKey) { await subscription.unsubscribe(); subscription = null; }
      subscription = subscription || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: from64(publicKey) });
      await api('subscribe', { subscription: subscription.toJSON() }); deviceEnabled = true; updatePush(); notice('Notifications are enabled. Send a test alert to check this phone.');
    });
  });
  $('testPush').addEventListener('click', () => withButton($('testPush'), async () => { await api('test'); notice('Test accepted by the notification service. Look for “New MFTNB lead” on this phone.'); }));
  $('disablePush').addEventListener('click', () => withButton($('disablePush'), async () => { await api('unsubscribe'); const subscription = registration && await registration.pushManager.getSubscription(); if (subscription) await subscription.unsubscribe(); deviceEnabled = false; updatePush(); notice('Phone alerts are off. Your inbox and office emails are still available.'); }));
  $('logout').addEventListener('click', () => withButton($('logout'), async () => {
    // Revoke on the server before removing local credentials, so failure is visible and retryable.
    await api('logout'); const subscription = registration && await registration.pushManager.getSubscription(); if (subscription) await subscription.unsubscribe(); showLogin(); notice('Signed out. Alerts are off on this phone.');
  }));
  addEventListener('offline', () => notice('You’re offline. Reconnect to refresh your leads.', true));
  addEventListener('online', () => { if (token) refresh().catch(error => notice(error.message, true)); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && token) refresh().catch(error => notice(error.message, true)); });
  async function start() {
    updateInstall();
    if ('serviceWorker' in navigator && window.isSecureContext) {
      registration = await navigator.serviceWorker.register('/owner/sw.js', { scope: '/owner/', updateViaCache: 'none' });
      navigator.serviceWorker.addEventListener('message', event => { if (event.data?.type === 'leads-updated' && token) refresh().catch(error => notice(error.message, true)); });
    }
    const response = await fetch(config.endpoint + '?action=owner-status', { credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
    const status = await response.json();
    if (status.ownerApp !== 1 || !status.enabled) { notice('Your owner inbox is being connected. Sign-in and alerts will be available when setup is complete.'); return; }
    try { token = localStorage.getItem(sessionKey) || ''; } catch (_) { throw new Error('Allow website storage in your browser to sign in securely.'); }
    if (token) await refresh(); else { showLogin(); notice(''); }
  }
  start().catch(error => notice(error.message || 'Unable to connect. Refresh and try again.', true));
})();
