'use client';
import { PluginIcon } from './PluginIcon';
import { PluginActions } from './PluginActions';
import { Badge } from '../../components/ui/Badge';
import { HeroCard } from '../../components/ui/HeroCard';
import { RailCard } from '../../components/ui/RailCard';
import { HelpTip } from '../../components/ui/HelpTip';
import { useTranslation } from '../../lib/i18n';
import type { PluginDetail } from '../../lib/types';

/** Hero: the plugin's identity card — icon, name, description, live enable toggle, and key facts. */
export function PluginHero({ name, detail, description, toolCount }: { name: string; detail: PluginDetail; description: string; toolCount: number }) {
  const { t } = useTranslation();
  return (
    <HeroCard
      icon={detail.hasIllustration
        ? // eslint-disable-next-line @next/next/no-img-element -- served from the daemon route via BFF
          <img src={`/api/plugins/${encodeURIComponent(detail.name)}/illustration`} alt="" className="h-full w-full object-contain" />
        : <PluginIcon name={detail.name} hasIcon={detail.hasIcon} size={64} />}
      title={detail.name}
      subtitle={description}
      badge={<Badge tone={detail.enabled ? 'success' : 'muted'}>{detail.enabled ? t.pluginDetail.statusEnabled : t.pluginDetail.statusDisabled}</Badge>}
      meta={[
        { label: t.pluginDetail.overviewVersion, value: <span className="font-mono">v{detail.version}</span> },
        { label: t.pluginDetail.overviewSource, value: detail.source === 'bundled' ? t.plugins.bundled : t.plugins.user },
        { label: t.pluginDetail.tools, value: <span className="font-mono">{toolCount}</span> },
      ]}
      actions={<PluginActions name={name} detail={detail} />}
    />
  );
}

/** Status rail: health plus the tools / hooks / platforms counts, shown beside the main column. */
export function PluginStatusRail({ health, toolCount, hookCount, platformCount }: {
  health: 'ok' | 'error';
  toolCount: number;
  hookCount: number;
  platformCount: number;
}) {
  const { t } = useTranslation();
  return (
    <RailCard title={t.pluginDetail.overviewStatus}>
      <dl className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <dt className="flex items-center gap-1 text-xs text-text-muted">{t.pluginDetail.health}<HelpTip align="left">{t.help.pluginHealth}</HelpTip></dt>
          <dd><Badge tone={health === 'error' ? 'danger' : 'success'}>{health === 'error' ? t.plugins.healthError : t.plugins.healthOk}</Badge></dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-xs text-text-muted">{t.pluginDetail.tools}</dt>
          <dd className="font-mono text-sm text-text">{toolCount}</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-xs text-text-muted">{t.pluginDetail.hooks}</dt>
          <dd className="font-mono text-sm text-text">{hookCount}</dd>
        </div>
        {platformCount > 0 ? (
          <div className="flex items-center justify-between gap-2">
            <dt className="text-xs text-text-muted">{t.pluginDetail.platforms}</dt>
            <dd className="font-mono text-sm text-text">{platformCount}</dd>
          </div>
        ) : null}
      </dl>
    </RailCard>
  );
}
