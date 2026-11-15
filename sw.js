self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('push', (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch { /* sin datos */ }
  e.waitUntil(self.registration.showNotification(d.titulo || 'Yosca Moda', { body: d.cuerpo || '', icon: '/pi.png', badge: '/pi.png', tag: 'pedido-ia', renotify: true, data: { url: d.url || '/' } }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((l) => { for (const c of l) if ('focus' in c) { c.navigate && c.navigate(url); return c.focus(); } return self.clients.openWindow(url); }));
});
