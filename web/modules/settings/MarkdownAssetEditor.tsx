'use client';
import { type ReactNode, useState } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Field } from '../../components/ui/Field';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { LoadingState, ErrorState } from '../../components/ui/states';
import { useToast } from '../../components/ui/Toast';
import { useTranslation } from '../../lib/i18n';
import { apiErrorMessage } from '../../lib/elowenClient';

const textareaClass = 'w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm text-text placeholder:text-text-muted focus:border-accent';

/** Mirrors NAME_RE in the daemon's validation for both skills and sub-agents. */
const NAME_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;

/** The shape every markdown asset (skill / sub-agent) shares. `source === 'user'` marks the
 *  editable, user-owned entries; anything else ships read-only. */
export interface MarkdownAsset {
  name: string;
  description: string;
  source: string;
}

/** The editor's form: the fields both editors share plus the caller's divergent extra fields `E`
 *  (`body` is the primary markdown textarea — the skill's content or the sub-agent's prompt). */
export type AssetForm<E> = { editing: string | null; name: string; description: string; body: string } & E;

/** Success/error handlers the caller wires straight into its mutation's `mutate(..., callbacks)`. */
interface SaveCallbacks { onSuccess: () => void; onError: (error: unknown) => void }

export interface MarkdownAssetEditorProps<T extends MarkdownAsset, E> {
  query: UseQueryResult<T[]>;
  labels: {
    empty: string;
    badgeUser: string;
    badgeBuiltin: string;
    add: string;
    edit: string;
    remove: string;
    save: string;
    cancel: string;
    name: string;
    nameHint: string;
    namePlaceholder: string;
    description: string;
    descriptionHint: string;
    body: string;
    bodyHint: string;
    bodyPlaceholder?: string;
    created: string;
    updated: string;
    deleted: string;
    deleteTitle: string;
    deleteDesc: string;
  };
  /** The blank form used when adding a new entry. */
  emptyForm: AssetForm<E>;
  /** Map an existing entry to the form when the pencil is clicked. */
  formFromItem: (item: T) => AssetForm<E>;
  /** Extra validation on top of name/description/body being non-empty (defaults to always valid). */
  extraValid?: (form: AssetForm<E>) => boolean;
  /** Read-only badges rendered after the source badge (e.g. tools mode, manual-only). */
  renderBadges?: (item: T) => ReactNode;
  /** Extra per-row control for user entries, placed before the edit/delete buttons (e.g. a toggle). */
  renderRowControl?: (item: T) => ReactNode;
  /** Extra form fields rendered between the name/description grid and the body textarea. */
  renderFieldsBeforeBody?: (form: AssetForm<E>, patch: (p: Partial<AssetForm<E>>) => void) => ReactNode;
  /** Extra form fields rendered after the body textarea. */
  renderFieldsAfterBody?: (form: AssetForm<E>, patch: (p: Partial<AssetForm<E>>) => void) => ReactNode;
  /** Persist the form (create or update); wire the callbacks into the caller's mutation. */
  onSave: (form: AssetForm<E>, callbacks: SaveCallbacks) => void;
  /** True while a create/update is in flight (disables the save button). */
  saving: boolean;
  /** Delete a user entry by name; wire the callbacks into the caller's mutation. */
  onDelete: (name: string, callbacks: SaveCallbacks) => void;
}

/** Shared editor for the markdown-asset plugin details (skills + sub-agents): an empty-state line, a
 *  list of entries (name + source badge + caller badges, user rows carrying edit/delete plus any extra
 *  control), an inline create/edit form, and a delete confirmation. The divergent bits — extra form
 *  fields, per-row controls, badges and the save strategy — are injected by the caller. */
