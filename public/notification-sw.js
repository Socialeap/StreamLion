/* Imported by the existing Workbox worker. No job data or authenticated pages are cached here. */
self.addEventListener('message', event => {
  if (event.data?.type === 'streamlion-notification-capability') event.ports?.[0]?.postMessage({ notifications: 1 });
});
self.addEventListener('push', event => {
  let data;
  try { data = event.data.json(); } catch { data = {}; }
  let url = '/api/client-requests';
  try {
    const candidate = new URL(data.url, self.location.origin);
    if (candidate.origin === self.location.origin && ['/api/client-portal', '/api/client-requests'].includes(candidate.pathname)) url = candidate.href;
  } catch { /* Use the safe portal fallback. */ }
  event.waitUntil(self.registration.showNotification('StreamLion', {
    body: 'A project has an update. Open StreamLion to review it.',
    icon: '/lion-mint-192.png', badge: '/lion-mint-192.png',
    tag: typeof data.tag === 'string' ? data.tag.slice(0, 120) : 'streamlion-update',
    data: { url },
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const url = new URL(event.notification.data?.url || '/api/client-requests', self.location.origin);
    if (url.origin !== self.location.origin || !['/api/client-portal', '/api/client-requests'].includes(url.pathname)) return;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => client.url === url.href);
    if (existing) await existing.focus();
    else await self.clients.openWindow(url.href);
  })());
});
