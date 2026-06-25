import { BASE } from './orcaClient';

// Client-side web-push helpers. The service worker (web/public/sw.js) mirrors `actionToRequest` in
// plain JS — keep the two in sync (the mapping is unit-tested here).

/** A single same-origin request the service worker performs for an inline notification action. */
interface PushActionStep { method: 'POST' | 'PATCH'; path: string; body?: unknown }
/** Either open the app at a url, or run a sequence of requests (each must succeed before the next). */
export type PushActionPlan = { kind: 'open'; url: string } | { kind: 'fetch'; steps: PushActionStep[] };

interface PushActionData { taskId?: string; missionId?: string; session?: string; url?: string }

/** Map a notification action id + payload data to what the service worker should do. Unknown actions
 *  (and the explicit `open`) just open the app. */
export function actionToRequest(action: string, data: PushActionData): PushActionPlan {
  switch (action) {
    case 'approve':
      return { kind: 'fetch', steps: [{ method: 'POST', path: `${BASE}/tasks/${data.taskId}/approve-gate` }] };
    case 'rerun':
      return { kind: 'fetch', steps: [
        { method: 'PATCH', path: `${BASE}/tasks/${data.taskId}`, body: { status: 'open' } },
        { method: 'PATCH', path: `${BASE}/missions/${data.missionId}`, body: { action: 'resume' } },
      ] };
    case 'allow':
      return { kind: 'fetch', steps: [{ method: 'POST', path: `${BASE}/sessions/${encodeURIComponent(data.session ?? '')}/keys`, body: { keys: ['Enter'] } }] };
    case 'reject':
      return { kind: 'fetch', steps: [{ method: 'POST', path: `${BASE}/sessions/${encodeURIComponent(data.session ?? '')}/keys`, body: { keys: ['Escape'] } }] };
    default:
      return { kind: 'open', url: data.url ?? '/' };
  }
}

export function isPushSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator
    && typeof window !== 'undefined' && 'PushManager' in window && 'Notification' in window;
}

/** Convert a URL-safe base64 VAPID public key to the Uint8Array PushManager.subscribe expects. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export type EnablePushResult = 'granted' | 'denied' | 'unsupported';

/** Register the service worker, request notification permission, subscribe via PushManager and POST
 *  the subscription to the daemon. Must be called from a user gesture (permission prompt). */
export async function enablePush(): Promise<EnablePushResult> {
  if (!isPushSupported()) return 'unsupported';
  const reg = await navigator.serviceWorker.register('/sw.js');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';
  const { publicKey } = await (await fetch(`${BASE}/push/vapid-public-key`, { credentials: 'same-origin' })).json() as { publicKey: string };
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
  });
  await fetch(`${BASE}/push/subscribe`, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sub.toJSON()),
  });
  return 'granted';
}

/** Unsubscribe the current device and tell the daemon to forget it. */
export async function disablePush(): Promise<void> {
  if (!isPushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration('/sw.js');
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await sub.unsubscribe();
  await fetch(`${BASE}/push/unsubscribe`, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  });
}
