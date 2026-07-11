'use client';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import { useGithubStatus } from '../../lib/queries';
import { useTranslation } from '../../lib/i18n';

/** Live banner at the top of the GitHub settings section: tells the operator whether a PR-native push
 *  would actually succeed (and as whom), so the token field's necessity is obvious at a glance. Reads
 *  the same `/integrations/github-status` probe the install wizard uses — one source of truth. */
export function GithubStatusBanner() {
  const { t } = useTranslation();
  const { data, isLoading } = useGithubStatus();
  if (isLoading || !data) return null;

  const ready = data.ready;
  const Icon = ready ? CheckCircle2 : AlertTriangle;
  const tone = ready
    ? 'text-success'
    : 'text-warning';

  const message = !ready
    ? t.settings.ghStatusNone
    : data.method === 'token'
      ? t.settings.ghStatusToken
      : data.account
        ? t.settings.ghStatusGh.replace('{account}', data.account)
        : t.settings.ghStatusGhNoAccount;

  return (
    <div className={`settings-status-banner ${tone}`}>
      <Icon size={16} className="mt-0.5 shrink-0" aria-hidden />
      <div className="flex flex-col gap-0.5 text-sm">
        <span className="font-medium">{message}</span>
        {!ready && <span className="text-text-muted">{t.settings.ghStatusNoneHint}</span>}
      </div>
    </div>
  );
}
