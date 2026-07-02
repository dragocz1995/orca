'use client';
import { useEffect, useState } from 'react';
import { ArrowLeft, Save, Plus, Trash2, Puzzle, KeyRound } from 'lucide-react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Field } from '../../components/ui/Field';
import { Toggle } from '../../components/ui/Toggle';
import { Checkbox } from '../../components/ui/Checkbox';
import { FormFooter } from '../../components/ui/FormFooter';
import { LoadingState } from '../../components/ui/states';
import { useToast } from '../../components/ui/Toast';
import { useTranslation } from '../../lib/i18n';
import { usePluginDetail, useProjects } from '../../lib/queries';
import { useSavePluginConfig, useTogglePlugin } from '../../lib/mutations';
import type { PluginConfigField, RolePolicy } from '../../lib/types';

const textareaClass = 'w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm text-text placeholder:text-text-muted focus:border-accent';

/** Structured editor for a `rolePolicies` field: each row maps a platform role (e.g. a Discord role id)
 *  to a name, the Orca projects it may touch, and an extra prompt injected for that role — the Hermes
 *  role-instructions pattern, kept in the plugin's own config. */
function RolePoliciesEditor({ value, onChange }: { value: RolePolicy[]; onChange: (v: RolePolicy[]) => void }) {
  const { t } = useTranslation();
  const { data: projects } = useProjects();
  const patch = (i: number, p: Partial<RolePolicy>) => onChange(value.map((r, j) => (j === i ? { ...r, ...p } : r)));
  return (
    <div className="flex flex-col gap-3">
      {value.length === 0 ? <p className="text-xs italic text-text-muted">{t.pluginCfg.noRoles}</p> : null}
      {value.map((r, i) => (
        <div key={i} className="flex flex-col gap-3 rounded-lg border border-border bg-elevated/40 p-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <Field label={t.pluginCfg.roleId}>
              <Input value={r.roleId} onChange={(e) => patch(i, { roleId: e.target.value })} placeholder="1511041803225272420" className="font-mono" />
            </Field>
            <Field label={t.pluginCfg.roleName}>
              <Input value={r.name} onChange={(e) => patch(i, { name: e.target.value })} placeholder="dev-team" />
            </Field>
            <div className="flex items-end">
              <Button variant="ghost" icon={Trash2} aria-label={t.pluginCfg.removeRole} onClick={() => onChange(value.filter((_, j) => j !== i))} />
            </div>
          </div>
          <Field label={t.pluginCfg.roleProjects} hint={t.pluginCfg.roleProjectsHint}>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {(projects ?? []).map((p) => {
                const on = r.projectIds.includes(p.id);
                return (
                  <label key={p.id} className="flex cursor-pointer items-center gap-2 text-sm text-text">
                    <span onClick={() => patch(i, { projectIds: on ? r.projectIds.filter((id) => id !== p.id) : [...r.projectIds, p.id] })}>
                      <Checkbox checked={on} />
                    </span>
                    {p.slug}
                  </label>
                );
              })}
            </div>
          </Field>
          <Field label={t.pluginCfg.rolePrompt} hint={t.pluginCfg.rolePromptHint}>
            <textarea value={r.prompt} onChange={(e) => patch(i, { prompt: e.target.value })} rows={3} className={textareaClass} />
          </Field>
        </div>
      ))}
      <Button variant="ghost" icon={Plus} className="self-start" onClick={() => onChange([...value, { roleId: '', name: '', projectIds: [], prompt: '' }])}>
        {t.pluginCfg.addRole}
      </Button>
    </div>
  );
}

/** One plugin's own settings section: header (enable toggle) + a form generated from the manifest's
 *  configSchema. Secrets are write-only (placeholder shows they are set); saving hot-reloads the brain. */
export function PluginDetail({ name, onBack }: { name: string; onBack: () => void }) {
  const { data, isLoading } = usePluginDetail(name);
  const save = useSavePluginConfig();
  const toggle = useTogglePlugin();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [values, setValues] = useState<Record<string, unknown>>({});

  useEffect(() => { if (data) setValues(data.config); }, [data]);

  if (isLoading || !data) return <LoadingState />;

  const set = (key: string, v: unknown) => setValues((cur) => ({ ...cur, [key]: v }));
  const onSave = () => save.mutate(
    { name, values },
    { onSuccess: () => toast(t.pluginCfg.saved), onError: () => toast(t.pluginCfg.saveError, 'error') },
  );

  const renderField = (f: PluginConfigField) => {
    switch (f.type) {
      case 'boolean':
        return <Toggle checked={values[f.key] === true} onChange={(v) => set(f.key, v)} label={f.label} />;
      case 'number':
        return <Input type="number" value={String(values[f.key] ?? '')} onChange={(e) => set(f.key, e.target.value === '' ? undefined : Number(e.target.value))} />;
      case 'textarea':
        return <textarea value={String(values[f.key] ?? '')} onChange={(e) => set(f.key, e.target.value)} rows={4} className={textareaClass} />;
      case 'secret':
        return (
          <Input
            type="password"
            value={String(values[f.key] ?? '')}
            onChange={(e) => set(f.key, e.target.value)}
            placeholder={data.secretsSet.includes(f.key) ? t.pluginCfg.secretSet : ''}
            autoComplete="off"
          />
        );
      case 'rolePolicies':
        return <RolePoliciesEditor value={Array.isArray(values[f.key]) ? (values[f.key] as RolePolicy[]) : []} onChange={(v) => set(f.key, v)} />;
      default:
        return <Input value={String(values[f.key] ?? '')} onChange={(e) => set(f.key, e.target.value)} />;
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" icon={ArrowLeft} onClick={onBack}>{t.pluginCfg.back}</Button>
        <span className="flex items-center gap-2 text-sm font-semibold text-text">
          <Puzzle size={16} className="text-accent" aria-hidden />{data.name}
          <span className="font-mono text-tiny text-text-muted">v{data.version}</span>
          {data.secretsSet.length > 0 ? <Badge tone="accent"><KeyRound size={10} className="mr-1" aria-hidden />{t.brain.keySet}</Badge> : null}
        </span>
        <span className="ml-auto flex items-center gap-2 text-sm text-text-muted">
          {data.enabled ? t.plugins.disable : t.plugins.enable}
          <Toggle checked={data.enabled} onChange={(v) => toggle.mutate({ name, enabled: v })} label={data.name} disabled={toggle.isPending} />
        </span>
      </div>
      <p className="text-xs text-text-muted">{data.description}</p>

      <div className="flex max-w-3xl flex-col gap-4">
        {data.configSchema.map((f) => (
          <Field key={f.key} label={f.label} hint={f.hint}>
            {renderField(f)}
          </Field>
        ))}
      </div>

      <FormFooter>
        <Button variant="accent" icon={Save} onClick={onSave} disabled={save.isPending}>{t.pluginCfg.save}</Button>
      </FormFooter>
    </div>
  );
}
