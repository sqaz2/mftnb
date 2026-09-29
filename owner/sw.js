'use strict';
// No offline cache: customer details and authentication responses must never be cached.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('push', event => {
  event.waitUntil(self.registration.showNotification('New MFTNB lead', {
    body: 'Open your inbox to review your latest estimate requests and messages.',
    icon: '/apple-touch-icon.png', badge: '/favicon-64.png',
    tag: 'mftnb-leads', renotify: true, data: { url: '/owner/' }
  }).then(() => self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
    .then(clients => Promise.all(clients.map(client => client.postMessage({ type: 'leads-updated' })))));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async clients => {
    const client = clients.find(item => new URL(item.url).origin === self.location.origin && new URL(item.url).pathname.startsWith('/owner/'));
    if (client) { client.postMessage({ type: 'leads-updated' }); return client.focus(); }
    return self.clients.openWindow('/owner/');
  }));
});