export function MarkdownAssetEditor<T extends MarkdownAsset, E>({
  query, labels, emptyForm, formFromItem, extraValid, renderBadges, renderRowControl,
  renderFieldsBeforeBody, renderFieldsAfterBody, onSave, saving, onDelete,
}: MarkdownAssetEditorProps<T, E>) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [form, setForm] = useState<AssetForm<E> | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const { data, isLoading, isError } = query;
  if (isError) return <ErrorState message={t.common.daemonUnreachable} onRetry={() => query.refetch()} />;
  if (isLoading || !data) return <LoadingState />;

  const patch = (p: Partial<AssetForm<E>>) => setForm((cur) => (cur ? { ...cur, ...p } : cur));
  const nameValid = form !== null && NAME_RE.test(form.name.trim());
  const savable = form !== null && (form.editing !== null || nameValid)
    && form.description.trim() !== '' && form.body.trim() !== '' && (extraValid?.(form) ?? true);

  const submit = () => {
    if (!form || !savable) return;
    onSave(form, {
      onSuccess: () => { setForm(null); toast(form.editing !== null ? labels.updated : labels.created); },
      onError: (e) => toast(apiErrorMessage(e), 'error'),
    });
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    onDelete(pendingDelete, {
      onSuccess: () => toast(labels.deleted),
      onError: (e) => toast(apiErrorMessage(e), 'error'),
    });
    setPendingDelete(null);
  };

  return (
    <div className="flex flex-col gap-3">
      {data.length === 0 ? <p className="text-xs italic text-text-muted">{labels.empty}</p> : null}
      {data.map((item) => (
        <div key={`${item.source}:${item.name}`} className="flex items-center gap-2 rounded-lg border border-border bg-elevated/40 p-3">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex flex-wrap items-center gap-2">
              <span className="truncate font-mono text-sm font-medium text-text">{item.name}</span>
              <Badge tone={item.source === 'user' ? 'accent' : 'default'}>
                {item.source === 'user' ? labels.badgeUser : labels.badgeBuiltin}
              </Badge>
              {renderBadges?.(item)}
            </span>
            {item.description ? <p className="text-xs text-text-muted">{item.description}</p> : null}
          </div>
          {item.source === 'user' ? (
            <div className="flex items-center gap-2">
              {renderRowControl?.(item)}
              <Button variant="ghost" icon={Pencil} aria-label={labels.edit} onClick={() => setForm(formFromItem(item))} />
              <Button variant="ghost" icon={Trash2} aria-label={labels.remove} onClick={() => setPendingDelete(item.name)} />
            </div>
          ) : null}
        </div>
      ))}

      {form ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-elevated/40 p-3">
          <div className="@container">
            <div className="grid grid-cols-1 gap-3 @sm:grid-cols-2">
              <Field label={labels.name} hint={labels.nameHint}>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((cur) => (cur ? { ...cur, name: e.target.value } : cur))}
                  disabled={form.editing !== null}
                  className={`font-mono ${form.editing === null && form.name !== '' && !nameValid ? 'border-danger' : ''}`}
                  placeholder={labels.namePlaceholder}
                />
              </Field>
              <Field label={labels.description} hint={labels.descriptionHint}>
                <Input value={form.description} onChange={(e) => setForm((cur) => (cur ? { ...cur, description: e.target.value } : cur))} />
              </Field>
            </div>
          </div>
          {renderFieldsBeforeBody?.(form, patch)}
          <Field label={labels.body} hint={labels.bodyHint}>
            <textarea value={form.body} onChange={(e) => setForm((cur) => (cur ? { ...cur, body: e.target.value } : cur))} rows={8} className={textareaClass} placeholder={labels.bodyPlaceholder} />
          </Field>
          {renderFieldsAfterBody?.(form, patch)}
          <div className="flex items-center gap-2">
            <Button onClick={submit} disabled={!savable || saving}>{labels.save}</Button>
            <Button variant="ghost" onClick={() => setForm(null)}>{labels.cancel}</Button>
          </div>
        </div>
      ) : (
        <Button variant="ghost" icon={Plus} className="self-start" onClick={() => setForm(emptyForm)}>
          {labels.add}
        </Button>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={labels.deleteTitle}
        description={pendingDelete ? labels.deleteDesc.replace('{name}', pendingDelete) : undefined}
        confirmLabel={labels.remove}
        onConfirm={confirmDelete}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}
