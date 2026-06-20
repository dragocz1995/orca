'use client';
import { TriangleAlert } from 'lucide-react';
import { useSendInput } from '../../lib/mutations';
import { ModelIcon } from './ModelIcon';
import { useToast } from './Toast';
import { useTranslation } from '../../lib/i18n';

/** One waiting agent row with inline Allow/Reject. Shared by the global NeedsInputBanner and the
 *  sidebar NotificationBell so the approve/reject behaviour lives in exactly one place. */
export function NeedsInputRow({ name, question, exec }: { name: string; question: string; exec: string }) {
  const { t } = useTranslation();
  const send = useSendInput();
  const { toast } = useToast();
  return (
    <div className="flex items-center gap-2.5 rounded-md border border-border bg-bg px-3 py-2">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border bg-elevated">
        {exec ? <ModelIcon name={exec} size={13} /> : <TriangleAlert size={12} className="text-warning" aria-hidden />}
      </span>
      <span className="shrink-0 font-mono text-[11px] text-text">{name}</span>
      <span className="min-w-0 flex-1 truncate text-xs text-text-muted" title={question}>{question}</span>
      <div className="flex shrink-0 items-center gap-1.5">
        <button type="button" onClick={() => send.mutate({ name, keys: ['Enter'] }, { onSuccess: () => toast(t.sessions.approved.replace('{name}', name)), onError: (e) => toast(String(e), 'error') })} className="rounded-md border border-approve/50 bg-approve/10 px-2.5 py-1 text-xs font-medium text-approve transition-colors hover:bg-approve hover:text-white active:scale-95">{t.sessions.allow}</button>
        <button type="button" onClick={() => send.mutate({ name, keys: ['Escape'] }, { onSuccess: () => toast(t.sessions.rejected.replace('{name}', name)), onError: (e) => toast(String(e), 'error') })} className="rounded-md border border-danger/50 bg-danger/10 px-2.5 py-1 text-xs font-medium text-danger transition-colors hover:bg-danger hover:text-white active:scale-95">{t.sessions.reject}</button>
      </div>
    </div>
  );
}
