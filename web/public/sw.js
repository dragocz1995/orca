// Elowen service worker: renders web-push notifications and runs their inline actions. The daemon
// (src/push/) builds every payload, so there is no i18n here — text is rendered verbatim. The
// action→request mapping mirrors web/lib/pushClient.ts `actionToRequest`; keep the two in sync.
const SW_VERSION = '1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

function parsePayload(data) {
  try {
    return data ? data.json() : null;
  } catch (_e) {
    return null;
  }
}

self.addEventListener('push', (event) => {
  const p = parsePayload(event.data);
  if (!p) {
    event.waitUntil(self.registration.showNotification('Elowen', { body: 'Nová událost.' }));
    return;
  }
  event.waitUntil(self.registration.showNotification(p.title, {
    body: p.body,
    tag: p.missionId || undefined, // collapse repeat notifications about the same mission
    data: p,
    actions: Array.isArray(p.actions) ? p.actions : [],
    badge: '/elowen-logo.png',
    icon: '/elowen-logo.png',
  }));
});

// Same-origin path mirror of pushClient.ts actionToRequest (plain JS — public/ is not bundled).
function actionToRequest(action, data) {
  switch (action) {
    case 'approve':
      return { kind: 'fetch', steps: [{ method: 'POST', path: '/api/tasks/' + data.taskId + '/approve-gate' }] };
    case 'rerun':
      return { kind: 'fetch', steps: [
        { method: 'PATCH', path: '/api/tasks/' + data.taskId, body: { status: 'open' } },
        { method: 'PATCH', path: '/api/missions/' + data.missionId, body: { action: 'resume' } },
      ] };
    case 'allow':
      return { kind: 'fetch', steps: [{ method: 'POST', path: '/api/sessions/' + encodeURIComponent(data.session || '') + '/keys', body: { keys: ['Enter'] } }] };
    case 'reject':
      return { kind: 'fetch', steps: [{ method: 'POST', path: '/api/sessions/' + encodeURIComponent(data.session || '') + '/keys', body: { keys: ['Escape'] } }] };
    default:
      return { kind: 'open', url: data.url || '/' };
  }
}

async function runSteps(steps) {
  for (const step of steps) {
    const res = await fetch(step.path, {
      method: step.method,
      credentials: 'same-origin',
      headers: step.body ? { 'content-type': 'application/json' } : undefined,
      body: step.body ? JSON.stringify(step.body) : undefined,
    });
    if (!res.ok) throw new Error('step failed: ' + res.status);
  }
}

// Only open a same-origin app path or an https URL (e.g. a GitHub PR). Reject anything else
// (javascript:/data: or an off-origin redirect) so a payload url can never become an open-redirect.
function safeOpenUrl(raw) {
  try {
    const u = new URL(raw || '/', self.location.origin);
    if (u.origin === self.location.origin || u.protocol === 'https:') return u.href;
  } catch (_e) { /* fall through */ }
  return self.location.origin + '/';
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const plan = actionToRequest(event.action, data);
  if (plan.kind === 'open') {
    event.waitUntil(self.clients.openWindow(safeOpenUrl(plan.url)));
    return;
  }
  event.waitUntil(
    runSteps(plan.steps).catch(() =>
      self.registration.showNotification('Akce se nezdařila', { body: 'Otevřete aplikaci a zkuste to znovu.', data }),
    ),
  );
});
