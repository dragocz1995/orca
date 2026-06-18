'use client';
export const dynamic = 'force-dynamic';
import { useMissions } from '../../lib/queries';
import { PageHeader } from '../../components/ui/PageHeader';
import { ModuleShell } from '../../components/shell/ModuleShell';
import { MissionsView } from '../../modules/missions/MissionsView';

export default function MissionsPage() {
  const missions = useMissions();
  return (
    <ModuleShell moduleId="missions">
      <div className="flex w-full flex-col gap-6">
        <PageHeader title="Missions" count={missions.data?.length} />
        <MissionsView />
      </div>
    </ModuleShell>
  );
}
