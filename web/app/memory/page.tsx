'use client';
export const dynamic = 'force-dynamic';
import { ModuleShell } from '../../components/shell/ModuleShell';
import { MemoryView } from '../../modules/memory/MemoryView';

export default function MemoryPage() {
  return (
    <ModuleShell moduleId="memory">
      <MemoryView />
    </ModuleShell>
  );
}
