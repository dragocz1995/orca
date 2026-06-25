'use client';
import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal, ModalBody, ModalFooter } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../components/ui/Toast';
import { useResetUsage } from '../../lib/mutations';
import { OrcaApiError } from '../../lib/orcaClient';
import { useTranslation } from '../../lib/i18n';

/** Destructive confirmation for resetting all usage. Requires the operator to type the sentinel
 *  word so it can't be triggered by a stray click, and surfaces the daemon's "agents running"
 *  refusal (409) as a friendly message rather than a raw error code. */
export function ResetUsageModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const reset = useResetUsage();
  const [typed, setTyped] = useState('');

  const armed = typed.trim().toUpperCase() === t.stats.resetConfirmWord;

  const onConfirm = () => {
    reset.mutate(undefined, {
      onSuccess: () => { toast(t.stats.resetDone); onClose(); },
      onError: (e) => {
        const blocked = e instanceof OrcaApiError && e.code === 'agents_running';
        toast(blocked ? t.stats.resetBlocked : t.stats.resetFailed, 'error');
      },
    });
  };

  return (
    <Modal title={t.stats.resetTitle} onClose={onClose} size="sm" icon={AlertTriangle}>
      <ModalBody>
        <p className="text-sm leading-relaxed text-text-muted">{t.stats.resetBody}</p>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-text-muted">{t.stats.resetConfirmHint.replace('{word}', t.stats.resetConfirmWord)}</label>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoFocus
            spellCheck={false}
            className="h-9 rounded-md border border-border bg-bg px-3 font-mono text-sm text-text outline-none transition-colors focus:border-border-strong"
          />
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>{t.common.cancel}</Button>
        <Button variant="danger" onClick={onConfirm} disabled={!armed || reset.isPending}>{t.stats.resetConfirm}</Button>
      </ModalFooter>
    </Modal>
  );
}
