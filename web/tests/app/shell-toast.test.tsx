import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { render } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { onUnhandledRequest } from '../msw';
vi.mock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => ({ replace: () => {}, push: () => {} }), useSearchParams: () => new URLSearchParams() }));
import { Shell } from '../../components/shell/Shell';
import { useToast } from '../../components/ui/Toast';

class FakeES { onmessage = null; addEventListener() {} close() {} constructor(public url: string) {} }
(globalThis as unknown as { EventSource: typeof FakeES }).EventSource = FakeES;
const server = setupServer(
  http.get('*/api/health', () => HttpResponse.json({ ok: true })),
  // A valid session: LoginGate's me() probe resolves → the gate opens and renders children.
  http.get('*/api/auth/me', () => HttpResponse.json({ user: { id: 1, username: 'admin' } })),
);
beforeAll(() => server.listen({ onUnhandledRequest })); afterAll(() => server.close());

function Probe() { useToast(); return <span>ok</span>; }

describe('Shell provides ToastProvider', () => {
  it('useToast works inside Shell without throwing', () => {
    expect(() => render(<Shell><Probe /></Shell>)).not.toThrow();
  });
});
