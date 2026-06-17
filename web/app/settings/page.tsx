'use client';
import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { useConfig } from '../../lib/queries';
import { useUpdateConfig } from '../../lib/mutations';
import { EXEC_PRESETS } from '../../lib/execPresets';
import { useToast } from '../../components/ui/Toast';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Toggle } from '../../components/ui/Toggle';
import { Segmented } from '../../components/ui/Segmented';
import { SettingCard } from '../../components/ui/SettingCard';
import { LoadingState, ErrorState } from '../../components/ui/states';
import { ModuleShell } from '../../components/shell/ModuleShell';
import '../../modules/settings/theme.css';

export default function SettingsPage() {
  const config = useConfig();
  const update = useUpdateConfig();
  const { toast } = useToast();

  const [allowed, setAllowed] = useState<string[]>([]);
  const [model, setModel] = useState('');
  const [apiUrl, setApiUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [notes, setNotes] = useState('');

  const [defExec, setDefExec] = useState('');
  const [defAutonomy, setDefAutonomy] = useState('');
  const [defMaxSessions, setDefMaxSessions] = useState(1);

  useEffect(() => {
    if (config.data) {
      setAllowed(config.data.allowedExecs);
      setModel(config.data.autopilot.model);
      setApiUrl(config.data.autopilot.apiUrl);
      setNotes(config.data.autopilot.notes);
      setDefExec(config.data.defaults.exec);
      setDefAutonomy(config.data.defaults.autonomy);
      setDefMaxSessions(config.data.defaults.maxSessions);
    }
  }, [config.data]);

  if (config.isLoading) return <ModuleShell moduleId="settings"><PageHeader title="Settings" /><LoadingState /></ModuleShell>;
  if (config.isError) return <ModuleShell moduleId="settings"><PageHeader title="Settings" /><ErrorState message="orca daemon unreachable" onRetry={() => config.refetch()} /></ModuleShell>;

  const toggle = (exec: string) => setAllowed((prev) => prev.includes(exec) ? prev.filter((e) => e !== exec) : [...prev, exec]);
  const apiKeySet = config.data?.autopilot.apiKeySet;

  return (
    <ModuleShell moduleId="settings">
      {/* Models */}
      <PageHeader title="Models" />
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 p-3">
        {EXEC_PRESETS.map((p) => (
          <SettingCard key={p.exec} title={p.label} description={p.exec}>
            <Toggle
              checked={allowed.includes(p.exec)}
              onChange={() => toggle(p.exec)}
              label={p.label}
            />
          </SettingCard>
        ))}
      </div>
      <div className="px-3 pb-4">
        <Button
          variant="accent"
          icon={Save}
          onClick={() => update.mutate(
            { allowedExecs: allowed },
            { onSuccess: () => toast('Models saved'), onError: (e) => toast(String(e), 'error') },
          )}
        >
          Save models
        </Button>
      </div>

      {/* Autopilot */}
      <PageHeader title="Autopilot" />
      <div className="flex flex-col gap-3 p-3 max-w-md">
        <SettingCard title="Decision model">
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="w-full bg-surface border border-border rounded-none px-2 py-1 text-sm text-text"
          />
        </SettingCard>
        <SettingCard title="OpenAI API URL">
          <input
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
            className="w-full bg-surface border border-border rounded-none px-2 py-1 text-sm text-text"
          />
        </SettingCard>
        <SettingCard title={`API key${apiKeySet ? ' •••• set' : ''}`}>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={apiKeySet ? 'leave blank to keep' : 'paste key'}
            className="w-full bg-surface border border-border rounded-none px-2 py-1 text-sm text-text"
          />
        </SettingCard>
        <SettingCard title="Notes">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full bg-surface border border-border rounded-none px-2 py-1 text-sm text-text resize-none"
          />
        </SettingCard>
        <Button
          variant="accent"
          icon={Save}
          onClick={() => update.mutate(
            { autopilot: { model, apiUrl, notes, ...(apiKey ? { apiKey } : {}) } },
            { onSuccess: () => { toast('Autopilot saved'); setApiKey(''); }, onError: (e) => toast(String(e), 'error') },
          )}
        >
          Save autopilot
        </Button>
      </div>

      {/* Defaults */}
      <PageHeader title="Defaults" />
      <div className="flex flex-col gap-3 p-3 max-w-md">
        <SettingCard title="Executor">
          <Segmented
            options={EXEC_PRESETS.map((p) => ({ value: p.exec, label: p.exec }))}
            value={defExec}
            onChange={setDefExec}
          />
        </SettingCard>
        <SettingCard title="Autonomy">
          <Segmented
            options={['L0', 'L1', 'L2', 'L3'].map((l) => ({ value: l, label: l }))}
            value={defAutonomy}
            onChange={setDefAutonomy}
          />
        </SettingCard>
        <SettingCard title="Max sessions">
          <input
            type="number"
            min={1}
            value={defMaxSessions}
            onChange={(e) => setDefMaxSessions(Number(e.target.value))}
            className="w-full bg-surface border border-border rounded-none px-2 py-1 text-sm text-text"
          />
        </SettingCard>
        <Button
          variant="accent"
          icon={Save}
          onClick={() => update.mutate(
            { defaults: { exec: defExec, autonomy: defAutonomy, maxSessions: defMaxSessions } },
            { onSuccess: () => toast('Defaults saved'), onError: (e) => toast(String(e), 'error') },
          )}
        >
          Save
        </Button>
      </div>
    </ModuleShell>
  );
}
