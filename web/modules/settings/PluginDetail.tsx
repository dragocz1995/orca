'use client';
import { ArrowLeft } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { PageLayout } from '../../components/ui/PageLayout';
import { LoadingState } from '../../components/ui/states';
import { useTranslation } from '../../lib/i18n';
import { usePluginDetail, usePluginContributions, usePluginLogs, usePluginHookExecutions } from '../../lib/queries';
import type { PluginConfigField } from '../../lib/types';
import { PluginConfigEditor } from './PluginConfigEditor';
import { PluginHero, PluginStatusRail } from './PluginSummary';
import { PluginToolsPanel } from './PluginToolsPanel';
import { PluginHooksPanel } from './PluginHooksPanel';
import { PluginPermissionsPanel } from './PluginPermissionsPanel';
import { PluginDataPanel } from './PluginDataPanel';
import { PluginLogsPanel } from './PluginLogsPanel';

/** One plugin's rich detail view: an identity hero plus collapsible Overview / Config / Tools / Hooks /
 *  Permissions / Data / Logs sections. Config is a form generated from the manifest's `configSchema`;
 *  secrets are write-only (a placeholder shows they are set) and saving hot-reloads the brain. */
export function PluginDetail({ name, onBack }: { name: string; onBack: () => void }) {
  const { data, isLoading } = usePluginDetail(name);
  const { data: contributions } = usePluginContributions(name);
  const { data: logs } = usePluginLogs(name);
  const { data: hookExecutions } = usePluginHookExecutions(name);
  const { t, locale } = useTranslation();

  if (isLoading || !data) return <LoadingState />;
  const detail = data;

  // Manifest strings are English; a plugin's own `i18n/<locale>.json` overrides description + per-field
  // label/hint. Fall back to the manifest English whenever a translation is absent.
  const tr = detail.i18n?.[locale];
  const fieldLabel = (f: PluginConfigField) => tr?.fields?.[f.key]?.label ?? f.label;
  const fieldHint = (f: PluginConfigField) => tr?.fields?.[f.key]?.hint ?? f.hint;
  const fieldOptions = (f: PluginConfigField) => (f.options ?? []).map((option) => ({
    ...option,
    label: tr?.fields?.[f.key]?.options?.[option.value] ?? option.label,
  }));

  const pluginDescription = tr?.description ?? detail.description;
  const riskText = (r: 'low' | 'medium' | 'high') => (r === 'high' ? t.pluginDetail.riskHigh : r === 'medium' ? t.pluginDetail.riskMedium : t.pluginDetail.riskLow);

  const health = logs?.health ?? detail.health ?? 'ok';
  const toolCount = detail.provides.tools?.length ?? 0;
  const hookCount = detail.provides.hooks?.length ?? 0;
  const platformCount = detail.provides.platforms?.length ?? 0;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Button variant="ghost" icon={ArrowLeft} onClick={onBack}>{t.pluginCfg.back}</Button>
      </div>

      {/* Hero: the plugin's identity card — icon, name, description, live enable toggle, and key facts. */}
      <PluginHero name={name} detail={detail} description={pluginDescription} toolCount={toolCount} />

      {/* Two-column body: the config + capability sections in the main column, a status rail on the right. */}
      <PageLayout rail={<PluginStatusRail health={health} toolCount={toolCount} hookCount={hookCount} platformCount={platformCount} />}>
        {/* Config collapsibles (schema-driven form + the cronjob/skills special sections). */}
        <PluginConfigEditor name={name} detail={detail} fieldLabel={fieldLabel} fieldHint={fieldHint} fieldOptions={fieldOptions} riskText={riskText} />

        {/* 3 — Tools: the plugin's live tools / skills / platforms. */}
        <PluginToolsPanel contributions={contributions} />

        {/* 4 — Hooks: the plugin's registered runtime hooks (subscriptions) + a recent-execution audit. */}
        <PluginHooksPanel contributions={contributions} hookExecutions={hookExecutions} />

        {/* 5 — Permissions: derived requirements + risk summary (read-only). */}
        <PluginPermissionsPanel detail={detail} fieldLabel={fieldLabel} riskText={riskText} toolCount={toolCount} platformCount={platformCount} />

        {/* 6 — Data: on-disk footprint + destructive clear. */}
        <PluginDataPanel name={name} summary={detail.data} />

        {/* 7 — Logs: the tail of the plugin's log ring, newest last. */}
        <PluginLogsPanel logs={logs} />
      </PageLayout>
    </div>
  );
}
