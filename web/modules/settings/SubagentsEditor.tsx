'use client';
import { useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Field } from '../../components/ui/Field';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { LoadingState } from '../../components/ui/states';
import { useToast } from '../../components/ui/Toast';
import { useTranslation } from '../../lib/i18n';
import { usePluginSubagents } from '../../lib/queries';
import { useSavePluginSubagent, useDeletePluginSubagent } from '../../lib/mutations';
import { apiErrorMessage } from '../../lib/elowenClient';
import type { PluginSubagent } from '../../lib/types';

const textareaClass = 'w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm text-text placeholder:text-text-muted focus:border-accent';
const selectClass = 'w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text focus:border-accent';

/** Mirrors NAME_RE in src/brain/agents/agentRegistry.ts (and the daemon's PUT validation). */
const NAME_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;

type ToolsMode = 'read-only' | 'all' | 'inherit' | 'custom';
/** `editing` holds the name of the agent being edited (name is then immutable), or null for a new one.
 *  `customTools` is a comma-separated tool list, used only when `toolsMode === 'custom'`. */
type FormState = { editing: string | null; name: string; description: string; toolsMode: ToolsMode; customTools: string; body: string };
const EMPTY_FORM: FormState = { editing: null, name: '', description: '', toolsMode: 'read-only', customTools: '', body: '' };

/** Sub-agents manager (the subagent plugin detail): built-in explore/plan ship read-only; user agents are
 *  one `.md` file each (frontmatter name/description/tools + a body prompt) and can be created, edited and
 *  deleted here. A read-only agent gets look-only tools plus read-only shell. Changes hot-reload the
 *  plugins, so new conversations pick them up immediately. */
export function SubagentsEditor() {
  const { t } = useTranslation();
  const { data, isLoading } = usePluginSubagents();
  const save = useSavePluginSubagent();
  const remove = useDeletePluginSubagent();
  const { toast } = useToast();
  const [form, setForm] = useState<FormState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  if (isLoading || !data) return <LoadingState />;

  const nameValid = form !== null && NAME_RE.test(form.name.trim());
  const customOk = form !== null && (form.toolsMode !== 'custom' || form.customTools.trim() !== '');
  const savable = form !== null && (form.editing !== null || nameValid) && form.description.trim() !== '' && form.body.trim() !== '' && customOk;

  const openEdit = (agent: PluginSubagent) => {
    setForm({
      editing: agent.name,
      name: agent.name,
      description: agent.description,
      toolsMode: Array.isArray(agent.tools) ? 'custom' : agent.tools,
      customTools: Array.isArray(agent.tools) ? agent.tools.join(', ') : '',
      body: agent.body ?? '',
    });
  };

  const submit = () => {
    if (!form || !savable) return;
    const tools: PluginSubagent['tools'] = form.toolsMode === 'custom'
      ? form.customTools.split(',').map((s) => s.trim()).filter(Boolean)
      : form.toolsMode;
    save.mutate(
      { name: form.editing ?? form.name.trim(), def: { description: form.description.trim(), tools, body: form.body } },
      {
        onSuccess: () => { setForm(null); toast(form.editing !== null ? t.subagents.updated : t.subagents.created); },
        onError: (e) => toast(apiErrorMessage(e), 'error'),
      },
    );
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    remove.mutate(pendingDelete, {
      onSuccess: () => toast(t.subagents.deleted),
      onError: (e) => toast(apiErrorMessage(e), 'error'),
    });
    setPendingDelete(null);
  };

  const toolsLabel = (tools: PluginSubagent['tools']): string =>
    Array.isArray(tools) ? tools.join(', ') : { 'read-only': t.subagents.toolsReadOnly, all: t.subagents.toolsAll, inherit: t.subagents.toolsInherit }[tools];

  return (
    <div className="flex flex-col gap-3">
      {data.length === 0 ? <p className="text-xs italic text-text-muted">{t.subagents.empty}</p> : null}
      {data.map((agent) => (
        <div key={`${agent.source}:${agent.name}`} className="flex items-center gap-2 rounded-lg border border-border bg-elevated/40 p-3">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex flex-wrap items-center gap-2">
              <span className="truncate font-mono text-sm font-medium text-text">{agent.name}</span>
              <Badge tone={agent.source === 'user' ? 'accent' : 'default'}>
                {agent.source === 'user' ? t.subagents.badgeUser : t.subagents.badgeBuiltin}
              </Badge>
              <Badge tone="default">{toolsLabel(agent.tools)}</Badge>
            </span>
            {agent.description ? <p className="text-xs text-text-muted">{agent.description}</p> : null}
          </div>
          {agent.source === 'user' ? (
            <div className="flex items-center gap-2">
              <Button variant="ghost" icon={Pencil} aria-label={t.subagents.edit} onClick={() => openEdit(agent)} />
              <Button variant="ghost" icon={Trash2} aria-label={t.subagents.remove} onClick={() => setPendingDelete(agent.name)} />
            </div>
          ) : null}
        </div>
      ))}

      {form ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-elevated/40 p-3">
          <div className="@container">
            <div className="grid grid-cols-1 gap-3 @sm:grid-cols-2">
              <Field label={t.subagents.name} hint={t.help.subagentName}>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  disabled={form.editing !== null}
                  className={`font-mono ${form.editing === null && form.name !== '' && !nameValid ? 'border-danger' : ''}`}
                  placeholder="reviewer"
                />
              </Field>
              <Field label={t.subagents.description} hint={t.help.subagentDescription}>
                <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </Field>
            </div>
          </div>
          <Field label={t.subagents.tools} hint={t.subagents.toolsHint}>
            <select className={selectClass} value={form.toolsMode} onChange={(e) => setForm({ ...form, toolsMode: e.target.value as ToolsMode })}>
              <option value="read-only">{t.subagents.toolsReadOnly}</option>
              <option value="all">{t.subagents.toolsAll}</option>
              <option value="inherit">{t.subagents.toolsInherit}</option>
              <option value="custom">{t.subagents.toolsCustom}</option>
            </select>
          </Field>
          {form.toolsMode === 'custom' ? (
            <Field label={t.subagents.customTools} hint={t.subagents.customToolsHint}>
              <Input value={form.customTools} onChange={(e) => setForm({ ...form, customTools: e.target.value })} className="font-mono" placeholder="Read, Search, Bash" />
            </Field>
          ) : null}
          <Field label={t.subagents.body} hint={t.help.subagentBody}>
            <textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} rows={8} className={textareaClass} placeholder={t.subagents.bodyPlaceholder} />
          </Field>
          <div className="flex items-center gap-2">
            <Button onClick={submit} disabled={!savable || save.isPending}>{t.subagents.save}</Button>
            <Button variant="ghost" onClick={() => setForm(null)}>{t.subagents.cancel}</Button>
          </div>
        </div>
      ) : (
        <Button variant="ghost" icon={Plus} className="self-start" onClick={() => setForm(EMPTY_FORM)}>
          {t.subagents.add}
        </Button>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t.subagents.deleteTitle}
        description={pendingDelete ? t.subagents.deleteDesc.replace('{name}', pendingDelete) : undefined}
        confirmLabel={t.subagents.remove}
        onConfirm={confirmDelete}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}
