'use client';
import { useEffect, useState } from 'react';
import { useHermesStatus } from '../../lib/queries';
import { useHermesInstall } from '../../lib/mutations';
import { getToken } from '../../lib/token';

/** Shared Hermes install-form state, used by both the Settings panel and the Onboarding wizard so the
 *  home/url/token fields, the live plugin-status query and the install mutation live in one place
 *  (they were copy-pasted across both pages — finding W2). The url/token are pre-filled once on the
 *  client from the current origin + the logged-in session token. Each page renders its own layout. */
export function useHermesForm() {
  const [home, setHome] = useState('/var/www/.hermes');
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const status = useHermesStatus(home);
  const install = useHermesInstall();

  // Pre-fill url/token once on the client: the daemon URL (or this origin) and the current session
  // token, so a logged-in admin doesn't retype them. Client-only — window/getToken aren't on the server.
  useEffect(() => {
    setUrl(process.env.NEXT_PUBLIC_ORCA_URL ?? window.location.origin);
    const tk = getToken();
    if (tk) setToken(tk);
  }, []);

  return { home, setHome, url, setUrl, token, setToken, status, install };
}
