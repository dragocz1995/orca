'use client';
import { Badge } from '../../components/ui/Badge';
import { Input } from '../../components/ui/Input';
import { Field } from '../../components/ui/Field';
import { useTranslation } from '../../lib/i18n';
import { usePluginSubagents } from '../../lib/queries';
import { useSavePluginSubagent, useDeletePluginSubagent } from '../../lib/mutations';
import type { PluginSubagent } from '../../lib/types';
import { MarkdownAssetEditor, type AssetForm } from './MarkdownAssetEditor';

const selectClass = 'w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text focus:border-accent';

type ToolsMode = 'read-only' | 'all' | 'inherit' | 'custom';
/** `customTools` is a comma-separated tool list, used only when `toolsMode === 'custom'`. */
type SubagentExtra = { toolsMode: ToolsMode; customTools: string };
type SubagentForm = AssetForm<SubagentExtra>;
const EMPTY_FORM: SubagentForm = { editing: null, name: '', description: '', body: '', toolsMode: 'read-only', customTools: '' };

/** Sub-agents manager (the subagent plugin detail): built-in explore/plan ship read-only; user agents are
 *  one `.md` file each (frontmatter name/description/tools + a body prompt) and can be created, edited and
 *  deleted here. A read-only agent gets look-only tools plus read-only shell. Changes hot-reload the
 *  plugins, so new conversations pick them up immediately. */
export function SubagentsEditor() {
  const { t } = useTranslation();
  const query = usePluginSubagents();
  const save = useSavePluginSubagent();
  const remove = useDeletePluginSubagent();

  const toolsLabel = (tools: PluginSubagent['tools']): string =>
    Array.isArray(tools) ? tools.join(', ') : { 'read-only': t.subagents.toolsReadOnly, all: t.subagents.toolsAll, inherit: t.subagents.toolsInherit }[tools];

  return (
    <MarkdownAssetEditor<PluginSubagent, SubagentExtra>
      query={query}
      labels={{
        empty: t.subagents.empty,
        badgeUser: t.subagents.badgeUser,
        badgeBuiltin: t.subagents.badgeBuiltin,
        add: t.subagents.add,
        edit: t.subagents.edit,
        remove: t.subagents.remove,
        save: t.subagents.save,
        cancel: t.subagents.cancel,
        name: t.subagents.name,
        nameHint: t.help.subagentName,
        namePlaceholder: 'reviewer',
        description: t.subagents.description,
        descriptionHint: t.help.subagentDescription,
        body: t.subagents.body,
        bodyHint: t.help.subagentBody,
        bodyPlaceholder: t.subagents.bodyPlaceholder,
        created: t.subagents.created,
        updated: t.subagents.updated,
        deleted: t.subagents.deleted,
        deleteTitle: t.subagents.deleteTitle,
        deleteDesc: t.subagents.deleteDesc,
      }}
      emptyForm={EMPTY_FORM}
      formFromItem={(agent) => ({
        editing: agent.name,
        name: agent.name,
        description: agent.description,
        body: agent.body ?? '',
        toolsMode: Array.isArray(agent.tools) ? 'custom' : agent.tools,
        customTools: Array.isArray(agent.tools) ? agent.tools.join(', ') : '',
      })}
      extraValid={(form) => form.toolsMode !== 'custom' || form.customTools.trim() !== ''}
      renderBadges={(agent) => <Badge tone="default">{toolsLabel(agent.tools)}</Badge>}
      renderFieldsBeforeBody={(form, patch) => (
        <>
          <Field label={t.subagents.tools} hint={t.subagents.toolsHint}>
            <select className={selectClass} value={form.toolsMode} onChange={(e) => patch({ toolsMode: e.target.value as ToolsMode })}>
              <option value="read-only">{t.subagents.toolsReadOnly}</option>
              <option value="all">{t.subagents.toolsAll}</option>
              <option value="inherit">{t.subagents.toolsInherit}</option>
              <option value="custom">{t.subagents.toolsCustom}</option>
            </select>
          </Field>
          {form.toolsMode === 'custom' ? (
            <Field label={t.subagents.customTools} hint={t.subagents.customToolsHint}>
              <Input value={form.customTools} onChange={(e) => patch({ customTools: e.target.value })} className="font-mono" placeholder="Read, Search, Bash" />
            </Field>
          ) : null}
        </>
      )}
      onSave={(form, callbacks) => {
        const tools: PluginSubagent['tools'] = form.toolsMode === 'custom'
          ? form.customTools.split(',').map((s) => s.trim()).filter(Boolean)
          : form.toolsMode;
        save.mutate(
          { name: form.editing ?? form.name.trim(), def: { description: form.description.trim(), tools, body: form.body } },
          callbacks,
        );
      }}
      saving={save.isPending}
      onDelete={(name, callbacks) => remove.mutate(name, callbacks)}
    />
  );
}
