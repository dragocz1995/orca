'use client';
import { AlertTriangle } from 'lucide-react';
import { Modal, ModalBody, ModalFooter } from './Modal';
import { Button } from './Button';
import { useTranslation } from '../../lib/i18n';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({ open, title, description, confirmLabel, onConfirm, onClose }: ConfirmDialogProps) {
  const { t } = useTranslation();
  if (!open) return null;
  return (
    <Modal title={title} onClose={onClose} size="sm" icon={AlertTriangle}>
      <ModalBody>
        {description ? <p className="text-sm leading-relaxed text-text-muted">{description}</p> : null}
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>{t.common.cancel}</Button>
        <Button variant="danger" onClick={onConfirm}>{confirmLabel ?? t.common.delete}</Button>
      </ModalFooter>
    </Modal>
  );
}
