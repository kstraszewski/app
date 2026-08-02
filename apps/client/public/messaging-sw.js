self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data?.json() || {}
  }
  catch {
    payload = {}
  }

  const notification = payload.notification || {}
  const data = payload.data || notification.data || {}
  event.waitUntil(self.registration.showNotification(
    notification.title || 'OpenExpert',
    {
      body: notification.body || 'Masz nową wiadomość.',
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      tag: data.conversationId
        ? `openexpert-message-${data.conversationId}`
        : 'openexpert-message',
      data: {
        path: typeof data.path === 'string' ? data.path : '/',
      },
    },
  ))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const requestedPath = event.notification.data?.path
  const path = typeof requestedPath === 'string' && /^\/(?!\/)/.test(requestedPath)
    ? requestedPath
    : '/'
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of windows) {
      if ('navigate' in client) await client.navigate(path)
      if ('focus' in client) return client.focus()
    }
    return self.clients.openWindow(path)
  })())
})
