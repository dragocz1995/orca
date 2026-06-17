'use client';
export const dynamic = 'force-dynamic';
import { ModuleShell } from '../../components/shell/ModuleShell';
import { Panel } from '../../components/ui/Panel';
import { PageHeader } from '../../components/ui/PageHeader';
import { TimelineView } from '../../modules/timeline/TimelineView';

export default function TimelinePage() {
  return (
    <ModuleShell moduleId="timeline">
      <Panel>
        <PageHeader title="Timeline" />
        <TimelineView />
      </Panel>
    </ModuleShell>
  );
}
