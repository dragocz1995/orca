'use client';
export const dynamic = 'force-dynamic';
import { BarChart3 } from 'lucide-react';
import { ModuleShell } from '../../components/shell/ModuleShell';
import { ModuleHeader } from '../../components/ui/ModuleHeader';
import { useTranslation } from '../../lib/i18n';
import { StatsView } from '../../modules/stats/StatsView';

export default function StatsPage() {
  const { t } = useTranslation();
  return (
    <ModuleShell moduleId="stats">
      <ModuleHeader title={t.page.stats} icon={BarChart3} />
      <StatsView />
    </ModuleShell>
  );
}
