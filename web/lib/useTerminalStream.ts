'use client';
import { useEffect, useRef, useState } from 'react';
import { orcaClient, terminalWsUrl } from './orcaClient';

type StreamStatus = 'connecting' | 'open' | 'unsupported' | 'closed';

/** Close code the daemon uses to say "no PTY stream — fall back to snapshot" (bad ticket or node-pty
 *  missing). Must match `UNSUPPORTED_CLOSE` in `src/terminal/wsHandler.ts`. */
const UNSUPPORTED_CLOSE = 4001;

export interface TerminalStream {
  status: StreamStatus;
  send: (data: string) => void;
  resize: (cols: number, rows: number) => void;
}

/** Open a terminal PTY stream over a WebSocket: mint a single-use ticket via the BFF, connect straight
 *  to the daemon's `/ws/terminal`, and push raw bytes to `onData`. On an unsupported close (4001) or any
 *  connection/ticket error the status flips to `unsupported`, so the caller can render the snapshot
 *  fallback. `onData` is held in a ref so changing it never reconnects the socket. */
export function useTerminalStream(name: string, enabled: boolean, onData: (bytes: string) => void): TerminalStream {
  const [status, setStatus] = useState<StreamStatus>('connecting');
  const wsRef = useRef<WebSocket | null>(null);
  const onDataRef = useRef(onData);
  onDataRef.current = onData;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let ws: WebSocket | null = null;
    setStatus('connecting');
    orcaClient.wsTicket(name)
      .then(({ ticket }) => {
        if (cancelled) return;
        ws = new WebSocket(terminalWsUrl(ticket));
        wsRef.current = ws;
        ws.onopen = () => { if (!cancelled) setStatus('open'); };
        ws.onmessage = (e: MessageEvent) => { if (typeof e.data === 'string') onDataRef.current(e.data); };
        ws.onerror = () => { if (!cancelled) setStatus('unsupported'); };
        ws.onclose = (e: CloseEvent) => {
          if (cancelled) return;
          setStatus(e.code === UNSUPPORTED_CLOSE ? 'unsupported' : 'closed');
        };
      })
      .catch(() => { if (!cancelled) setStatus('unsupported'); }); // ticket mint failed — no stream

    return () => { cancelled = true; ws?.close(); wsRef.current = null; };
  }, [name, enabled]);

  const send = (data: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(data);
  };
  const resize = (cols: number, rows: number) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'resize', cols, rows }));
  };
  return { status, send, resize };
}
