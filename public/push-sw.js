/* global self */

function pushPayload(event) {
  if (!event.data) return {};
  try {
    return event.data.json();
  } catch {
    return { body: event.data.text() };
  }
}

function appDestination(candidate) {
  const fallback = new URL('?view=inbox', self.registration.scope).href;
  if (typeof candidate !== 'string') return fallback;
  try {
    const destination = new URL(candidate, self.registration.scope);
    const scope = new URL(self.registration.scope);
    return destination.origin === scope.origin && destination.pathname.startsWith(scope.pathname)
      ? destination.href
      : fallback;
  } catch {
    return fallback;
  }
}

self.addEventListener('push', (event) => {
  const payload = pushPayload(event);
  const title = typeof payload.title === 'string' && payload.title.trim()
    ? payload.title.trim()
    : 'Signal Desk';
  const body = typeof payload.body === 'string' ? payload.body : '新しい監視通知があります。';
  const tag = typeof payload.tag === 'string' ? payload.tag : undefined;
  const severity = ['info', 'warning', 'critical'].includes(payload.severity)
    ? payload.severity
    : 'info';

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: new URL('app-icon.svg', self.registration.scope).href,
      badge: new URL('app-icon.svg', self.registration.scope).href,
      tag,
      renotify: Boolean(tag),
      data: {
        url: appDestination(payload.url ?? (payload.notificationId
          ? `?view=inbox&notification=${encodeURIComponent(payload.notificationId)}`
          : '?view=inbox')),
        notificationId: typeof payload.notificationId === 'string' ? payload.notificationId : undefined,
        severity
      }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const destination = appDestination(event.notification.data?.url);
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const sameOriginClient = clients.find((client) => new URL(client.url).origin === self.location.origin);
    if (sameOriginClient) {
      await sameOriginClient.focus();
      if ('navigate' in sameOriginClient) await sameOriginClient.navigate(destination);
      return;
    }
    await self.clients.openWindow(destination);
  })());
});
