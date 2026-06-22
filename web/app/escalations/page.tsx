'use client';
export const dynamic = 'force-dynamic';
import { ModuleShell } from '../../components/shell/ModuleShell';
import { EscalationsView } from '../../modules/escalations/EscalationsView';

export default function EscalationsPage() {
  return (
    <ModuleShell moduleId="escalations">
      <EscalationsView />
    </ModuleShell>
  );
}
